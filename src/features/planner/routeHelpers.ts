/** Helpers for trip route cards, duration, and timezone-aware datetimes. */

import type {
  RoutePoint,
  TripAirport,
  TripDestinationStop,
  TripPlace,
  TripPlannerDoc,
  TripRoute,
  TripRouteTransport,
  TripTransportLocation,
} from "@/types/trip-planner";
import {
  destinationCityKey,
  listTripDestinations,
} from "./tripDestinations";

export type RouteCityOption = {
  key: string;
  cityName: string;
  countryName?: string;
  cityId?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  /** From `from.transport` / `destinations[].transport`. */
  airports: TripAirport[];
  trainStations: TripTransportLocation[];
  /** Original trip place — used to re-read transport when the trip doc updates. */
  source: "from" | "destination";
  destinationIndex?: number;
};

function readAirports(
  place: TripPlace | TripDestinationStop | undefined
): TripAirport[] {
  const airports = place?.transport?.airports;
  if (!Array.isArray(airports)) return [];
  return airports.flatMap((airport) => {
    if (!airport || typeof airport !== "object") return [];
    const placeId =
      typeof airport.placeId === "string" ? airport.placeId.trim() : "";
    if (!placeId) return [];
    const name =
      typeof airport.name === "string" && airport.name.trim()
        ? airport.name.trim()
        : typeof airport.iataCode === "string" && airport.iataCode.trim()
          ? airport.iataCode.trim().toUpperCase()
          : "Airport";
    const lat = airport.location?.lat;
    const lon = airport.location?.lon;
    return [
      {
        ...airport,
        placeId,
        name,
        type: "airport" as const,
        location: {
          lat: typeof lat === "number" ? lat : 0,
          lon: typeof lon === "number" ? lon : 0,
        },
      },
    ];
  });
}

function readTrainStations(
  place: TripPlace | TripDestinationStop | undefined
): TripTransportLocation[] {
  const stations = place?.transport?.trainStations;
  if (!Array.isArray(stations)) return [];
  return stations.filter(
    (station): station is TripTransportLocation =>
      Boolean(station) &&
      typeof station === "object" &&
      typeof station.placeId === "string" &&
      station.placeId.trim().length > 0
  );
}

function placeMatchesCityKey(
  place: TripPlace | TripDestinationStop | undefined,
  city: RouteCityOption
): boolean {
  const cityName = place?.cityName?.trim();
  if (!cityName) return false;
  if (destinationCityKey(cityName, place?.cityId) === city.key) return true;
  return cityName.toLowerCase() === city.cityName.toLowerCase();
}

export function listRouteCities(trip: TripPlannerDoc): RouteCityOption[] {
  const cities: RouteCityOption[] = [];
  const seen = new Set<string>();

  const push = (
    place: (TripPlace | TripDestinationStop) & { timezone?: string },
    source: "from" | "destination",
    destinationIndex?: number
  ) => {
    const cityName = place.cityName?.trim();
    if (!cityName) return;
    const key = destinationCityKey(cityName, place.cityId);
    if (seen.has(key)) return;
    seen.add(key);
    cities.push({
      key,
      cityName,
      countryName: place.countryName?.trim() || undefined,
      cityId: place.cityId?.trim() || undefined,
      lat: typeof place.lat === "number" ? place.lat : undefined,
      lon: typeof place.lon === "number" ? place.lon : undefined,
      timezone: place.timezone?.trim() || undefined,
      airports: readAirports(place),
      trainStations: readTrainStations(place),
      source,
      ...(destinationIndex != null ? { destinationIndex } : {}),
    });
  };

  if (trip.from?.cityName) push(trip.from, "from");
  listTripDestinations(trip).forEach((dest, index) =>
    push(dest, "destination", index)
  );
  return cities;
}

/**
 * Airports for a route city — merged from every matching
 * `trip.from` / `trip.destinations[]` entry's `transport.airports`.
 * (Same city can appear on both `from` and a destination.)
 */
export function airportsForRouteCity(
  trip: TripPlannerDoc,
  city: RouteCityOption | undefined
): TripAirport[] {
  if (!city) return [];
  const byPlaceId = new Map<string, TripAirport>();

  const addFromPlace = (place: TripPlace | TripDestinationStop | undefined) => {
    if (!placeMatchesCityKey(place, city)) return;
    for (const airport of readAirports(place)) {
      const existing = byPlaceId.get(airport.placeId);
      if (!existing) {
        byPlaceId.set(airport.placeId, airport);
        continue;
      }
      // Prefer the copy that already has an IATA code.
      if (!existing.iataCode && airport.iataCode) {
        byPlaceId.set(airport.placeId, airport);
      }
    }
  };

  addFromPlace(trip.from);
  for (const dest of listTripDestinations(trip)) {
    addFromPlace(dest);
  }
  return Array.from(byPlaceId.values());
}

export function trainStationsForRouteCity(
  trip: TripPlannerDoc,
  city: RouteCityOption | undefined
): TripTransportLocation[] {
  if (!city) return [];
  const byPlaceId = new Map<string, TripTransportLocation>();

  for (const dest of listTripDestinations(trip)) {
    if (!placeMatchesCityKey(dest, city)) continue;
    for (const station of readTrainStations(dest)) {
      byPlaceId.set(station.placeId, station);
    }
  }
  return Array.from(byPlaceId.values());
}

export function toAirportSelectOptions(airports: TripAirport[]) {
  return airports.map((airport) => {
    const code = airport.iataCode?.trim().toUpperCase() || undefined;
    return {
      value: airport.placeId,
      label: airport.name.trim() || code || "Airport",
      description: code,
    };
  });
}

export function isExactScheduleTransport(transport: TripRouteTransport): boolean {
  return transport === "flight" || transport === "train";
}

export function formatRouteDuration(
  minutes: number | undefined,
  approximate = false
): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null;
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const body =
    h > 0
      ? `${h}h ${String(m).padStart(2, "0")}m`
      : `${m}m`;
  return approximate ? `~${body}` : body;
}

/**
 * Format a route instant for display.
 * Prefers the stored IANA timezone (city local wall time); otherwise keeps the
 * wall clock from an offset ISO string so duration math and labels stay aligned.
 * When timeKnown === false, only the calendar date is shown (no invented clock).
 */
export function formatRouteWhen(
  iso?: string,
  timeZone?: string,
  timeKnown?: boolean
): string | null {
  if (!iso?.trim()) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const dateOnly = timeKnown === false;
  const options: Intl.DateTimeFormatOptions = dateOnly
    ? {
        day: "numeric",
        month: "short",
        year: "numeric",
      }
    : {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      };

  const zone = timeZone?.trim();
  if (zone) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        ...options,
        timeZone: zone,
      }).format(date);
    } catch {
      // Invalid IANA id — fall through.
    }
  }

  // Keep the offset ISO wall time (e.g. 10:00 in +05:00) instead of browser TZ.
  const match = iso
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (match) {
    const wall = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      dateOnly ? 12 : Number(match[4]),
      dateOnly ? 0 : Number(match[5])
    );
    if (!Number.isNaN(wall.getTime())) {
      return new Intl.DateTimeFormat(undefined, options).format(wall);
    }
  }

  return new Intl.DateTimeFormat(undefined, options).format(date);
}

export function formatRoutePointLabel(point: RoutePoint): string {
  const code = point.code?.trim().toUpperCase();
  const city = point.city?.trim() || point.name?.trim() || "Unknown";
  if (code) return `${city} (${code})`;
  return point.name?.trim() || city;
}

export function routePointTitle(point: RoutePoint): string {
  return point.name?.trim() || formatRoutePointLabel(point);
}

/** Parse datetime-local value into parts. */
function parseLocalDatetimeParts(value: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} | null {
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
}

function getZonedParts(
  date: Date,
  timeZone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    dtf
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value])
  ) as Record<string, string>;
  const hourRaw = Number(parts.hour);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: hourRaw === 24 ? 0 : hourRaw,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset of `timeZone` at `date`: localWall − UTC, in milliseconds. */
function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - date.getTime();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatOffset(offsetMs: number): string {
  const totalMinutes = Math.round(offsetMs / 60_000);
  const sign = totalMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(totalMinutes);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/**
 * Interpret a datetime-local string in an IANA zone and return
 * ISO-8601 with numeric offset (preserves absolute instant for duration math).
 */
export function localDatetimeInZoneToOffsetIso(
  localDatetime: string,
  timeZone?: string
): string | undefined {
  const parts = parseLocalDatetimeParts(localDatetime);
  if (!parts) return undefined;

  if (!timeZone) {
    const date = new Date(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    if (Number.isNaN(date.getTime())) return undefined;
    const offsetMs = -date.getTimezoneOffset() * 60_000;
    return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}${formatOffset(offsetMs)}`;
  }

  let utcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  for (let i = 0; i < 3; i++) {
    const offset = getTimeZoneOffsetMs(new Date(utcMs), timeZone);
    const desiredAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const next = desiredAsUtc - offset;
    if (next === utcMs) break;
    utcMs = next;
  }

  const instant = new Date(utcMs);
  if (Number.isNaN(instant.getTime())) return undefined;
  const wall = getZonedParts(instant, timeZone);
  const offsetMs = getTimeZoneOffsetMs(instant, timeZone);
  return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}T${pad2(wall.hour)}:${pad2(wall.minute)}:${pad2(wall.second)}${formatOffset(offsetMs)}`;
}

/** Convert stored offset ISO → datetime-local value for inputs. */
export function offsetIsoToDatetimeLocal(iso?: string): string {
  if (!iso?.trim()) return "";
  const match = iso
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?/);
  if (match) return `${match[1]}T${match[2]}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * datetime-local min/max from tripPlanner startDate / endDate.
 * Trip dates are stored as UTC midnight of the chosen calendar day.
 */
export function tripDatetimeLocalBounds(trip: TripPlannerDoc): {
  min: string;
  max: string;
} | null {
  const start = trip.startDate;
  const end = trip.endDate;
  if (
    !start ||
    !end ||
    typeof start.toDate !== "function" ||
    typeof end.toDate !== "function"
  ) {
    return null;
  }
  const startDate = start.toDate();
  const endDate = end.toDate();
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }
  const min = `${startDate.getUTCFullYear()}-${pad2(startDate.getUTCMonth() + 1)}-${pad2(startDate.getUTCDate())}T00:00`;
  const max = `${endDate.getUTCFullYear()}-${pad2(endDate.getUTCMonth() + 1)}-${pad2(endDate.getUTCDate())}T23:59`;
  return min <= max ? { min, max } : { min: max, max: min };
}

export function durationMinutesBetween(
  departureIso?: string,
  arrivalIso?: string
): number | undefined {
  if (!departureIso?.trim() || !arrivalIso?.trim()) return undefined;
  const from = new Date(departureIso).getTime();
  const to = new Date(arrivalIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return undefined;
  return Math.round((to - from) / 60_000);
}

/** Add minutes to a datetime-local string (`YYYY-MM-DDTHH:mm`). */
export function addMinutesToDatetimeLocal(
  value: string,
  minutes: number
): string | undefined {
  const parts = parseLocalDatetimeParts(value);
  if (!parts || !Number.isFinite(minutes)) return undefined;
  const date = new Date(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute + Math.round(minutes),
    0,
    0
  );
  if (Number.isNaN(date.getTime())) return undefined;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function addMinutesToOffsetIso(
  departureIso: string,
  minutes: number
): string | undefined {
  const from = new Date(departureIso).getTime();
  if (Number.isNaN(from) || !Number.isFinite(minutes)) return undefined;
  return new Date(from + minutes * 60_000).toISOString();
}

export function cityPointFromOption(city: RouteCityOption): RoutePoint {
  return {
    name: city.cityName,
    city: city.cityName,
    ...(city.countryName ? { country: city.countryName } : {}),
    ...(city.cityId ? { placeId: city.cityId } : {}),
    ...(typeof city.lat === "number" && typeof city.lon === "number"
      ? { location: { lat: city.lat, lon: city.lon } }
      : {}),
  };
}

export function airportToRoutePoint(
  city: RouteCityOption,
  airport: TripAirport
): RoutePoint {
  const code = airport.iataCode?.trim().toUpperCase() || undefined;
  return {
    name: airport.name.trim() || city.cityName,
    city: city.cityName,
    ...(city.countryName ? { country: city.countryName } : {}),
    placeId: airport.placeId,
    ...(code ? { code } : {}),
    location: {
      lat: airport.location.lat,
      lon: airport.location.lon,
    },
  };
}

export function stationToRoutePoint(
  city: RouteCityOption,
  station: TripTransportLocation
): RoutePoint {
  return {
    name: station.name.trim() || city.cityName,
    city: city.cityName,
    ...(city.countryName ? { country: city.countryName } : {}),
    placeId: station.placeId,
    location: {
      lat: station.location.lat,
      lon: station.location.lon,
    },
  };
}

export function nextRouteOrder(routes: TripRoute[]): number {
  if (routes.length === 0) return 0;
  return Math.max(...routes.map((r) => r.order)) + 1;
}

export const APPROX_DURATION_PRESETS: Array<{ label: string; minutes: number }> =
  [
    { label: "30m", minutes: 30 },
    { label: "1h", minutes: 60 },
    { label: "1h 30m", minutes: 90 },
    { label: "2h", minutes: 120 },
    { label: "3h", minutes: 180 },
    { label: "4h", minutes: 240 },
    { label: "6h", minutes: 360 },
    { label: "8h", minutes: 480 },
  ];
