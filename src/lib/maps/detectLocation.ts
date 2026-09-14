import { countryIdFromParts, isAsciiId, slugifyId } from "@/lib/utils";
import { geocodeByAddress, geocodeByLocation } from "./geocode";

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

/**
 * Resolve English/ASCII city + country ids via reverse geocode (language=en).
 * Use when AI returns localized display names but machine ids are missing.
 * Shares the same cached geocode response as DDS Place ID resolution (also language=en).
 */
export async function resolveEnglishPlaceIds(
  lat: number,
  lon: number
): Promise<EnglishPlaceIds | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // 0,0 is almost never a real trip destination — treat as missing coords.
  if (lat === 0 && lon === 0) return null;

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

  try {
    const results = await geocodeByAddress(trimmed, { language: "en" });
    const components = results[0]?.address_components ?? [];
    const { city, country, countryCode } = parseCityCountry(components);
    if (!city && !country) return null;
    return toEnglishPlaceIds(city, country, countryCode);
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
