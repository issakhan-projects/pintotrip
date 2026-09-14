/**
 * Shared Geocoding helpers with in-memory cache + in-flight dedupe.
 * Used by reverse geocode, English ID resolution, DDS Place ID lookup, and destination search.
 */

import { loadGeocodingLibrary } from "./loader";
import {
  GEOCODE_TTL_MS,
  cachedRequest,
  normalizeQuery,
  roundCoord,
} from "./requestCache";

export type GeocodeLocationOptions = {
  language?: string;
};

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

/** Reverse-geocode lat/lng; returns full Geocoder results (cached). */
export async function geocodeByLocation(
  lat: number,
  lon: number,
  options?: GeocodeLocationOptions
): Promise<google.maps.GeocoderResult[]> {
  const key = locationCacheKey(lat, lon, options);
  return cachedRequest(key, GEOCODE_TTL_MS, async () => {
    const { Geocoder } = await loadGeocodingLibrary();
    const geocoder = new Geocoder();
    const response = await geocoder.geocode({
      location: { lat, lng: lon },
      ...(options?.language ? { language: options.language } : {}),
    });
    return response.results ?? [];
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
    const response = await geocoder.geocode({
      address: trimmed,
      ...(options?.language ? { language: options.language } : {}),
      ...(country && /^[a-zA-Z]{2}$/.test(country)
        ? { componentRestrictions: { country: country.toUpperCase() } }
        : {}),
    });
    return response.results ?? [];
  });
}
