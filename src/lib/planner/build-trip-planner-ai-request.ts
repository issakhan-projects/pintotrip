/**
 * Build the Trip Planner AI request: { trip, destinations, itinerary }.
 *
 * Aggregates existing trip / destination / intelligence / saved-place /
 * accommodation / itinerary / route data. Optional OpenWeather per day is
 * attached via weatherByIsoDate (user temperature unit → metric/imperial).
 */

import { isAsciiId } from "@/lib/utils";
import { devLog } from "@/lib/devLog";
import { getTrip, startOfUtcDay } from "@/services/trip-planner";
import { listTripRoutes } from "@/services/trip-routes";
import { getUserLocation } from "@/services/locations";
import type {
  BuildTripPlannerAiRequestInput,
  TripPlannerAiAirport,
  TripPlannerAiCityInfo,
  TripPlannerAiDestinationTransport,
  TripPlannerAiItineraryRoute,
  TripPlannerAiRequest,
  TripPlannerAiRequestDayWeather,
  TripPlannerAiRequestDestination,
  TripPlannerAiRequestItineraryDay,
  TripPlannerAiRequestTrip,
  TripPlannerAiSavedPlace,
  TripPlannerAiSavedPlaceSource,
  TripPlannerAiStopType,
  TripPlannerAiTransportLocation,
} from "@/types/trip-planner-ai-request";
import type { CityIntelligenceResult } from "@/types/city-intelligence";
import type { LeisureType } from "@/types/trip-plan";
import type { TemperatureUnit } from "@/types/user";
import type {
  TripAccommodation,
  TripAirport,
  TripDestinationStop,
  TripDestinationTransport,
  TripPlannerDoc,
  TripRoute,
  TripTransportLocation,
} from "@/types/trip-planner";
import { weatherForTrip } from "@/features/planner/tripWeather";

function toIsoDate(date: Date): string {
  const d = startOfUtcDay(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function firestoreToIso(
  value: { toDate: () => Date } | undefined
): string | undefined {
  if (!value || typeof value.toDate !== "function") return undefined;
  try {
    return toIsoDate(value.toDate());
  } catch {
    return undefined;
  }
}

function normalizeCityId(value: string | undefined | null): string | null {
  const id = value?.trim().toLowerCase() ?? "";
  return isAsciiId(id) ? id : null;
}

function normalizeCountryId(value: string | undefined | null): string {
  const id = value?.trim().toLowerCase() ?? "";
  return isAsciiId(id) ? id : "";
}

function parseStopType(value: unknown): Exclude<TripPlannerAiStopType, "home"> {
  return value === "transit" ? "transit" : "destination";
}

function slimTransportLocation(
  pin: TripTransportLocation
): TripPlannerAiTransportLocation {
  return {
    placeId: pin.placeId,
    name: pin.name,
    type: pin.type,
    location: pin.location,
    ...(pin.address ? { address: pin.address } : {}),
    // googleMapsUri, types intentionally omitted
  };
}

function slimAirport(airport: TripAirport): TripPlannerAiAirport {
  return {
    placeId: airport.placeId,
    name: airport.name,
    type: "airport",
    ...(airport.iataCode !== undefined ? { iataCode: airport.iataCode } : {}),
    location: airport.location,
    ...(airport.address ? { address: airport.address } : {}),
    // types intentionally omitted
  };
}

function slimTransport(
  transport: TripDestinationTransport
): TripPlannerAiDestinationTransport {
  return {
    airports: (transport.airports ?? []).map(slimAirport),
    ...(Array.isArray(transport.trainStations)
      ? {
          trainStations: transport.trainStations.map(slimTransportLocation),
        }
      : {}),
    lastCheckedAt: transport.lastCheckedAt,
  };
}

function slimSavedPlace(
  loc: TripPlannerAiSavedPlaceSource
): TripPlannerAiSavedPlace {
  return {
    id: loc.id,
    title: loc.title,
    description: loc.description,
    ...(loc.note?.trim() ? { note: loc.note.trim() } : {}),
    lat: loc.lat,
    lon: loc.lon,
    ...(loc.category ? { category: loc.category } : {}),
    // omitted: city, status, source, images, price, links, country, ai, timestamps
  };
}

function buildTripHeader(trip: TripPlannerDoc): TripPlannerAiRequestTrip {
  const fromId = normalizeCityId(trip.from?.cityId);
  const fromName = trip.from?.cityName?.trim();
  const currency = trip.currency?.code?.trim().toUpperCase();

  return {
    tripId: trip.id,
    ...(trip.name?.trim() ? { name: trip.name.trim() } : {}),
    startDate: toIsoDate(trip.startDate.toDate()),
    endDate: toIsoDate(trip.endDate.toDate()),
    ...(fromId || fromName ? { from: fromId ?? fromName } : {}),
    ...(currency && /^[A-Z]{3}$/.test(currency) ? { currency } : {}),
    ...(trip.leisureType ? { leisureType: trip.leisureType } : {}),
    ...(trip.leisureType === "custom" && trip.leisureCustom?.trim()
      ? { leisureCustom: trip.leisureCustom.trim() }
      : {}),
    spendMoney: trip.spendMoney ?? "medium",
    createMode: trip.createMode ?? "ordinary",
  };
}

function buildCityInfo(dest: TripDestinationStop): TripPlannerAiCityInfo {
  return {
    ...(typeof dest.lat === "number" && Number.isFinite(dest.lat)
      ? { lat: dest.lat }
      : {}),
    ...(typeof dest.lon === "number" && Number.isFinite(dest.lon)
      ? { lon: dest.lon }
      : {}),
    ...(dest.timezone?.trim() ? { timezone: dest.timezone.trim() } : {}),
    // photos / identity fields intentionally omitted (identity is on the destination)
    ...(dest.transport ? { transport: slimTransport(dest.transport) } : {}),
    ...(firestoreToIso(dest.startDate)
      ? { startDate: firestoreToIso(dest.startDate) }
      : {}),
    ...(firestoreToIso(dest.endDate)
      ? { endDate: firestoreToIso(dest.endDate) }
      : {}),
  };
}

function findCityIntelligence(
  results: CityIntelligenceResult[] | undefined,
  cityId: string
): CityIntelligenceResult | undefined {
  if (!results?.length) return undefined;
  return results.find(
    (entry) => normalizeCityId(entry.city?.cityId) === cityId
  );
}

function normalizeAccommodation(
  raw: TripDestinationStop["accommodation"]
): TripAccommodation | TripAccommodation[] | undefined {
  if (raw == null) return undefined;
  if (Array.isArray(raw)) {
    const list = raw.filter((stay) => stay && typeof stay === "object");
    if (list.length === 0) return undefined;
    return list.length === 1 ? list[0]! : list;
  }
  return raw;
}

function plannedSavedPlacesForCity(
  cityId: string,
  savedPlaceIds: string[],
  locations: TripPlannerAiSavedPlaceSource[]
): TripPlannerAiSavedPlace[] {
  if (savedPlaceIds.length === 0 || locations.length === 0) return [];
  const allowed = new Set(savedPlaceIds);
  return locations
    .filter((loc) => {
      if (!allowed.has(loc.id)) return false;
      if (loc.status !== "planned") return false;
      return normalizeCityId(loc.city?.id) === cityId;
    })
    .map(slimSavedPlace);
}

function buildHomeDestination(
  trip: TripPlannerDoc
): TripPlannerAiRequestDestination | null {
  const from = trip.from;
  if (!from) return null;
  const cityId = normalizeCityId(from.cityId);
  if (!cityId) return null;
  const cityName = from.cityName?.trim();
  const countryName = from.countryName?.trim();
  if (!cityName || !countryName) return null;

  return {
    cityId,
    cityName,
    countryId: normalizeCountryId(from.countryId),
    countryName,
    stopType: "home",
  };
}

function buildTransitOrDestination(
  dest: TripDestinationStop,
  cityId: string,
  intel: CityIntelligenceResult | undefined,
  savedPlaces: TripPlannerAiSavedPlace[],
  leisureType?: LeisureType
): TripPlannerAiRequestDestination {
  const accommodation = normalizeAccommodation(dest.accommodation);

  return {
    cityId,
    cityName: dest.cityName,
    countryId: normalizeCountryId(dest.countryId),
    countryName: dest.countryName,
    stopType: parseStopType(dest.stopType),
    ...(leisureType ? { leisureType } : {}),
    cityInfo: buildCityInfo(dest),
    ...(intel ? { cityIntelligence: intel } : {}),
    savedPlaces,
    ...(accommodation ? { accommodation } : {}),
  };
}

function buildDestinations(
  input: BuildTripPlannerAiRequestInput
): Record<string, TripPlannerAiRequestDestination> {
  const { trip, locations } = input;
  const out: Record<string, TripPlannerAiRequestDestination> = {};

  const home = buildHomeDestination(trip);
  if (home) {
    out[home.cityId] = home;
  }

  const intelResults = trip.cityIntelligence?.results;
  const destinations = Array.isArray(trip.destinations) ? trip.destinations : [];

  for (const dest of destinations) {
    const cityId = normalizeCityId(dest.cityId);
    if (!cityId) continue;

    // If origin is also a listed stop, prefer the richer transit/destination entry.
    out[cityId] = buildTransitOrDestination(
      dest,
      cityId,
      findCityIntelligence(intelResults, cityId),
      plannedSavedPlacesForCity(cityId, trip.savedPlaceIds, locations),
      trip.leisureType
    );
  }

  return out;
}

/** YYYY-MM-DD from an ISO-8601 datetime (uses the date already encoded in the string). */
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
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${day}`);
  }
  return dates;
}

/**
 * Trip calendar range: prefer destination stop windows when present,
 * otherwise trip.startDate → trip.endDate.
 */
function tripItineraryDateRange(trip: TripPlannerDoc): {
  startIso: string;
  endIso: string;
} {
  const tripStart = toIsoDate(trip.startDate.toDate());
  const tripEnd = toIsoDate(trip.endDate.toDate());
  let earliest = tripStart;
  let latest = tripEnd;

  for (const dest of trip.destinations ?? []) {
    const start = firestoreToIso(dest.startDate);
    const end = firestoreToIso(dest.endDate);
    if (start && start < earliest) earliest = start;
    if (end && end > latest) latest = end;
  }

  return { startIso: earliest, endIso: latest };
}

function routeTitle(route: TripRoute): string {
  const from = route.from?.city || route.from?.name || "";
  const to = route.to?.city || route.to?.name || "";
  if (from && to) return `${from} → ${to}`;
  return route.transport || "Route";
}

function routeSortKey(
  item: TripPlannerAiItineraryRoute,
  dayIso: string
): { hasTime: boolean; timeMs: number; order: number } {
  const route = item.route;
  const departure = route.departure?.datetime;
  const arrival = route.arrival?.datetime;
  const depDate = isoDateFromDatetime(departure);
  const arrDate = isoDateFromDatetime(arrival);
  let dt: string | undefined;
  if (item.routeStarted && depDate === dayIso) {
    dt = departure;
  } else if (item.routeEnded && arrDate === dayIso) {
    dt = arrival;
  } else {
    dt = departure || arrival;
  }
  if (dt) {
    const ms = Date.parse(dt);
    if (Number.isFinite(ms)) {
      return { hasTime: true, timeMs: ms, order: route.order };
    }
  }
  return {
    hasTime: false,
    timeMs: Number.POSITIVE_INFINITY,
    order: route.order,
  };
}

/**
 * Request itinerary: one day per calendar date.
 * Places every known TripRoute on the day it occurs (departure date, else arrival).
 * Undated routes are placed in order on the first trip day / after the previous leg.
 * Does not invent routes or places.
 */
function buildItinerary(
  trip: TripPlannerDoc,
  routes: TripRoute[] | undefined
): TripPlannerAiRequestItineraryDay[] {
  const { startIso, endIso } = tripItineraryDateRange(trip);
  const allDates = eachIsoDateInclusive(startIso, endIso);
  if (allDates.length === 0) return [];

  const days: TripPlannerAiRequestItineraryDay[] = allDates.map(
    (dateIso, index) => ({
      day: index + 1,
      date: dateIso,
      title: `Day ${index + 1}`,
      routes: [],
    })
  );
  const byDate = new Map(days.map((d) => [d.date, d]));

  const routeList = [...(routes ?? [])]
    .filter((route) => Boolean(route?.id))
    .sort((a, b) => a.order - b.order);

  let previousDate = startIso;

  for (const route of routeList) {
    const depDate = isoDateFromDatetime(route.departure?.datetime);
    const arrDate = isoDateFromDatetime(route.arrival?.datetime);
    // One occurrence day: departure date preferred (when the route happens).
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

  for (const day of days) {
    day.routes = [...day.routes]
      .sort((a, b) => {
        const ka = routeSortKey(a, day.date);
        const kb = routeSortKey(b, day.date);
        if (ka.hasTime && kb.hasTime && ka.timeMs !== kb.timeMs) {
          return ka.timeMs - kb.timeMs;
        }
        if (ka.hasTime !== kb.hasTime) return ka.hasTime ? -1 : 1;
        return ka.order - kb.order;
      })
      .map((item, order) => ({ ...item, order }));
  }

  return days;
}

/**
 * Pure aggregator: builds `{ trip, destinations, itinerary }` from loaded data.
 * Does not invent routes, places, activities, or accommodation.
 * Overnight routes stay a single TripRoute (same object referenced from multiple days).
 * Optional `weatherByIsoDate` attaches OpenWeather rows onto each itinerary day.
 */
export function buildTripPlannerAiRequest(
  input: BuildTripPlannerAiRequestInput
): TripPlannerAiRequest {
  const itinerary = buildItinerary(input.trip, input.routes);
  const withWeather = input.weatherByIsoDate
    ? applyWeatherToItinerary(itinerary, input.weatherByIsoDate)
    : itinerary;
  return {
    trip: buildTripHeader(input.trip),
    destinations: buildDestinations(input),
    itinerary: withWeather,
  };
}

/** Attach OpenWeather day rows onto an existing AI request itinerary. */
export function applyWeatherToTripPlannerAiRequest(
  request: TripPlannerAiRequest,
  weatherByIsoDate: Map<string, TripPlannerAiRequestDayWeather>
): TripPlannerAiRequest {
  return {
    ...request,
    itinerary: applyWeatherToItinerary(request.itinerary, weatherByIsoDate),
  };
}

function applyWeatherToItinerary(
  itinerary: TripPlannerAiRequestItineraryDay[],
  weatherByIsoDate: Map<string, TripPlannerAiRequestDayWeather>
): TripPlannerAiRequestItineraryDay[] {
  return itinerary.map((day) => {
    const weather = weatherByIsoDate.get(day.date);
    if (!weather) return day;
    return { ...day, weather };
  });
}

/**
 * Load trip + linked places (+ routes) and build the AI request.
 * Attaches OpenWeather per itinerary day using the user's temperature unit.
 */
export async function loadAndBuildTripPlannerAiRequest(params: {
  userId: string;
  tripId: string;
  /** Force a server trip read. */
  hard?: boolean;
  temperatureUnit?: TemperatureUnit;
}): Promise<TripPlannerAiRequest | null> {
  const trip = await getTrip(params.userId, params.tripId, {
    hard: params.hard,
  });
  if (!trip) return null;

  const routes: TripRoute[] = await listTripRoutes(
    params.userId,
    params.tripId
  ).catch(() => []);

  const locations: TripPlannerAiSavedPlaceSource[] = [];
  for (const locationId of trip.savedPlaceIds) {
    const loc = await getUserLocation(params.userId, locationId);
    if (loc) locations.push(loc);
  }

  let weatherByIsoDate:
    | Map<string, TripPlannerAiRequestDayWeather>
    | undefined;
  try {
    const weather = await weatherForTrip(trip, {
      temperatureUnit: params.temperatureUnit,
    });
    weatherByIsoDate = weather.aiByIsoDate;
  } catch (err) {
    devLog.warn("[TripPlannerAiRequest] weather attach failed", err);
  }

  return buildTripPlannerAiRequest({
    trip,
    locations,
    routes,
    ...(weatherByIsoDate ? { weatherByIsoDate } : {}),
    temperatureUnit: params.temperatureUnit,
  });
}
