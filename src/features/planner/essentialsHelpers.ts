/** Shared helpers for trip essentials flight / stay sheets. */

import type {
  TripAccommodation,
  TripDestinationStop,
  TripFlightEssential,
  TripPlannerDoc,
  TripPreparation,
} from "@/types/trip-planner";
import {
  listTripDestinations,
  primaryTripDestination,
} from "./tripDestinations";

export function toLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseLocalIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

function normalizeStayList(
  raw: TripAccommodation | TripAccommodation[] | null | undefined,
  fallbackCity?: { cityName?: string; countryName?: string }
): TripAccommodation[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((stay) => stay && typeof stay === "object")
    .map((stay, index) => ({
      ...stay,
      id: stay.id?.trim() || `stay-${index}`,
      cityName: stay.cityName?.trim() || fallbackCity?.cityName,
      countryName: stay.countryName?.trim() || fallbackCity?.countryName,
    }));
}

/** Stays from destinations[].accommodation (legacy preparation.accommodation as fallback). */
export function listTripAccommodations(
  trip: TripPlannerDoc
): TripAccommodation[] {
  const fromDestinations: TripAccommodation[] = [];
  for (const dest of listTripDestinations(trip)) {
    fromDestinations.push(
      ...normalizeStayList(dest.accommodation, {
        cityName: dest.cityName,
        countryName: dest.countryName,
      })
    );
  }
  if (fromDestinations.length > 0) {
    return fromDestinations.map((stay, index) => ({
      ...stay,
      id: stay.id?.trim() || `stay-${index}`,
    }));
  }

  // Legacy docs stored stays on preparation.accommodation.
  const legacy = (
    trip.preparation as TripPreparation & {
      accommodation?: TripAccommodation | TripAccommodation[] | null;
    }
  )?.accommodation;
  return normalizeStayList(legacy);
}

/** Persist accommodation list (empty → null). */
export function accommodationForSave(
  items: TripAccommodation[]
): TripAccommodation | TripAccommodation[] | null {
  if (items.length === 0) return null;
  if (items.length === 1) return items[0]!;
  return items;
}

function cityNeedle(value?: string): string {
  return value?.trim().toLowerCase() ?? "";
}

/** Best destination index for a stay (city name / id, else primary). */
export function destinationIndexForStay(
  destinations: TripDestinationStop[],
  stay: TripAccommodation
): number {
  if (destinations.length === 0) return 0;
  const needle = cityNeedle(stay.cityName);
  if (needle) {
    const matched = destinations.findIndex((dest) => {
      const name = cityNeedle(dest.cityName);
      const id = dest.cityId?.trim().toLowerCase();
      return name === needle || Boolean(id && id === needle);
    });
    if (matched >= 0) return matched;
  }

  const primary = destinations.findIndex(
    (dest) => dest.stopType === "destination"
  );
  return primary >= 0 ? primary : 0;
}

/**
 * Write the flat stay list onto destinations[].accommodation
 * (matched by city; unmatched → primary destination).
 */
export function applyAccommodationsToDestinations(
  trip: TripPlannerDoc,
  items: TripAccommodation[]
): TripDestinationStop[] {
  const destinations = listTripDestinations(trip);
  if (destinations.length === 0) {
    const primary = primaryTripDestination(trip);
    return [
      {
        ...primary,
        accommodation: accommodationForSave(items),
      },
    ];
  }

  const buckets = new Map<number, TripAccommodation[]>();
  for (const item of items) {
    const index = destinationIndexForStay(destinations, item);
    const list = buckets.get(index) ?? [];
    list.push(item);
    buckets.set(index, list);
  }

  return destinations.map((dest, index) => {
    const stays = (buckets.get(index) ?? []).map((stay) => ({
      ...stay,
      cityName: stay.cityName?.trim() || dest.cityName,
      countryName: stay.countryName?.trim() || dest.countryName,
    }));
    return {
      ...dest,
      accommodation: accommodationForSave(stays),
    };
  });
}

/** Clear legacy preparation.accommodation when migrating stays to destinations. */
export function preparationWithoutLegacyAccommodation(
  preparation: TripPreparation
): TripPreparation & { accommodation: null } {
  return {
    ...preparation,
    accommodation: null,
  };
}

export function formatStayDates(startDate?: string, endDate?: string): string | null {
  if (!startDate || !endDate) return null;
  try {
    const from = parseLocalIsoDate(startDate);
    const to = parseLocalIsoDate(endDate);
    const fmt = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
    });
    return `${fmt.format(from)} – ${fmt.format(to)}`;
  } catch {
    return null;
  }
}

/** Single stay date for list cards, e.g. "15 Sept 2026". */
export function formatStayDate(iso?: string): string | null {
  if (!iso?.trim()) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(parseLocalIsoDate(iso));
  } catch {
    return null;
  }
}

export function hasFlightDetails(value: TripFlightEssential | null): boolean {
  if (!value) return false;
  return Boolean(
    value.routeLabel?.trim() ||
      value.fromCityName?.trim() ||
      value.toCityName?.trim() ||
      value.departure?.code ||
      value.arrival?.code ||
      value.airline?.trim() ||
      value.flightNumber?.trim() ||
      value.departureAirport?.trim() ||
      value.arrivalAirport?.trim() ||
      value.departureAt?.trim() ||
      value.arrivalAt?.trim() ||
      value.bookingLink?.trim() ||
      value.notes?.trim()
  );
}

export function flightAirportCode(
  flight: TripFlightEssential,
  which: "departure" | "arrival"
): string {
  if (which === "departure") {
    return (
      flight.departure?.code?.trim() ||
      flight.departureAirport?.trim() ||
      ""
    ).toUpperCase();
  }
  return (
    flight.arrival?.code?.trim() ||
    flight.arrivalAirport?.trim() ||
    ""
  ).toUpperCase();
}

export function formatFlightWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function toDatetimeLocalValue(iso?: string): string {
  if (!iso?.trim()) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDatetimeLocalValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function normalizeUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function toTripFlightAirport(
  airport: { code: string; name?: string; cityName?: string; countryName?: string; lat?: number; lon?: number }
): import("@/types/trip-planner").TripFlightAirport {
  return {
    code: airport.code,
    ...(airport.name ? { name: airport.name } : {}),
    ...(airport.cityName ? { cityName: airport.cityName } : {}),
    ...(airport.countryName ? { countryName: airport.countryName } : {}),
    ...(typeof airport.lat === "number" ? { lat: airport.lat } : {}),
    ...(typeof airport.lon === "number" ? { lon: airport.lon } : {}),
  };
}
