/**
 * Shared Geocoding helpers with in-memory cache + in-flight dedupe.
 * Used by reverse geocode, English ID resolution, DDS Place ID lookup, and destination search.
 */

import { loadGeocodingLibrary } from "./loader";
import {
  GEOCODE_TTL_MS,
  cachedRequest,
  normalizeQuery,
  peekCachedRequest,
  roundCoord,
  seedCachedRequest,
} from "./requestCache";

export type GeocodeLocationOptions = {
  language?: string;
};

/** Real map coords — rejects missing, non-finite, and Null Island (0,0). */
export function hasUsableMapCoords(
  lat: number | null | undefined,
  lon: number | null | undefined
): boolean {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    !(lat === 0 && lon === 0)
  );
}

function locationCacheKey(
  lat: number,
  lon: number,
  options?: GeocodeLocationOptions
): string {
  const lang = options?.language?.trim().toLowerCase() || "default";
  return `geocode:loc:${roundCoord(lat)}:${roundCoord(lon)}:${lang}`;
}

function addressCacheKey(
  address: string,
  options?: { language?: string; country?: string }
): string {
  const lang = options?.language?.trim().toLowerCase() || "default";
  const country = options?.country?.trim().toUpperCase() || "";
  return `geocode:addr:${normalizeQuery(address)}:${lang}:${country}`;
}

/** Peek a cached reverse-geocode without billing a new request. */
export function peekGeocodeByLocation(
  lat: number,
  lon: number,
  options?: GeocodeLocationOptions
): google.maps.GeocoderResult[] | undefined {
  return peekCachedRequest(locationCacheKey(lat, lon, options));
}

/** Peek a cached forward-geocode without billing a new request. */
export function peekGeocodeByAddress(
  address: string,
  options?: { language?: string; country?: string }
): google.maps.GeocoderResult[] | undefined {
  const trimmed = address.trim();
  if (!trimmed) return undefined;
  return peekCachedRequest(addressCacheKey(trimmed, options));
}

/**
 * English results are a safe fallback for callers that omit `language`
 * (browser-locale "default"). Seeding avoids a second billed reverse geocode
 * when UI map-pick and English id resolution hit the same coords/query.
 */
function seedDefaultLanguageMirror(
  defaultKey: string,
  requestKey: string,
  results: google.maps.GeocoderResult[]
): void {
  if (defaultKey === requestKey) return;
  if (peekCachedRequest(defaultKey)) return;
  seedCachedRequest(defaultKey, results, GEOCODE_TTL_MS);
}

/** Reverse-geocode lat/lng; returns full Geocoder results (cached). */
export async function geocodeByLocation(
  lat: number,
  lon: number,
  options?: GeocodeLocationOptions
): Promise<google.maps.GeocoderResult[]> {
  if (!hasUsableMapCoords(lat, lon)) return [];

  const key = locationCacheKey(lat, lon, options);
  return cachedRequest(key, GEOCODE_TTL_MS, async () => {
    const { Geocoder } = await loadGeocodingLibrary();
    const geocoder = new Geocoder();
    try {
      const response = await geocoder.geocode({
        location: { lat, lng: lon },
        ...(options?.language ? { language: options.language } : {}),
      });
      const results = response.results ?? [];
      if (options?.language?.trim().toLowerCase() === "en") {
        seedDefaultLanguageMirror(locationCacheKey(lat, lon), key, results);
      }
      return results;
    } catch {
      // ZERO_RESULTS and similar — treat as empty, not a hard failure.
      return [];
    }
  });
}

/** Forward-geocode an address string; returns full Geocoder results (cached). */
export async function geocodeByAddress(
  address: string,
  options?: { language?: string; country?: string }
): Promise<google.maps.GeocoderResult[]> {
  const trimmed = address.trim();
  if (!trimmed) return [];

  const key = addressCacheKey(trimmed, options);
  return cachedRequest(key, GEOCODE_TTL_MS, async () => {
    const { Geocoder } = await loadGeocodingLibrary();
    const geocoder = new Geocoder();
    const country = options?.country?.trim();
    try {
      const response = await geocoder.geocode({
        address: trimmed,
        ...(options?.language ? { language: options.language } : {}),
        ...(country && /^[a-zA-Z]{2}$/.test(country)
          ? { componentRestrictions: { country: country.toUpperCase() } }
          : {}),
      });
      const results = response.results ?? [];
      if (options?.language?.trim().toLowerCase() === "en") {
        seedDefaultLanguageMirror(
          addressCacheKey(trimmed, { country: options?.country }),
          key,
          results
        );
      }
      return results;
    } catch {
      return [];
    }
  });
}

function placeIdCacheKey(placeId: string): string {
  return `geocode:placeId:${placeId.trim()}`;
}

/** Geocode a Google Place ID; returns full Geocoder results (cached). */
export async function geocodeByPlaceId(
  placeId: string
): Promise<google.maps.GeocoderResult[]> {
  const trimmed = placeId.trim();
  if (!trimmed) return [];

  const key = placeIdCacheKey(trimmed);
  return cachedRequest(key, GEOCODE_TTL_MS, async () => {
    const { Geocoder } = await loadGeocodingLibrary();
    const geocoder = new Geocoder();
    try {
      const response = await geocoder.geocode({ placeId: trimmed });
      return response.results ?? [];
    } catch {
      return [];
    }
  });
}

/**
 * Resolve lat/lon from a Google Place ID (e.g. when a location was saved with
 * city.googlePlaceId but Null Island coords).
 */
export async function resolveCoordsFromGooglePlaceId(
  placeId: string
): Promise<{ lat: number; lon: number } | null> {
  const results = await geocodeByPlaceId(placeId);
  const location = results[0]?.geometry?.location;
  if (!location) return null;
  const lat =
    typeof location.lat === "function" ? location.lat() : Number(location.lat);
  const lon =
    typeof location.lng === "function" ? location.lng() : Number(location.lng);
  if (!hasUsableMapCoords(lat, lon)) return null;
  return { lat, lon };
}
