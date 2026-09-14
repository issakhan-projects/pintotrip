import type { LocationCity, LocationCountry, LocationStatus } from "@/types/location";
import { looksLikeGooglePlaceId } from "./cityPlaceId";

/** Highlightable city status — cancelled-only cities are omitted. */
export type CityHighlightStatus = "visited" | "planned";

export interface CityStatusLocation {
  id?: string;
  city: LocationCity;
  country: LocationCountry;
  status: LocationStatus;
  lat?: number;
  lon?: number;
}

export interface CityStatusEntry {
  key: string;
  status: CityHighlightStatus;
  cityId: string;
  cityName: string;
  countryId: string;
  countryName: string;
  /** Stored Google locality Place ID when present on any location in the city. */
  googlePlaceId?: string;
  /** Location doc ids missing city.googlePlaceId (for backfill). */
  locationIdsMissingPlaceId: string[];
  /** Representative coordinates from a location in this city (for geocode bias). */
  lat?: number;
  lon?: number;
  /** All place coordinates in this city. */
  points: Array<{ lat: number; lon: number }>;
}

/**
 * Group locations by city.id; fall back to country.id + city.name.
 * Priority: visited > planned > cancelled (cancelled-only → no entry).
 */
export function getCityStatuses(
  locations: CityStatusLocation[]
): CityStatusEntry[] {
  type Acc = {
    key: string;
    cityId: string;
    cityName: string;
    countryId: string;
    countryName: string;
    googlePlaceId?: string;
    locationIdsMissingPlaceId: string[];
    hasVisited: boolean;
    hasPlanned: boolean;
    lat?: number;
    lon?: number;
    points: Array<{ lat: number; lon: number }>;
  };

  const byKey = new Map<string, Acc>();

  for (const loc of locations) {
    const cityId = loc.city.id?.trim() ?? "";
    const cityName = loc.city.name?.trim() ?? "";
    const countryId = loc.country.id?.trim() ?? "";
    const countryName = loc.country.name?.trim() ?? "";

    if (!cityId && !cityName) continue;

    const key = cityId
      ? cityId
      : `${countryId || countryName}:${cityName}`;

    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        key,
        cityId: cityId || cityName,
        cityName: cityName || cityId,
        countryId,
        countryName,
        locationIdsMissingPlaceId: [],
        hasVisited: false,
        hasPlanned: false,
        points: [],
      };
      byKey.set(key, entry);
    }

    if (loc.status === "visited") entry.hasVisited = true;
    if (loc.status === "planned") entry.hasPlanned = true;

    const stored = loc.city.googlePlaceId?.trim();
    if (looksLikeGooglePlaceId(stored)) {
      entry.googlePlaceId = stored;
    } else if (loc.id) {
      entry.locationIdsMissingPlaceId.push(loc.id);
    }

    if (
      typeof loc.lat === "number" &&
      typeof loc.lon === "number" &&
      Number.isFinite(loc.lat) &&
      Number.isFinite(loc.lon)
    ) {
      entry.points.push({ lat: loc.lat, lon: loc.lon });
      if (entry.lat == null) {
        entry.lat = loc.lat;
        entry.lon = loc.lon;
      }
    }
  }

  const results: CityStatusEntry[] = [];
  for (const entry of byKey.values()) {
    const base = {
      key: entry.key,
      cityId: entry.cityId,
      cityName: entry.cityName,
      countryId: entry.countryId,
      countryName: entry.countryName,
      googlePlaceId: entry.googlePlaceId,
      locationIdsMissingPlaceId: entry.locationIdsMissingPlaceId,
      lat: entry.lat,
      lon: entry.lon,
      points: entry.points,
    };

    if (entry.hasVisited) {
      results.push({ ...base, status: "visited" });
    } else if (entry.hasPlanned) {
      results.push({ ...base, status: "planned" });
    }
    // cancelled-only → no highlight
  }

  return results;
}
