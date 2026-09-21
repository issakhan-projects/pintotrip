import type {
  TripDestination,
  TripDestinationStop,
  TripPlanner,
  TripPlannerDoc,
} from "@/types/trip-planner";
import { startOfUtcDay } from "@/services/trip-planner";
import { resolveCountryCode } from "@/lib/countries";
import { countryIdFromParts } from "@/lib/utils";

/** Legacy singular field on older Firestore docs. */
type TripWithLegacyDestination = TripPlanner & {
  destination?: TripDestination;
};

/**
 * All trip cities. Prefer `destinations[]`; fall back to legacy `destination`.
 */
export function listTripDestinations(
  trip: TripPlannerDoc | TripPlanner
): TripDestinationStop[] {
  if (trip.destinations && trip.destinations.length > 0) {
    return trip.destinations;
  }
  const legacy = (trip as TripWithLegacyDestination).destination;
  if (legacy?.cityName) {
    return [
      {
        cityName: legacy.cityName,
        countryName: legacy.countryName,
        cityId: legacy.cityId,
        countryId: legacy.countryId,
        lat: legacy.lat,
        lon: legacy.lon,
        photos: legacy.photos,
        transport: legacy.transport,
      },
    ];
  }
  return [];
}

/** Primary / first destination city (stay destination preferred when marked). */
export function primaryTripDestination(
  trip: TripPlannerDoc | TripPlanner
): TripDestinationStop {
  const list = listTripDestinations(trip);
  return (
    list.find((stop) => stop.stopType === "destination") ??
    list[0] ?? {
      cityName: "",
      countryName: "",
    }
  );
}

/** Origin + destination cities for flight route labels and airport lookup. */
export type FlightRouteCity = {
  cityName: string;
  countryName?: string;
  cityId?: string;
  lat?: number;
  lon?: number;
};

export function listFlightRouteCities(trip: TripPlannerDoc): FlightRouteCity[] {
  const cities: FlightRouteCity[] = [];
  const seen = new Set<string>();

  const push = (city: FlightRouteCity) => {
    const name = city.cityName.trim();
    if (!name) return;
    const key = destinationCityKey(name, city.cityId);
    if (seen.has(key)) return;
    seen.add(key);
    cities.push({
      cityName: name,
      ...(city.countryName?.trim()
        ? { countryName: city.countryName.trim() }
        : {}),
      ...(city.cityId?.trim() ? { cityId: city.cityId.trim() } : {}),
      ...(typeof city.lat === "number" ? { lat: city.lat } : {}),
      ...(typeof city.lon === "number" ? { lon: city.lon } : {}),
    });
  };

  if (trip.from?.cityName) {
    push({
      cityName: trip.from.cityName,
      countryName: trip.from.countryName,
      cityId: trip.from.cityId,
      lat: trip.from.lat,
      lon: trip.from.lon,
    });
  }

  for (const dest of listTripDestinations(trip)) {
    push({
      cityName: dest.cityName,
      countryName: dest.countryName,
      cityId: dest.cityId,
      lat: dest.lat,
      lon: dest.lon,
    });
  }

  return cities;
}

export function flightRouteLabel(cities: FlightRouteCity[]): string {
  return cities.map((city) => city.cityName).join(" → ");
}

/** Fingerprint for cached route-airport lists (invalidate when cities change). */
export function flightRouteAirportsKey(cities: FlightRouteCity[]): string {
  return cities
    .map((city) =>
      [
        (city.cityId || "").toLowerCase(),
        city.cityName.trim().toLowerCase(),
        (city.countryName || "").trim().toLowerCase(),
      ].join("|")
    )
    .join(";");
}

export function destinationCountryKey(
  countryName: string,
  countryId?: string
): string {
  const code =
    (countryId && countryId.length === 2 ? countryId : "") ||
    resolveCountryCode(countryId) ||
    resolveCountryCode(countryName);
  return countryIdFromParts(countryName, code || undefined);
}

/** True when country fields resolve to Saudi Arabia (ISO SA). */
export function isSaudiArabiaCountry(input: {
  countryCode?: string | null;
  countryId?: string | null;
  countryName?: string | null;
}): boolean {
  const fromId = input.countryId?.trim();
  const code =
    input.countryCode?.trim().toUpperCase() ||
    (fromId && fromId.length === 2 ? fromId.toUpperCase() : "") ||
    resolveCountryCode(fromId) ||
    resolveCountryCode(input.countryName);
  return code === "SA";
}

export function destinationCityKey(cityName: string, cityId?: string): string {
  const id = cityId?.trim().toLowerCase();
  if (id) return id;
  return cityName.trim().toLowerCase();
}

export function toIsoDate(date: Date): string {
  const d = startOfUtcDay(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
}

/** Destination that owns this calendar day when city dates are set. */
export function owningDestinationForDate(
  destinations: TripDestinationStop[],
  date: Date
): TripDestinationStop | null {
  const day = startOfUtcDay(date).getTime();
  const covering = destinations.filter((dest) => {
    if (!dest.startDate || !dest.endDate) return false;
    const start = startOfUtcDay(dest.startDate.toDate()).getTime();
    const end = startOfUtcDay(dest.endDate.toDate()).getTime();
    return day >= start && day <= end;
  });
  if (covering.length === 0) return null;
  if (covering.length === 1) return covering[0]!;
  const arriving = covering.find(
    (dest) => startOfUtcDay(dest.startDate!.toDate()).getTime() === day
  );
  return arriving ?? covering[covering.length - 1]!;
}

/** Group cities by country, preserving first-seen country order and city order. */
export function groupTripDestinationsByCountry(
  items: TripDestinationStop[]
): Array<{
  countryKey: string;
  countryName: string;
  countryId?: string;
  countryCode: string;
  cities: TripDestinationStop[];
}> {
  const groups: Array<{
    countryKey: string;
    countryName: string;
    countryId?: string;
    countryCode: string;
    cities: TripDestinationStop[];
  }> = [];
  const index = new Map<string, number>();

  for (const item of items) {
    const code =
      (item.countryId && item.countryId.length === 2
        ? item.countryId.toUpperCase()
        : "") ||
      resolveCountryCode(item.countryId) ||
      resolveCountryCode(item.countryName) ||
      "";
    const key = destinationCountryKey(item.countryName, item.countryId);
    let i = index.get(key);
    if (i === undefined) {
      i = groups.length;
      index.set(key, i);
      groups.push({
        countryKey: key,
        countryName: item.countryName,
        ...(item.countryId ? { countryId: item.countryId } : {}),
        countryCode: code,
        cities: [],
      });
    }
    groups[i]!.cities.push(item);
  }

  return groups;
}

/** City dates when both are set; otherwise "Dates not set". Never invents dates. */
export function formatCityStopDates(dest: TripDestinationStop): string {
  if (!dest.startDate || !dest.endDate) return "Dates not set";
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  });
  return `${fmt.format(dest.startDate.toDate())} – ${fmt.format(dest.endDate.toDate())}`;
}

export function destinationDateWindow(
  dest: TripDestinationStop,
  tripStart: Date,
  tripEnd: Date
): { start: Date; end: Date } {
  const start = dest.startDate
    ? startOfUtcDay(dest.startDate.toDate())
    : startOfUtcDay(tripStart);
  const end = dest.endDate
    ? startOfUtcDay(dest.endDate.toDate())
    : startOfUtcDay(tripEnd);
  return start.getTime() <= end.getTime()
    ? { start, end }
    : { start: end, end: start };
}
