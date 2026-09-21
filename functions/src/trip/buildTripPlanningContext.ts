/**
 * Load tripPlanner + routes + saved locations + weather into TripPlanningContext.
 */

import { HttpsError } from "firebase-functions/https";
import { logger } from "firebase-functions";
import type { DocumentData, DocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "../shared/admin";
import { openWeatherMapApiKey } from "../shared/config";
import {
  addUtcDays,
  fetchTripWeatherForecast,
  startOfUtcDay,
  toIsoDateUtc,
} from "../weather/openWeatherForecast";
import { buildCompleteJourney } from "./buildJourney";
import {
  LEISURE_CUSTOM_MAX_LENGTH,
  LEISURE_TYPES,
  TRIP_ROUTE_TRANSPORTS,
  type LeisureType,
  type PlanTripExistingDay,
  type PlanTripMode,
  type PlanTripWeatherDay,
  type RoutePoint,
  type TripPlanningAccommodation,
  type TripPlanningCityIntelligence,
  type TripPlanningContext,
  type TripPlanningSavedLocation,
  type TripRouteContext,
  type TripRouteStatus,
  type TripRouteTransport,
  type TripStopType,
} from "./types";

const GEO_NEAR_KM = 80;
const ROUTE_TRANSPORTS = new Set<string>(TRIP_ROUTE_TRANSPORTS);

type FirestoreTs = { toDate: () => Date };

type TripDestRaw = {
  countryId?: string;
  countryName?: string;
  cityId?: string;
  cityName?: string;
  lat?: number;
  lon?: number;
  startDate?: FirestoreTs;
  endDate?: FirestoreTs;
  stopType?: string;
};

type TripDocRaw = {
  userId?: string;
  name?: string;
  from?: TripDestRaw;
  destinations?: TripDestRaw[];
  destination?: TripDestRaw;
  startDate?: FirestoreTs;
  endDate?: FirestoreTs;
  leisureType?: string;
  leisureCustom?: string;
  spendMoney?: string;
  createMode?: string;
  currency?: { code?: string };
  cityIntelligence?: {
    status?: string;
    results?: unknown[];
  };
  preparation?: {
    accommodation?: unknown;
  };
  savedPlaceIds?: string[];
  itinerary?: {
    days?: Array<{
      day?: number;
      date?: FirestoreTs;
      title?: string;
      places?: Array<{ locationId?: string }>;
    }>;
  };
};

function isLeisureType(value: unknown): value is LeisureType {
  return (
    typeof value === "string" &&
    (LEISURE_TYPES as readonly string[]).includes(value)
  );
}

function firestoreToDate(value: unknown): Date | null {
  if (!value || typeof value !== "object") return null;
  if (typeof (value as FirestoreTs).toDate === "function") {
    try {
      return (value as FirestoreTs).toDate();
    } catch {
      return null;
    }
  }
  const seconds = (value as { _seconds?: number; seconds?: number })._seconds
    ?? (value as { seconds?: number }).seconds;
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    return new Date(seconds * 1000);
  }
  return null;
}

function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function listDestinations(trip: TripDocRaw): TripDestRaw[] {
  if (Array.isArray(trip.destinations) && trip.destinations.length > 0) {
    return trip.destinations.filter((d) => d?.cityName?.trim());
  }
  if (trip.destination?.cityName?.trim()) {
    return [trip.destination];
  }
  return [];
}

function primaryDestination(destinations: TripDestRaw[]): TripDestRaw | null {
  return (
    destinations.find((d) => d.stopType === "destination") ??
    destinations[0] ??
    null
  );
}

function parseStopType(value: unknown): TripStopType | undefined {
  return value === "destination" || value === "transit" ? value : undefined;
}

function toRoutePoint(
  dest: TripDestRaw | undefined,
  fallbackName = ""
): RoutePoint {
  const cityName = dest?.cityName?.trim() || fallbackName;
  const countryName = dest?.countryName?.trim() || undefined;
  const lat =
    typeof dest?.lat === "number" && Number.isFinite(dest.lat)
      ? dest.lat
      : undefined;
  const lon =
    typeof dest?.lon === "number" && Number.isFinite(dest.lon)
      ? dest.lon
      : undefined;
  const start = firestoreToDate(dest?.startDate);
  const end = firestoreToDate(dest?.endDate);
  const stopType = parseStopType(dest?.stopType);

  return {
    name: cityName,
    city: cityName,
    ...(countryName ? { country: countryName } : {}),
    ...(dest?.cityId?.trim()
      ? { placeId: dest.cityId.trim().toLowerCase(), cityId: dest.cityId.trim().toLowerCase() }
      : {}),
    ...(dest?.countryId?.trim()
      ? { countryId: dest.countryId.trim().toLowerCase() }
      : {}),
    ...(lat != null && lon != null ? { location: { lat, lon } } : {}),
    ...(start ? { startDate: toIsoDateUtc(startOfUtcDay(start)) } : {}),
    ...(end ? { endDate: toIsoDateUtc(startOfUtcDay(end)) } : {}),
    ...(stopType ? { stopType } : {}),
  };
}

function owningDestinationForDate(
  destinations: TripDestRaw[],
  date: Date
): TripDestRaw | null {
  const day = startOfUtcDay(date).getTime();
  const covering = destinations.filter((dest) => {
    const start = firestoreToDate(dest.startDate);
    const end = firestoreToDate(dest.endDate);
    if (!start || !end) return false;
    const s = startOfUtcDay(start).getTime();
    const e = startOfUtcDay(end).getTime();
    return day >= s && day <= e;
  });
  if (covering.length === 0) return null;
  if (covering.length === 1) return covering[0]!;
  const arriving = covering.find((dest) => {
    const start = firestoreToDate(dest.startDate);
    return start ? startOfUtcDay(start).getTime() === day : false;
  });
  return arriving ?? covering[covering.length - 1]!;
}

function destinationDateWindow(
  dest: TripDestRaw,
  tripStart: Date,
  tripEnd: Date
): { start: Date; end: Date } {
  const startRaw = firestoreToDate(dest.startDate);
  const endRaw = firestoreToDate(dest.endDate);
  const start = startRaw ? startOfUtcDay(startRaw) : startOfUtcDay(tripStart);
  const end = endRaw ? startOfUtcDay(endRaw) : startOfUtcDay(tripEnd);
  return start.getTime() <= end.getTime()
    ? { start, end }
    : { start: end, end: start };
}

function cityKey(name?: string, id?: string): string {
  const slug = id?.trim().toLowerCase();
  if (slug) return slug;
  return (name ?? "").trim().toLowerCase();
}

function matchesCity(place: TripPlanningSavedLocation, dest: TripDestRaw): boolean {
  const destCity = cityKey(dest.cityName, dest.cityId);
  const placeCity = cityKey(place.city, place.cityId);
  if (destCity && placeCity && destCity === placeCity) return true;
  return Boolean(
    dest.cityName?.trim() &&
      place.city.trim() &&
      dest.cityName.trim().toLowerCase() === place.city.trim().toLowerCase()
  );
}

function isNearDestination(
  place: TripPlanningSavedLocation,
  dest: TripDestRaw
): boolean {
  if (
    typeof dest.lat !== "number" ||
    typeof dest.lon !== "number" ||
    !Number.isFinite(dest.lat) ||
    !Number.isFinite(dest.lon)
  ) {
    return false;
  }
  return (
    haversineKm(
      { lat: place.location.lat, lon: place.location.lon },
      { lat: dest.lat, lon: dest.lon }
    ) <= GEO_NEAR_KM
  );
}

function slimCityIntelligence(raw: unknown): TripPlanningCityIntelligence | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const cityRaw = body.city;
  if (!cityRaw || typeof cityRaw !== "object") return null;
  const city = cityRaw as Record<string, unknown>;
  const name = typeof city.name === "string" ? city.name.trim() : "";
  const country = typeof city.country === "string" ? city.country.trim() : "";
  if (!name || !country) return null;

  const details =
    body.details && typeof body.details === "object"
      ? (body.details as Record<string, unknown>)
      : undefined;
  const climate =
    details?.climate && typeof details.climate === "object"
      ? (details.climate as { description?: string }).description
      : undefined;
  const practical =
    details?.practicalInfo && typeof details.practicalInfo === "object"
      ? (details.practicalInfo as {
          transport?: string;
          tips?: string[];
        })
      : undefined;

  const visa =
    body.visa && typeof body.visa === "object"
      ? (body.visa as {
          required?: boolean | "unknown";
          type?: string | null;
          description?: string;
        })
      : undefined;
  const safeRate =
    body.safeRate && typeof body.safeRate === "object"
      ? (body.safeRate as {
          score?: number;
          outOf?: number;
          summary?: string;
        })
      : undefined;
  const bestTime =
    body.bestTimeToVisit && typeof body.bestTimeToVisit === "object"
      ? (body.bestTimeToVisit as { summary?: string; months?: string[] })
      : undefined;
  const apps = Array.isArray(body.usefulApps)
    ? body.usefulApps
        .filter((app): app is Record<string, unknown> => !!app && typeof app === "object")
        .map((app) => ({
          name: typeof app.name === "string" ? app.name : "",
          category: typeof app.category === "string" ? app.category : "local",
          whyUseful: typeof app.whyUseful === "string" ? app.whyUseful : "",
        }))
        .filter((app) => app.name)
    : undefined;

  return {
    city: {
      name,
      country,
      cityId:
        typeof city.cityId === "string" ? city.cityId.trim().toLowerCase() : "",
      countryId:
        typeof city.countryId === "string"
          ? city.countryId.trim().toLowerCase()
          : "",
    },
    ...(visa && (visa.required === true || visa.required === false || visa.required === "unknown")
      ? {
          visa: {
            required: visa.required,
            ...(visa.type != null ? { type: visa.type } : {}),
            ...(visa.description ? { description: visa.description } : {}),
          },
        }
      : {}),
    ...(safeRate &&
    typeof safeRate.score === "number" &&
    typeof safeRate.outOf === "number" &&
    typeof safeRate.summary === "string"
      ? {
          safeRate: {
            score: safeRate.score,
            outOf: safeRate.outOf,
            summary: safeRate.summary,
          },
        }
      : {}),
    ...(bestTime?.summary
      ? {
          bestTimeToVisit: {
            summary: bestTime.summary,
            ...(Array.isArray(bestTime.months)
              ? {
                  months: bestTime.months.filter(
                    (m): m is string => typeof m === "string"
                  ),
                }
              : {}),
          },
        }
      : {}),
    ...(apps && apps.length > 0 ? { usefulApps: apps } : {}),
    ...(climate?.trim() ? { climate: climate.trim() } : {}),
    ...(practical?.transport?.trim()
      ? { transport: practical.transport.trim() }
      : {}),
    ...(Array.isArray(practical?.tips)
      ? {
          tips: practical.tips.filter(
            (t): t is string => typeof t === "string" && Boolean(t.trim())
          ),
        }
      : {}),
  };
}

function parseRoutePoint(raw: unknown): RoutePoint | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const city = typeof body.city === "string" ? body.city.trim() : name;
  if (!name && !city) return null;
  const loc =
    body.location && typeof body.location === "object"
      ? (body.location as { lat?: number; lon?: number })
      : undefined;
  return {
    name: name || city,
    city: city || name,
    ...(typeof body.country === "string" && body.country.trim()
      ? { country: body.country.trim() }
      : {}),
    ...(typeof body.placeId === "string" && body.placeId.trim()
      ? { placeId: body.placeId.trim() }
      : {}),
    ...(typeof body.code === "string" && body.code.trim()
      ? { code: body.code.trim() }
      : {}),
    ...(typeof loc?.lat === "number" &&
    typeof loc?.lon === "number" &&
    Number.isFinite(loc.lat) &&
    Number.isFinite(loc.lon)
      ? { location: { lat: loc.lat, lon: loc.lon } }
      : {}),
  };
}

function parseRouteDoc(
  id: string,
  data: DocumentData
): TripRouteContext | null {
  const from = parseRoutePoint(data.from);
  const to = parseRoutePoint(data.to);
  if (!from || !to) return null;
  const transport =
    typeof data.transport === "string" && ROUTE_TRANSPORTS.has(data.transport)
      ? (data.transport as TripRouteTransport)
      : "other";
  const status: TripRouteStatus =
    data.status === "in_progress" || data.status === "done"
      ? data.status
      : "planned";
  const parseInstant = (
    raw: unknown
  ):
    | { datetime: string; timezone: string; timeKnown?: boolean }
    | undefined => {
    if (!raw || typeof raw !== "object") return undefined;
    const body = raw as {
      datetime?: string;
      timezone?: string;
      timeKnown?: boolean;
    };
    if (typeof body.datetime !== "string" || !body.datetime.trim()) {
      return undefined;
    }
    return {
      datetime: body.datetime.trim(),
      timezone:
        typeof body.timezone === "string" ? body.timezone : "",
      ...(typeof body.timeKnown === "boolean"
        ? { timeKnown: body.timeKnown }
        : {}),
    };
  };

  const departure = parseInstant(data.departure);
  const arrival = parseInstant(data.arrival);

  return {
    id,
    order: typeof data.order === "number" ? data.order : 0,
    from,
    to,
    transport,
    ...(departure ? { departure } : {}),
    ...(arrival ? { arrival } : {}),
    ...(typeof data.durationMinutes === "number"
      ? { durationMinutes: data.durationMinutes }
      : {}),
    ...(data.durationApproximate === true
      ? { durationApproximate: true }
      : {}),
    status,
    ...(typeof data.note === "string" && data.note.trim()
      ? { note: data.note.trim() }
      : {}),
    ...(typeof data.airline === "string" && data.airline.trim()
      ? { airline: data.airline.trim() }
      : {}),
    ...(typeof data.flightNumber === "string" && data.flightNumber.trim()
      ? { flightNumber: data.flightNumber.trim() }
      : {}),
    ...(typeof data.priceAmount === "number" &&
    Number.isFinite(data.priceAmount) &&
    data.priceAmount >= 0
      ? { priceAmount: data.priceAmount }
      : {}),
    ...(typeof data.priceCurrency === "string" &&
    /^[A-Za-z]{3}$/.test(data.priceCurrency.trim())
      ? { priceCurrency: data.priceCurrency.trim().toUpperCase() }
      : {}),
    ...(typeof data.priceLabel === "string" && data.priceLabel.trim()
      ? { priceLabel: data.priceLabel.trim() }
      : {}),
    ...(typeof data.link === "string" && /^https?:\/\//i.test(data.link.trim())
      ? { link: data.link.trim() }
      : {}),
  };
}

function parseAccommodations(trip: TripDocRaw): TripPlanningAccommodation[] {
  const raw = trip.preparation?.accommodation;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out: TripPlanningAccommodation[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const stay = list[i];
    if (!stay || typeof stay !== "object") continue;
    const body = stay as Record<string, unknown>;
    const id =
      typeof body.id === "string" && body.id.trim()
        ? body.id.trim()
        : `stay-${i}`;
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : undefined;
    const address =
      typeof body.address === "string" && body.address.trim()
        ? body.address.trim()
        : undefined;
    const cityName =
      typeof body.cityName === "string" && body.cityName.trim()
        ? body.cityName.trim()
        : undefined;
    const countryName =
      typeof body.countryName === "string" && body.countryName.trim()
        ? body.countryName.trim()
        : undefined;
    const lat =
      typeof body.lat === "number" && Number.isFinite(body.lat)
        ? body.lat
        : undefined;
    const lon =
      typeof body.lon === "number" && Number.isFinite(body.lon)
        ? body.lon
        : undefined;
    const startDate =
      typeof body.startDate === "string" && body.startDate.trim()
        ? body.startDate.trim()
        : undefined;
    const endDate =
      typeof body.endDate === "string" && body.endDate.trim()
        ? body.endDate.trim()
        : undefined;
    const link =
      typeof body.link === "string" && /^https?:\/\//i.test(body.link.trim())
        ? body.link.trim()
        : undefined;
    if (!name && !address && lat == null) continue;
    out.push({
      id,
      ...(name ? { name } : {}),
      ...(address ? { address } : {}),
      ...(cityName ? { cityName } : {}),
      ...(countryName ? { countryName } : {}),
      ...(lat != null ? { lat } : {}),
      ...(lon != null ? { lon } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      ...(link ? { link } : {}),
    });
  }
  return out;
}

function parseSavedLocation(
  id: string,
  data: DocumentData
): TripPlanningSavedLocation | null {
  if (data.deleted === true) return null;
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const lat = data.lat;
  const lon = data.lon;
  if (!title) return null;
  if (typeof lat !== "number" || !Number.isFinite(lat)) return null;
  if (typeof lon !== "number" || !Number.isFinite(lon)) return null;

  const city =
    data.city && typeof data.city === "object"
      ? (data.city as { id?: string; name?: string })
      : {};
  const country =
    data.country && typeof data.country === "object"
      ? (data.country as { id?: string; name?: string })
      : {};
  const status =
    data.status === "visited" || data.status === "cancelled"
      ? data.status
      : "planned";
  const images = Array.isArray(data.images)
    ? data.images
        .map((img) =>
          img && typeof img === "object" && typeof (img as { url?: string }).url === "string"
            ? (img as { url: string }).url.trim()
            : ""
        )
        .filter(Boolean)
        .slice(0, 3)
    : undefined;

  return {
    id,
    title,
    ...(typeof data.description === "string" && data.description.trim()
      ? { description: data.description.trim() }
      : {}),
    city: typeof city.name === "string" ? city.name : "",
    country: typeof country.name === "string" ? country.name : "",
    location: { lat, lon },
    ...(images && images.length > 0 ? { images } : {}),
    ...(typeof data.note === "string" && data.note.trim()
      ? { note: data.note.trim() }
      : {}),
    status,
    ...(typeof data.category === "string" && data.category.trim()
      ? { category: data.category.trim() }
      : {}),
    ...(typeof city.id === "string" && city.id.trim()
      ? { cityId: city.id.trim().toLowerCase() }
      : {}),
    ...(typeof country.id === "string" && country.id.trim()
      ? { countryId: country.id.trim().toLowerCase() }
      : {}),
  };
}

async function loadSavedLocations(
  uid: string,
  trip: TripDocRaw,
  destinations: TripDestRaw[],
  mode: PlanTripMode
): Promise<{
  savedLocations: TripPlanningSavedLocation[];
  locationTitleById: Map<string, string>;
}> {
  const ids = Array.isArray(trip.savedPlaceIds)
    ? trip.savedPlaceIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
    : [];

  const occupiedIds = new Set(
    (trip.itinerary?.days ?? []).flatMap((day) =>
      (day.places ?? [])
        .map((p) => p.locationId)
        .filter((id): id is string => typeof id === "string" && Boolean(id))
    )
  );

  const locationTitleById = new Map<string, string>();
  if (ids.length === 0) {
    return { savedLocations: [], locationTitleById };
  }

  // Firestore getAll supports up to 100 refs per call.
  const refs = ids.map((id) => adminDb().doc(`users/${uid}/locations/${id}`));
  const snaps: DocumentSnapshot[] = [];
  for (let i = 0; i < refs.length; i += 100) {
    const chunk = await adminDb().getAll(...refs.slice(i, i + 100));
    snaps.push(...chunk);
  }

  const all: TripPlanningSavedLocation[] = [];
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const parsed = parseSavedLocation(snap.id, snap.data() ?? {});
    if (!parsed) continue;
    locationTitleById.set(parsed.id, parsed.title);
    if (parsed.status === "cancelled") continue;
    all.push(parsed);
  }

  const matched = all.filter((place) =>
    destinations.some(
      (dest) => matchesCity(place, dest) || isNearDestination(place, dest)
    )
  );

  const available =
    mode === "regenerate"
      ? matched
      : matched.filter((place) => !occupiedIds.has(place.id));

  available.sort((a, b) => {
    const aCity = destinations.some((dest) => matchesCity(a, dest)) ? 0 : 1;
    const bCity = destinations.some((dest) => matchesCity(b, dest)) ? 0 : 1;
    return aCity - bCity || a.title.localeCompare(b.title);
  });

  return { savedLocations: available, locationTitleById };
}

async function loadRoutes(uid: string, tripId: string): Promise<TripRouteContext[]> {
  const snap = await adminDb()
    .collection(`users/${uid}/tripPlanner/${tripId}/routes`)
    .orderBy("order", "asc")
    .get();
  const routes: TripRouteContext[] = [];
  for (const doc of snap.docs) {
    const parsed = parseRouteDoc(doc.id, doc.data());
    if (parsed) routes.push(parsed);
  }
  return routes;
}

async function loadWeatherForTrip(
  destinations: TripDestRaw[],
  tripStart: Date,
  tripEnd: Date
): Promise<PlanTripWeatherDay[]> {
  const apiKey = openWeatherMapApiKey.value();
  if (!apiKey) {
    logger.warn("planTrip: OPENWEATHERMAP_API_KEY missing; weather omitted");
    return [];
  }

  const targets = destinations.filter(
    (dest) =>
      typeof dest.lat === "number" &&
      typeof dest.lon === "number" &&
      Number.isFinite(dest.lat) &&
      Number.isFinite(dest.lon)
  );
  if (targets.length === 0) return [];

  const results = await Promise.all(
    targets.map(async (dest) => {
      const window = destinationDateWindow(dest, tripStart, tripEnd);
      try {
        const forecast = await fetchTripWeatherForecast({
          lat: dest.lat as number,
          lon: dest.lon as number,
          startDate: toIsoDateUtc(window.start),
          endDate: toIsoDateUtc(window.end),
          units: "metric",
          cityName: dest.cityName,
          apiKey,
        });
        return { dest, days: forecast.days, units: forecast.units as "metric" };
      } catch (err) {
        logger.warn("planTrip: weather fetch failed for destination", {
          cityName: dest.cityName,
          error: err instanceof Error ? err.message : String(err),
        });
        return { dest, days: [] as Awaited<ReturnType<typeof fetchTripWeatherForecast>>["days"], units: "metric" as const };
      }
    })
  );

  const weather: PlanTripWeatherDay[] = [];
  let cursor = startOfUtcDay(tripStart);
  const end = startOfUtcDay(tripEnd);
  while (cursor.getTime() <= end.getTime()) {
    const iso = toIsoDateUtc(cursor);
    const owner = owningDestinationForDate(destinations, cursor) ?? targets[0]!;
    const match =
      results.find(
        (row) =>
          row.dest.cityName === owner.cityName &&
          row.dest.countryName === owner.countryName
      ) ?? results[0]!;
    const day = match.days.find((d) => d.date === iso);
    weather.push({
      date: iso,
      available: day?.available === true,
      ...(owner.cityName ? { cityName: owner.cityName } : {}),
      ...(day?.tempMin != null ? { tempMin: day.tempMin } : {}),
      ...(day?.tempMax != null ? { tempMax: day.tempMax } : {}),
      ...(day?.temp != null ? { temp: day.temp } : {}),
      ...(day?.description ? { description: day.description } : {}),
      ...(day?.icon ? { icon: day.icon } : {}),
      ...(day?.humidity != null ? { humidity: day.humidity } : {}),
      ...(day?.windSpeed != null ? { windSpeed: day.windSpeed } : {}),
      ...(day?.precipitationChance != null
        ? { precipitationChance: day.precipitationChance }
        : {}),
      units: match.units,
    });
    cursor = addUtcDays(cursor, 1);
  }
  return weather;
}

function buildExistingDays(
  trip: TripDocRaw,
  tripStart: Date,
  tripEnd: Date,
  destinations: TripDestRaw[],
  locationTitleById: Map<string, string>,
  mode: PlanTripMode
): { emptyDays: PlanTripExistingDay[]; occupiedDays: PlanTripExistingDay[] } {
  const start = startOfUtcDay(tripStart);
  const end = startOfUtcDay(tripEnd);
  const dayCount = Math.max(
    1,
    Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
  );
  const byDayNumber = new Map(
    (trip.itinerary?.days ?? [])
      .filter((d) => typeof d.day === "number")
      .map((d) => [d.day as number, d])
  );

  const all: PlanTripExistingDay[] = [];
  for (let i = 0; i < dayCount; i += 1) {
    const dayNumber = i + 1;
    const dateObj = addUtcDays(start, i);
    const date = toIsoDateUtc(dateObj);
    const existing = byDayNumber.get(dayNumber);
    const owner = owningDestinationForDate(destinations, dateObj);
    const placeTitles =
      mode === "regenerate"
        ? []
        : (existing?.places ?? [])
            .map((p) =>
              p.locationId ? locationTitleById.get(p.locationId) : undefined
            )
            .filter((t): t is string => Boolean(t));

    all.push({
      day: dayNumber,
      date,
      title: existing?.title?.trim() || owner?.cityName?.trim() || undefined,
      placeTitles,
    });
  }

  return {
    emptyDays: all.filter((d) => d.placeTitles.length === 0),
    occupiedDays: all.filter((d) => d.placeTitles.length > 0),
  };
}

export type LoadedTripPlanning = {
  createMode: "ordinary" | "advanced";
  primaryCityName: string;
  primaryCountryName: string;
  primaryCountryId?: string;
  primaryCityId?: string;
  primaryLat?: number;
  primaryLon?: number;
  context: TripPlanningContext;
};

export async function loadTripPlanningContext(params: {
  uid: string;
  tripId: string;
  mode: PlanTripMode;
}): Promise<LoadedTripPlanning> {
  const { uid, tripId, mode } = params;
  const tripRef = adminDb().doc(`users/${uid}/tripPlanner/${tripId}`);
  const snap = await tripRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Trip not found.");
  }

  const trip = (snap.data() ?? {}) as TripDocRaw;
  const ownerId = typeof trip.userId === "string" ? trip.userId : uid;
  if (ownerId !== uid) {
    throw new HttpsError("permission-denied", "You cannot plan this trip.");
  }

  const tripStart = firestoreToDate(trip.startDate);
  const tripEnd = firestoreToDate(trip.endDate);
  if (!tripStart || !tripEnd) {
    throw new HttpsError(
      "failed-precondition",
      "Trip is missing startDate or endDate."
    );
  }

  const destinations = listDestinations(trip);
  if (destinations.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      "Trip has no destinations to plan."
    );
  }

  const primary = primaryDestination(destinations)!;
  const leisureType: LeisureType = isLeisureType(trip.leisureType)
    ? trip.leisureType
    : "mixed";
  const leisureCustomRaw =
    typeof trip.leisureCustom === "string" ? trip.leisureCustom.trim() : "";
  const leisureCustom =
    leisureType === "custom" && leisureCustomRaw
      ? leisureCustomRaw.slice(0, LEISURE_CUSTOM_MAX_LENGTH)
      : undefined;

  const createMode =
    trip.createMode === "advanced" ? "advanced" : "ordinary";

  const spendMoney =
    trip.spendMoney === "low" ||
    trip.spendMoney === "medium" ||
    trip.spendMoney === "high"
      ? trip.spendMoney
      : undefined;

  const currencyRaw =
    typeof trip.currency?.code === "string"
      ? trip.currency.code.trim().toUpperCase()
      : "";
  const currency =
    currencyRaw && /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : undefined;

  const [routes, saved, weather] = await Promise.all([
    loadRoutes(uid, tripId),
    loadSavedLocations(uid, trip, destinations, mode),
    loadWeatherForTrip(destinations, tripStart, tripEnd),
  ]);

  const { emptyDays, occupiedDays } = buildExistingDays(
    trip,
    tripStart,
    tripEnd,
    destinations,
    saved.locationTitleById,
    mode
  );

  const cityIntelligence = (trip.cityIntelligence?.results ?? [])
    .map(slimCityIntelligence)
    .filter((row): row is TripPlanningCityIntelligence => row != null);

  const fromPoint = toRoutePoint(
    trip.from,
    trip.from?.cityName?.trim() || "Origin"
  );
  const destinationPoints = destinations.map((dest) => toRoutePoint(dest));
  const journey = buildCompleteJourney({
    origin: fromPoint,
    destinations: destinationPoints,
    routes,
  });

  logger.info("planTrip journey constructed", {
    uid,
    tripId,
    citySequence: journey.citySequence.map((c) => c.city),
    legCount: journey.legs.length,
    missingConnectionCount: journey.missingConnectionCount,
    summary: journey.summary,
  });

  const context: TripPlanningContext = {
    trip: {
      ...(typeof trip.name === "string" && trip.name.trim()
        ? { name: trip.name.trim() }
        : {}),
      from: fromPoint,
      destinations: destinationPoints,
      startDate: toIsoDateUtc(startOfUtcDay(tripStart)),
      endDate: toIsoDateUtc(startOfUtcDay(tripEnd)),
      leisureType,
      ...(leisureCustom ? { leisureCustom } : {}),
      planMode: mode,
      ...(currency ? { currency } : {}),
      ...(spendMoney ? { spendMoney } : {}),
      createMode,
    },
    journey,
    cityIntelligence,
    routes,
    accommodations: parseAccommodations(trip),
    savedLocations: saved.savedLocations,
    weather,
    emptyDays,
    occupiedDays,
  };

  return {
    createMode,
    primaryCityName: primary.cityName?.trim() || "",
    primaryCountryName: primary.countryName?.trim() || "",
    ...(primary.countryId?.trim()
      ? { primaryCountryId: primary.countryId.trim().toLowerCase() }
      : {}),
    ...(primary.cityId?.trim()
      ? { primaryCityId: primary.cityId.trim().toLowerCase() }
      : {}),
    ...(typeof primary.lat === "number" && Number.isFinite(primary.lat)
      ? { primaryLat: primary.lat }
      : {}),
    ...(typeof primary.lon === "number" && Number.isFinite(primary.lon)
      ? { primaryLon: primary.lon }
      : {}),
    context,
  };
}
