import type { LocationCity, LocationCountry, LocationStatus } from "@/types/location";
import { looksLikeGooglePlaceId } from "./cityPlaceId";
import { hasUsableMapCoords } from "./geocode";

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
 * Group locations by countryId + cityId (city slug alone collides across countries).
 * Fall back to country + city name when ids are missing.
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

    // Prefer country+city so "paris" (FR) and "paris" (US) stay separate highlights.
    const key =
      cityId && countryId
        ? `${countryId}:${cityId}`
        : cityId
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
      // Prefer the first stored locality id — later overwrites caused wrong
      // boundary highlights when one place in the group had a bad Place ID.
      if (!entry.googlePlaceId) {
        entry.googlePlaceId = stored;
      }
    } else if (loc.id) {
      entry.locationIdsMissingPlaceId.push(loc.id);
    }

    if (hasUsableMapCoords(loc.lat, loc.lon)) {
      const lat = loc.lat as number;
      const lon = loc.lon as number;
      entry.points.push({ lat, lon });
    }
  }

  const results: CityStatusEntry[] = [];
  for (const entry of byKey.values()) {
    // Centroid of pins in this city — reverse-geocode bias matches the cluster,
    // not whichever location happened to be first in the array.
    let lat = entry.lat;
    let lon = entry.lon;
    if (entry.points.length > 0) {
      lat =
        entry.points.reduce((sum, p) => sum + p.lat, 0) / entry.points.length;
      lon =
        entry.points.reduce((sum, p) => sum + p.lon, 0) / entry.points.length;
    }

    const base = {
      key: entry.key,
      cityId: entry.cityId,
      cityName: entry.cityName,
      countryId: entry.countryId,
      countryName: entry.countryName,
      googlePlaceId: entry.googlePlaceId,
      locationIdsMissingPlaceId: entry.locationIdsMissingPlaceId,
      lat,
      lon,
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
