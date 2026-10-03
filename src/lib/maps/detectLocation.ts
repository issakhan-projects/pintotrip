import { countryIdFromParts, isAsciiId, slugifyId } from "@/lib/utils";
import { countryHasLocalityCoverage } from "./ddsCoverage";
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

/** Geocoder + Places address components (legacy long_name or new longText). */
export type AddressComponentLike = {
  types: string[];
  long_name?: string | null;
  short_name?: string | null;
  longText?: string | null;
  shortText?: string | null;
};

export type CityCountryParts = {
  city: string;
  country: string;
  countryCode: string;
};

function readComponent(
  components: AddressComponentLike[],
  type: string,
  short = false
): string {
  const match = components.find((c) => c.types.includes(type));
  if (!match) return "";
  if (short) {
    return (match.short_name || match.shortText || "").trim();
  }
  return (match.long_name || match.longText || "").trim();
}

/** Admin2 / labels that are districts, not the parent city. */
function isDistrictLikeName(name: string): boolean {
  return /\b(district|raion|rayon|municipality|borough|arrondissement|county|parish|okrug|округ|район|ilçe|ilce|adalar)\b/i.test(
    name.trim()
  );
}

/** Turkish island localities (Prince Islands: Kınalıada, Burgazada, …). */
function isTurkishIslandLocality(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  // Ada / Adası suffix — do not use English "island" (would mis-handle US place names).
  return /(ada|adası|adasi)$/i.test(n) || /^adalar$/i.test(n);
}

function samePlaceName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Pick the parent **city** (not district / island) for every country.
 * - No Google locality coverage (TR, KZ, RU, …): admin1 is the city we store.
 * - Locality coverage (US, JP, …): locality / postal_town, unless clearly a district.
 */
function pickCityName(parts: {
  locality: string;
  postalTown: string;
  admin2: string;
  admin1: string;
  countryCode: string;
  country: string;
}): string {
  const { locality, postalTown, admin2, admin1, countryCode, country } = parts;
  const usesLocality = countryHasLocalityCoverage(countryCode, country);

  // City-province / no-locality countries: admin1 is the stable city id/name.
  if (!usesLocality && admin1) return admin1;

  if (postalTown) return postalTown;

  if (locality) {
    const promoteToParent =
      Boolean(admin1) &&
      !samePlaceName(locality, admin1) &&
      (isDistrictLikeName(locality) ||
        isDistrictLikeName(admin2) ||
        isTurkishIslandLocality(locality) ||
        // District reused as locality (Fatih/Fatih) — promote to metro city.
        (Boolean(admin2) && samePlaceName(locality, admin2) && !usesLocality));
    if (promoteToParent) return admin1;
    return locality;
  }

  if (admin2 && !isDistrictLikeName(admin2)) return admin2;
  if (admin1) return admin1;
  if (admin2) return admin2;
  return "";
}

function collectCityCountryParts(
  results: Array<{
    types?: string[];
    address_components?: AddressComponentLike[];
  }>
): {
  locality: string;
  postalTown: string;
  admin2: string;
  admin1: string;
  country: string;
  countryCode: string;
} {
  let country = "";
  let countryCode = "";
  let locality = "";
  let postalTown = "";
  let admin2 = "";
  let admin1 = "";

  for (const result of results) {
    const components = result.address_components ?? [];
    if (!country) country = readComponent(components, "country");
    if (!countryCode) {
      countryCode = readComponent(components, "country", true).toUpperCase();
    }
    if (!locality) locality = readComponent(components, "locality");
    if (!postalTown) postalTown = readComponent(components, "postal_town");
    if (!admin2) {
      admin2 = readComponent(components, "administrative_area_level_2");
    }
    if (!admin1) {
      admin1 = readComponent(components, "administrative_area_level_1");
    }
  }

  for (const type of ["locality", "postal_town"] as const) {
    const match = results.find((result) => result.types?.includes(type));
    if (!match) continue;
    const components = match.address_components ?? [];
    locality =
      readComponent(components, "locality") ||
      readComponent(components, type) ||
      locality;
    postalTown = readComponent(components, "postal_town") || postalTown;
    admin2 =
      readComponent(components, "administrative_area_level_2") || admin2;
    admin1 =
      readComponent(components, "administrative_area_level_1") || admin1;
    break;
  }

  return { locality, postalTown, admin2, admin1, country, countryCode };
}

/**
 * City-level name from geocode/Places results (Istanbul, not Fatih / Kınalıada).
 */
export function cityCountryFromGeocodeResults(
  results: Array<{
    types?: string[];
    address_components?: AddressComponentLike[];
  }>
): CityCountryParts {
  if (!results.length) return { city: "", country: "", countryCode: "" };
  const parts = collectCityCountryParts(results);
  return {
    city: pickCityName(parts),
    country: parts.country,
    countryCode: parts.countryCode,
  };
}

/** City-level name from a single address_components list. */
export function cityCountryFromAddressComponents(
  components: AddressComponentLike[] | undefined
): CityCountryParts {
  if (!components?.length) return { city: "", country: "", countryCode: "" };
  return cityCountryFromGeocodeResults([{ address_components: components }]);
}

/** City selection with English/ASCII machine ids for Firestore. */
export type ResolvedCitySelection = {
  cityName: string;
  countryName: string;
  countryCode: string;
  cityId: string;
  countryId: string;
  lat: number;
  lon: number;
};

/**
 * Reverse-geocode a map pick to city-level name + English cityId/countryId.
 * Use for city intelligence, favorites, and any “select city” flow.
 */
export async function resolveCitySelectionFromCoords(
  lat: number,
  lon: number,
  options?: { language?: string }
): Promise<ResolvedCitySelection | null> {
  if (!hasUsableMapCoords(lat, lon)) return null;

  const place = await reverseGeocode(lat, lon, {
    language: options?.language ?? "en",
  });
  if (!place?.city && !place?.country) return null;

  const englishIds =
    englishPlaceIdsFromNames(
      place.city,
      place.country,
      place.countryCode
    ) ?? (await resolveEnglishPlaceIds(lat, lon));

  const countryName = englishIds?.countryNameEn || place.country || "";
  const cityName = englishIds?.cityNameEn || place.city || countryName;
  const countryCode =
    englishIds?.countryCode || place.countryCode?.toUpperCase() || "";
  const countryId = countryIdFromParts(
    englishIds?.countryNameEn || countryName,
    countryCode || null
  );
  const cityId =
    (englishIds?.cityId && isAsciiId(englishIds.cityId)
      ? englishIds.cityId
      : null) ||
    (isAsciiId(slugifyId(englishIds?.cityNameEn || ""))
      ? slugifyId(englishIds!.cityNameEn)
      : null) ||
    (isAsciiId(slugifyId(cityName)) ? slugifyId(cityName) : null);

  if (!isAsciiId(countryId) || !cityId) return null;

  return {
    cityName,
    countryName: countryName || cityName,
    countryCode: /^[A-Z]{2}$/.test(countryCode) ? countryCode : "",
    cityId,
    countryId,
    lat: place.lat,
    lon: place.lon,
  };
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
  const { city, country, countryCode } = cityCountryFromGeocodeResults(results);
  if (!city && !country) return null;
  return toEnglishPlaceIds(city, country, countryCode);
}

function getBrowserPosition(
  timeoutMs: number,
  maximumAge = 0,
  enableHighAccuracy = false
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation is not available."));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy,
      timeout: timeoutMs,
      maximumAge,
    });
  });
}

/** Browser lat/lng only — no reverse geocode. Returns null on deny/timeout. */
export async function getBrowserCoords(options?: {
  timeoutMs?: number;
  maximumAge?: number;
  enableHighAccuracy?: boolean;
}): Promise<{ lat: number; lon: number } | null> {
  try {
    const position = await getBrowserPosition(
      options?.timeoutMs ?? 8_000,
      options?.maximumAge ?? 60_000,
      options?.enableHighAccuracy ?? false
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
    const { city, country, countryCode } = cityCountryFromGeocodeResults(results);
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
