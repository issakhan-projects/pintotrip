import { countryIdFromParts, isAsciiId, slugifyId } from "@/lib/utils";
import {
  geocodeByAddress,
  geocodeByLocation,
  hasUsableMapCoords,
  peekGeocodeByAddress,
  peekGeocodeByLocation,
} from "./geocode";

export interface DetectedUserLocation {
  lat: number;
  lon: number;
  city: string;
  country: string;
  /** ISO 3166-1 alpha-2 when available. */
  countryCode?: string;
}

export interface EnglishPlaceIds {
  cityId: string;
  countryId: string;
  countryCode: string;
  cityNameEn: string;
  countryNameEn: string;
}

function readComponent(
  components: google.maps.GeocoderAddressComponent[],
  type: string,
  short = false
): string {
  const match = components.find((c) => c.types.includes(type));
  if (!match) return "";
  return (short ? match.short_name : match.long_name)?.trim() ?? "";
}

function parseCityCountry(
  components: google.maps.GeocoderAddressComponent[]
): { city: string; country: string; countryCode: string } {
  const country = readComponent(components, "country");
  const countryCode = readComponent(components, "country", true).toUpperCase();
  const city =
    readComponent(components, "locality") ||
    readComponent(components, "postal_town") ||
    readComponent(components, "administrative_area_level_2") ||
    readComponent(components, "administrative_area_level_1");

  return { city, country, countryCode };
}

function toEnglishPlaceIds(
  city: string,
  country: string,
  countryCode: string
): EnglishPlaceIds | null {
  const code = countryCode.toUpperCase();
  const countryId = countryIdFromParts(country, code || null);
  const cityTrimmed = city.trim();
  const cityId = cityTrimmed ? slugifyId(cityTrimmed) : "";

  if (cityTrimmed && !isAsciiId(cityId)) return null;
  if (!isAsciiId(countryId)) return null;

  return {
    cityId: cityId || countryId,
    countryId,
    countryCode: /^[A-Z]{2}$/.test(code) ? code : "",
    cityNameEn: cityTrimmed || country,
    countryNameEn: country,
  };
}

/**
 * Build English/ASCII ids from display names when they already slugify cleanly.
 * Skips Geocoding when the caller already has Latin city/country (+ optional ISO code).
 */
export function englishPlaceIdsFromNames(
  cityName: string,
  countryName: string,
  countryCode?: string | null
): EnglishPlaceIds | null {
  return toEnglishPlaceIds(
    cityName,
    countryName,
    (countryCode ?? "").toUpperCase()
  );
}

function englishIdsFromGeocodeResults(
  results: google.maps.GeocoderResult[] | undefined
): EnglishPlaceIds | null {
  if (!results?.length) return null;
  const components = results[0]?.address_components ?? [];
  const { city, country, countryCode } = parseCityCountry(components);
  if (!city && !country) return null;
  return toEnglishPlaceIds(city, country, countryCode);
}

function getBrowserPosition(
  timeoutMs: number,
  maximumAge = 0
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation is not available."));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: timeoutMs,
      maximumAge,
    });
  });
}

/** Browser lat/lng only — no reverse geocode. Returns null on deny/timeout. */
export async function getBrowserCoords(options?: {
  timeoutMs?: number;
  maximumAge?: number;
}): Promise<{ lat: number; lon: number } | null> {
  try {
    const position = await getBrowserPosition(
      options?.timeoutMs ?? 8_000,
      options?.maximumAge ?? 60_000
    );
    return {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
    };
  } catch {
    return null;
  }
}

/** Reverse-geocode coordinates to city / country. */
export async function reverseGeocode(
  lat: number,
  lon: number,
  options?: { language?: string }
): Promise<DetectedUserLocation | null> {
  try {
    const results = await geocodeByLocation(lat, lon, options);
    const components = results[0]?.address_components ?? [];
    const { city, country, countryCode } = parseCityCountry(components);
    if (!city && !country) return null;

    return {
      lat,
      lon,
      city,
      country,
      ...(countryCode && /^[A-Z]{2}$/.test(countryCode)
        ? { countryCode }
        : {}),
    };
  } catch {
    return null;
  }
}

/** Prefer locality geometry so the map pins the city, not the street. */
const CITY_LEVEL_TYPES = [
  "locality",
  "postal_town",
  "administrative_area_level_2",
  "administrative_area_level_1",
] as const;

function cityCenterFromResults(
  results: google.maps.GeocoderResult[]
): { lat: number; lon: number } | null {
  for (const type of CITY_LEVEL_TYPES) {
    const match = results.find((result) => result.types.includes(type));
    const location = match?.geometry?.location;
    if (!location) continue;
    const lat = location.lat();
    const lon = location.lng();
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat, lon };
    }
  }
  return null;
}

/**
 * Browser GPS snapped to city-center coordinates (locality / town).
 * Falls back to raw GPS when reverse geocode fails.
 * Uses language=en so the response shares cache with resolveEnglishPlaceIds /
 * DDS Place ID lookup (geometry does not depend on localized names).
 */
export async function getBrowserCityCoords(options?: {
  timeoutMs?: number;
  maximumAge?: number;
}): Promise<{ lat: number; lon: number } | null> {
  const coords = await getBrowserCoords(options);
  if (!coords) return null;

  try {
    const results = await geocodeByLocation(coords.lat, coords.lon, {
      language: "en",
    });
    return cityCenterFromResults(results) ?? coords;
  } catch {
    return coords;
  }
}

/**
 * Resolve English/ASCII city + country ids via reverse geocode (language=en).
 * Use when AI returns localized display names but machine ids are missing.
 * Shares the same cached geocode response as DDS Place ID resolution (also language=en).
 * Reuses a prior browser-locale ("default") reverse geocode when names already ASCII.
 */
export async function resolveEnglishPlaceIds(
  lat: number,
  lon: number
): Promise<EnglishPlaceIds | null> {
  if (!hasUsableMapCoords(lat, lon)) return null;

  const fromDefault = englishIdsFromGeocodeResults(
    peekGeocodeByLocation(lat, lon)
  );
  if (fromDefault) return fromDefault;

  const fromEnCache = englishIdsFromGeocodeResults(
    peekGeocodeByLocation(lat, lon, { language: "en" })
  );
  if (fromEnCache) return fromEnCache;

  const place = await reverseGeocode(lat, lon, { language: "en" });
  if (!place) return null;

  return toEnglishPlaceIds(
    place.city,
    place.country,
    place.countryCode?.toUpperCase() ?? ""
  );
}

/**
 * Resolve English/ASCII city + country ids via forward geocode (language=en).
 * Useful for free-text "traveling from" fields with localized names.
 */
export async function resolveEnglishPlaceIdsFromAddress(
  address: string
): Promise<EnglishPlaceIds | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const fromDefault = englishIdsFromGeocodeResults(
    peekGeocodeByAddress(trimmed)
  );
  if (fromDefault) return fromDefault;

  const fromEnCache = englishIdsFromGeocodeResults(
    peekGeocodeByAddress(trimmed, { language: "en" })
  );
  if (fromEnCache) return fromEnCache;

  try {
    const results = await geocodeByAddress(trimmed, { language: "en" });
    return englishIdsFromGeocodeResults(results);
  } catch {
    return null;
  }
}

/**
 * Best-effort browser geolocation + reverse geocode.
 * Returns null if permission is denied, timed out, or geocoding fails.
 */
export async function detectUserLocation(options?: {
  timeoutMs?: number;
}): Promise<DetectedUserLocation | null> {
  const timeoutMs = options?.timeoutMs ?? 8_000;

  try {
    const position = await getBrowserPosition(timeoutMs);
    return reverseGeocode(
      position.coords.latitude,
      position.coords.longitude
    );
  } catch {
    return null;
  }
}
