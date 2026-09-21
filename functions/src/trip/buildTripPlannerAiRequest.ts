/**
 * Build TripPlannerAiRequest from Firestore (Admin SDK).
 * Attaches OpenWeather per itinerary day using temperatureType units.
 */

import { HttpsError } from "firebase-functions/https";
import { logger } from "firebase-functions";
import { adminDb } from "../shared/admin";
import { openWeatherMapApiKey } from "../shared/config";
import {
  addUtcDays,
  fetchTripWeatherForecast,
  startOfUtcDay,
  toIsoDateUtc,
} from "../weather/openWeatherForecast";
import {
  LEISURE_CUSTOM_MAX_LENGTH,
  LEISURE_TYPES,
  TRIP_ROUTE_TRANSPORTS,
  type LeisureType,
  type TripRouteContext,
  type TripRouteStatus,
  type TripRouteTransport,
} from "./types";
import type {
  SpendMoneyLevel,
  TemperatureType,
  TripCreateMode,
  TripPlannerAiAirport,
  TripPlannerAiItineraryRoute,
  TripPlannerAiRequest,
  TripPlannerAiRequestDayWeather,
  TripPlannerAiRequestDestination,
  TripPlannerAiRequestItineraryDay,
  TripPlannerAiRoute,
  TripPlannerAiSavedPlace,
  TripPlannerAiStopType,
  TripPlannerAiTransportLocation,
} from "./ai/tripPlannerAiTypes";

type FirestoreTs = { toDate: () => Date };

type DestRaw = {
  countryId?: string;
  countryName?: string;
  cityId?: string;
  cityName?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  startDate?: FirestoreTs;
  endDate?: FirestoreTs;
  stopType?: string;
  transport?: {
    airports?: Array<Record<string, unknown>>;
    trainStations?: Array<Record<string, unknown>>;
    lastCheckedAt?: string;
  };
  accommodation?: unknown;
};

type TripRaw = {
  userId?: string;
  name?: string;
  from?: DestRaw;
  destinations?: DestRaw[];
  startDate?: FirestoreTs;
  endDate?: FirestoreTs;
  leisureType?: string;
  leisureCustom?: string;
  spendMoney?: string;
  createMode?: string;
  currency?: { code?: string };
  savedPlaceIds?: string[];
  cityIntelligence?: { results?: unknown[] };
  preparation?: { accommodation?: unknown };
};

const ROUTE_TRANSPORTS = new Set<string>(TRIP_ROUTE_TRANSPORTS);

function isAsciiId(value: string | undefined | null): boolean {
  const id = value?.trim().toLowerCase() ?? "";
  if (!id || id === "unknown") return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}

function normalizeCityId(value: string | undefined | null): string | null {
  const id = value?.trim().toLowerCase() ?? "";
  return isAsciiId(id) ? id : null;
}

function normalizeCountryId(value: string | undefined | null): string {
  const id = value?.trim().toLowerCase() ?? "";
  if (/^[a-z]{2}$/.test(id)) return id;
  return isAsciiId(id) ? id : "";
}

function firestoreToDate(value: unknown): Date | null {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as FirestoreTs).toDate === "function"
  ) {
    try {
      return (value as FirestoreTs).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

function toIsoDate(date: Date): string {
  return toIsoDateUtc(startOfUtcDay(date));
}

function isoDateFromDatetime(datetime: string | undefined): string | null {
  if (!datetime?.trim()) return null;
  const match = datetime.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function eachIsoDateInclusive(startIso: string, endIso: string): string[] {
  const start = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(`${endIso}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const from = start.getTime() <= end.getTime() ? start : end;
  const to = start.getTime() <= end.getTime() ? end : start;
  const dates: string[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) {
    dates.push(toIsoDateUtc(new Date(t)));
  }
  return dates;
}

function openWeatherUnits(
  temperatureType?: TemperatureType
): "metric" | "imperial" {
  return temperatureType === "fahrenheit" ? "imperial" : "metric";
}

function parseStopType(value: unknown): Exclude<TripPlannerAiStopType, "home"> {
  return value === "transit" ? "transit" : "destination";
}

function isLeisureType(value: unknown): value is LeisureType {
  return (
    typeof value === "string" &&
    (LEISURE_TYPES as readonly string[]).includes(value)
  );
}

function isSpendMoneyLevel(value: unknown): value is SpendMoneyLevel {
  return value === "low" || value === "medium" || value === "high";
}

function parseCreateMode(value: unknown): TripCreateMode {
  return value === "advanced" ? "advanced" : "ordinary";
}

function parseRoutePoint(raw: unknown): TripRouteContext["from"] | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const city = typeof o.city === "string" ? o.city.trim() : "";
  if (!name || !city) return null;
  const country =
    typeof o.country === "string" && o.country.trim()
      ? o.country.trim()
      : undefined;
  const placeId =
    typeof o.placeId === "string" && o.placeId.trim()
      ? o.placeId.trim()
      : undefined;
  const code =
    typeof o.code === "string" && o.code.trim()
      ? o.code.trim().toUpperCase()
      : undefined;
  let location: { lat: number; lon: number } | undefined;
  if (o.location && typeof o.location === "object") {
    const loc = o.location as Record<string, unknown>;
    if (
      typeof loc.lat === "number" &&
      typeof loc.lon === "number" &&
      Number.isFinite(loc.lat) &&
      Number.isFinite(loc.lon)
    ) {
      location = { lat: loc.lat, lon: loc.lon };
    }
  }
  return {
    name,
    city,
    ...(country ? { country } : {}),
    ...(placeId ? { placeId } : {}),
    ...(code ? { code } : {}),
    ...(location ? { location } : {}),
  };
}

function parseRouteDoc(
  id: string,
  data: FirebaseFirestore.DocumentData,
  tripId: string
): TripPlannerAiRoute | null {
  const from = parseRoutePoint(data.from);
  const to = parseRoutePoint(data.to);
  const transport =
    typeof data.transport === "string" && ROUTE_TRANSPORTS.has(data.transport)
      ? (data.transport as TripRouteTransport)
      : null;
  if (!from || !to || !transport) return null;
  const order =
    typeof data.order === "number" && Number.isFinite(data.order)
      ? data.order
      : 0;
  const status: TripRouteStatus =
    data.status === "in_progress" || data.status === "done"
      ? data.status
      : "planned";

  const parseInstant = (raw: unknown) => {
    if (!raw || typeof raw !== "object") return undefined;
    const o = raw as Record<string, unknown>;
    const datetime = typeof o.datetime === "string" ? o.datetime.trim() : "";
    if (!datetime) return undefined;
    const timezone =
      typeof o.timezone === "string" ? o.timezone.trim() : "";
    return {
      datetime,
      timezone,
      ...(typeof o.timeKnown === "boolean" ? { timeKnown: o.timeKnown } : {}),
    };
  };

  return {
    id,
    tripId,
    order,
    from,
    to,
    transport,
    status,
    ...(parseInstant(data.departure)
      ? { departure: parseInstant(data.departure) }
      : {}),
    ...(parseInstant(data.arrival)
      ? { arrival: parseInstant(data.arrival) }
      : {}),
    ...(typeof data.durationMinutes === "number"
      ? { durationMinutes: data.durationMinutes }
      : {}),
    ...(typeof data.durationApproximate === "boolean"
      ? { durationApproximate: data.durationApproximate }
      : {}),
    ...(typeof data.note === "string" && data.note.trim()
      ? { note: data.note.trim() }
      : {}),
    ...(typeof data.airline === "string" && data.airline.trim()
      ? { airline: data.airline.trim() }
      : {}),
    ...(typeof data.flightNumber === "string" && data.flightNumber.trim()
      ? { flightNumber: data.flightNumber.trim() }
      : {}),
    ...(typeof data.priceAmount === "number"
      ? { priceAmount: data.priceAmount }
      : {}),
    ...(typeof data.priceCurrency === "string" &&
    /^[A-Za-z]{3}$/.test(data.priceCurrency)
      ? { priceCurrency: data.priceCurrency.toUpperCase() }
      : {}),
    ...(typeof data.priceLabel === "string" && data.priceLabel.trim()
      ? { priceLabel: data.priceLabel.trim() }
      : {}),
    ...(typeof data.link === "string" && /^https?:\/\//i.test(data.link)
      ? { link: data.link.trim() }
      : {}),
  };
}

function slimAirport(raw: Record<string, unknown>): TripPlannerAiAirport | null {
  const placeId = typeof raw.placeId === "string" ? raw.placeId.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const loc = raw.location as { lat?: number; lon?: number } | undefined;
  if (
    !placeId ||
    !name ||
    typeof loc?.lat !== "number" ||
    typeof loc?.lon !== "number"
  ) {
    return null;
  }
  return {
    placeId,
    name,
    type: "airport",
    ...(raw.iataCode !== undefined
      ? { iataCode: (raw.iataCode as string | null) ?? null }
      : {}),
    location: { lat: loc.lat, lon: loc.lon },
    ...(typeof raw.address === "string" && raw.address.trim()
      ? { address: raw.address.trim() }
      : {}),
  };
}

function slimStation(
  raw: Record<string, unknown>
): TripPlannerAiTransportLocation | null {
  const placeId = typeof raw.placeId === "string" ? raw.placeId.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const loc = raw.location as { lat?: number; lon?: number } | undefined;
  if (
    !placeId ||
    !name ||
    typeof loc?.lat !== "number" ||
    typeof loc?.lon !== "number"
  ) {
    return null;
  }
  return {
    placeId,
    name,
    type: "train_station",
    location: { lat: loc.lat, lon: loc.lon },
    ...(typeof raw.address === "string" && raw.address.trim()
      ? { address: raw.address.trim() }
      : {}),
  };
}

function routeTitle(route: TripPlannerAiRoute): string {
  return `${route.from.name} → ${route.to.name}`;
}

function buildItinerary(
  startIso: string,
  endIso: string,
  routes: TripPlannerAiRoute[]
): TripPlannerAiRequestItineraryDay[] {
  const allDates = eachIsoDateInclusive(startIso, endIso);
  const days: TripPlannerAiRequestItineraryDay[] = allDates.map(
    (dateIso, index) => ({
      day: index + 1,
      date: dateIso,
      title: `Day ${index + 1}`,
      routes: [] as TripPlannerAiItineraryRoute[],
    })
  );
  const byDate = new Map(days.map((d) => [d.date, d]));
  let previousDate = startIso;

  for (const route of [...routes].sort((a, b) => a.order - b.order)) {
    const depDate = isoDateFromDatetime(route.departure?.datetime);
    const arrDate = isoDateFromDatetime(route.arrival?.datetime);
    const dateIso = depDate || arrDate || previousDate;
    previousDate = arrDate || depDate || previousDate;
    const day =
      byDate.get(dateIso) ??
      days.find((d) => d.date >= dateIso) ??
      days[days.length - 1];
    if (!day) continue;
    const overnight = Boolean(depDate && arrDate && depDate !== arrDate);
    day.routes.push({
      locationId: `route:${route.id}`,
      order: day.routes.length,
      status: "planned",
      type: "route",
      routeId: route.id,
      title: routeTitle(route),
      route,
      source: "user",
      routeStarted: true,
      routeEnded: !overnight,
    });
  }
  return days;
}

function owningDestForDate(
  destinations: DestRaw[],
  date: Date
): DestRaw | null {
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
    return start && startOfUtcDay(start).getTime() === day;
  });
  return arriving ?? covering[covering.length - 1]!;
}

async function loadWeatherByDate(params: {
  destinations: DestRaw[];
  tripStart: Date;
  tripEnd: Date;
  units: "metric" | "imperial";
}): Promise<Map<string, TripPlannerAiRequestDayWeather>> {
  const out = new Map<string, TripPlannerAiRequestDayWeather>();
  const apiKey = openWeatherMapApiKey.value();
  if (!apiKey) {
    logger.warn("planTrip AI: OPENWEATHERMAP_API_KEY missing; weather omitted");
    return out;
  }

  const targets = params.destinations.filter(
    (d) =>
      typeof d.lat === "number" &&
      typeof d.lon === "number" &&
      Number.isFinite(d.lat) &&
      Number.isFinite(d.lon)
  );
  if (targets.length === 0) return out;

  const results = await Promise.all(
    targets.map(async (dest) => {
      const start =
        firestoreToDate(dest.startDate) ?? params.tripStart;
      const end = firestoreToDate(dest.endDate) ?? params.tripEnd;
      try {
        const forecast = await fetchTripWeatherForecast({
          lat: dest.lat as number,
          lon: dest.lon as number,
          startDate: toIsoDate(start),
          endDate: toIsoDate(end),
          units: params.units,
          cityName: dest.cityName,
          apiKey,
        });
        return { dest, days: forecast.days, units: forecast.units };
      } catch (err) {
        logger.warn("planTrip AI: weather fetch failed", {
          cityName: dest.cityName,
          error: err instanceof Error ? err.message : String(err),
        });
        return { dest, days: [] as Awaited<ReturnType<typeof fetchTripWeatherForecast>>["days"], units: params.units };
      }
    })
  );

  let cursor = startOfUtcDay(params.tripStart);
  const end = startOfUtcDay(params.tripEnd);
  while (cursor.getTime() <= end.getTime()) {
    const iso = toIsoDateUtc(cursor);
    const owner = owningDestForDate(params.destinations, cursor) ?? targets[0]!;
    const match =
      results.find(
        (row) =>
          row.dest.cityName === owner.cityName &&
          row.dest.countryName === owner.countryName
      ) ?? results[0]!;
    const day = match.days.find((d) => d.date === iso);
    const cityId = normalizeCityId(owner.cityId) ?? undefined;
    out.set(iso, {
      available: day?.available === true,
      ...(cityId ? { cityId } : {}),
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
  return out;
}

function buildDestinations(params: {
  trip: TripRaw;
  leisureType?: LeisureType;
  savedByCity: Map<string, TripPlannerAiSavedPlace[]>;
}): Record<string, TripPlannerAiRequestDestination> {
  const out: Record<string, TripPlannerAiRequestDestination> = {};
  const from = params.trip.from;
  if (from) {
    const cityId = normalizeCityId(from.cityId);
    const cityName = from.cityName?.trim();
    const countryName = from.countryName?.trim();
    if (cityId && cityName && countryName) {
      const airports = (from.transport?.airports ?? [])
        .map((a) => slimAirport(a))
        .filter((a): a is TripPlannerAiAirport => Boolean(a));
      out[cityId] = {
        cityId,
        cityName,
        countryId: normalizeCountryId(from.countryId),
        countryName,
        stopType: "home",
        // Home may start from an airport hub — expose airports when known.
        ...(typeof from.lat === "number" ||
        typeof from.lon === "number" ||
        airports.length > 0
          ? {
              cityInfo: {
                ...(typeof from.lat === "number" ? { lat: from.lat } : {}),
                ...(typeof from.lon === "number" ? { lon: from.lon } : {}),
                ...(from.timezone?.trim()
                  ? { timezone: from.timezone.trim() }
                  : {}),
                ...(airports.length > 0
                  ? {
                      transport: {
                        airports,
                        lastCheckedAt:
                          from.transport?.lastCheckedAt?.trim() ||
                          new Date(0).toISOString(),
                      },
                    }
                  : {}),
              },
            }
          : {}),
      };
    }
  }

  for (const dest of params.trip.destinations ?? []) {
    const cityId = normalizeCityId(dest.cityId);
    if (!cityId) continue;
    const cityName = dest.cityName?.trim() || cityId;
    const countryName = dest.countryName?.trim() || "";
    const airports = (dest.transport?.airports ?? [])
      .map((a) => slimAirport(a))
      .filter((a): a is TripPlannerAiAirport => Boolean(a));
    const stations = (dest.transport?.trainStations ?? [])
      .map((s) => slimStation(s))
      .filter((s): s is TripPlannerAiTransportLocation => Boolean(s));

    out[cityId] = {
      cityId,
      cityName,
      countryId: normalizeCountryId(dest.countryId),
      countryName,
      stopType: parseStopType(dest.stopType),
      ...(params.leisureType ? { leisureType: params.leisureType } : {}),
      cityInfo: {
        ...(typeof dest.lat === "number" ? { lat: dest.lat } : {}),
        ...(typeof dest.lon === "number" ? { lon: dest.lon } : {}),
        ...(dest.timezone?.trim() ? { timezone: dest.timezone.trim() } : {}),
        ...(firestoreToDate(dest.startDate)
          ? { startDate: toIsoDate(firestoreToDate(dest.startDate)!) }
          : {}),
        ...(firestoreToDate(dest.endDate)
          ? { endDate: toIsoDate(firestoreToDate(dest.endDate)!) }
          : {}),
        ...(dest.transport
          ? {
              transport: {
                airports,
                ...(stations.length ? { trainStations: stations } : {}),
                lastCheckedAt:
                  dest.transport.lastCheckedAt?.trim() ||
                  new Date(0).toISOString(),
              },
            }
          : {}),
      },
      savedPlaces: params.savedByCity.get(cityId) ?? [],
    };
  }
  return out;
}

export type LoadedTripPlannerAi = {
  request: TripPlannerAiRequest;
  routes: TripPlannerAiRoute[];
  createMode: "ordinary" | "advanced";
};

/**
 * Load trip ownership + build TripPlannerAiRequest with weather.
 */
export async function loadAndBuildTripPlannerAiRequest(params: {
  uid: string;
  tripId: string;
  temperatureType?: TemperatureType;
}): Promise<LoadedTripPlannerAi> {
  const { uid, tripId } = params;
  const tripRef = adminDb().doc(`users/${uid}/tripPlanner/${tripId}`);
  const snap = await tripRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Trip not found.");
  }

  const trip = (snap.data() ?? {}) as TripRaw;
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

  const destinations = Array.isArray(trip.destinations)
    ? trip.destinations
    : [];
  if (destinations.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      "Trip has no destinations to plan."
    );
  }

  const leisureType: LeisureType | undefined = isLeisureType(trip.leisureType)
    ? trip.leisureType
    : undefined;
  const leisureCustomRaw =
    typeof trip.leisureCustom === "string" ? trip.leisureCustom.trim() : "";
  const leisureCustom =
    leisureType === "custom" && leisureCustomRaw
      ? leisureCustomRaw.slice(0, LEISURE_CUSTOM_MAX_LENGTH)
      : undefined;

  const spendMoney: SpendMoneyLevel = isSpendMoneyLevel(trip.spendMoney)
    ? trip.spendMoney
    : "medium";

  const createMode = parseCreateMode(trip.createMode);

  const currencyRaw =
    typeof trip.currency?.code === "string"
      ? trip.currency.code.trim().toUpperCase()
      : "";
  const currency =
    currencyRaw && /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : undefined;

  const startIso = toIsoDate(tripStart);
  const endIso = toIsoDate(tripEnd);
  const units = openWeatherUnits(params.temperatureType);

  // Routes
  const routesSnap = await adminDb()
    .collection(`users/${uid}/tripPlanner/${tripId}/routes`)
    .orderBy("order", "asc")
    .get();
  const routes: TripPlannerAiRoute[] = [];
  for (const doc of routesSnap.docs) {
    const parsed = parseRouteDoc(doc.id, doc.data(), tripId);
    if (parsed) routes.push(parsed);
  }

  // Saved places (planned only), grouped by cityId
  const savedIds = Array.isArray(trip.savedPlaceIds)
    ? trip.savedPlaceIds.filter(
        (id): id is string => typeof id === "string" && Boolean(id.trim())
      )
    : [];
  const savedByCity = new Map<string, TripPlannerAiSavedPlace[]>();
  if (savedIds.length > 0) {
    const refs = savedIds.map((id) =>
      adminDb().doc(`users/${uid}/locations/${id}`)
    );
    for (let i = 0; i < refs.length; i += 100) {
      const chunk = await adminDb().getAll(...refs.slice(i, i + 100));
      for (const locSnap of chunk) {
        if (!locSnap.exists) continue;
        const data = locSnap.data() ?? {};
        if (data.status && data.status !== "planned") continue;
        const city =
          data.city && typeof data.city === "object"
            ? (data.city as { id?: string; name?: string })
            : {};
        const cityId = normalizeCityId(city.id);
        if (!cityId) continue;
        const title =
          typeof data.title === "string" ? data.title.trim() : "";
        if (!title) continue;
        const lat =
          typeof data.lat === "number"
            ? data.lat
            : typeof (data.location as { lat?: number } | undefined)?.lat ===
                "number"
              ? (data.location as { lat: number }).lat
              : null;
        const lon =
          typeof data.lon === "number"
            ? data.lon
            : typeof (data.location as { lon?: number } | undefined)?.lon ===
                "number"
              ? (data.location as { lon: number }).lon
              : null;
        if (lat == null || lon == null) continue;
        const list = savedByCity.get(cityId) ?? [];
        list.push({
          id: locSnap.id,
          title,
          description:
            typeof data.description === "string" ? data.description : "",
          ...(typeof data.note === "string" && data.note.trim()
            ? { note: data.note.trim() }
            : {}),
          lat,
          lon,
          ...(typeof data.category === "string"
            ? { category: data.category as TripPlannerAiSavedPlace["category"] }
            : {}),
        });
        savedByCity.set(cityId, list);
      }
    }
  }

  const weatherByDate = await loadWeatherByDate({
    destinations,
    tripStart,
    tripEnd,
    units,
  });

  const fromId = normalizeCityId(trip.from?.cityId);
  const fromName = trip.from?.cityName?.trim();

  const itinerary = buildItinerary(startIso, endIso, routes).map((day) => {
    const weather = weatherByDate.get(day.date);
    return weather ? { ...day, weather } : day;
  });

  const request: TripPlannerAiRequest = {
    trip: {
      tripId,
      ...(typeof trip.name === "string" && trip.name.trim()
        ? { name: trip.name.trim() }
        : {}),
      startDate: startIso,
      endDate: endIso,
      ...(fromId || fromName ? { from: fromId ?? fromName } : {}),
      ...(currency ? { currency } : {}),
      ...(leisureType ? { leisureType } : {}),
      ...(leisureCustom ? { leisureCustom } : {}),
      spendMoney,
      createMode,
    },
    destinations: buildDestinations({
      trip,
      leisureType,
      savedByCity,
    }),
    itinerary,
  };

  return { request, routes, createMode };
}
