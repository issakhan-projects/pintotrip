import { loadPlacesLibrary } from "./loader";
import { geocodeByAddress, geocodeByLocation } from "./geocode";
import type { CityStatusEntry } from "./cityStatus";
import type { DdsFeatureType } from "./ddsCapabilities";
import {
  PLACES_SEARCH_TTL_MS,
  cachedRequest,
  clearMapsRequestCache,
  normalizeQuery,
  roundCoord,
} from "./requestCache";

export interface CityPlaceIdQuery {
  key: string;
  cityName: string;
  countryName: string;
  countryId?: string;
  /** Internal slug — NOT a Google Place ID. */
  cityId?: string;
  /** Stored locality Place ID from locations.city.googlePlaceId when present. */
  googlePlaceId?: string;
  lat?: number;
  lon?: number;
  /** Prefer a Place ID that matches this DDS feature layer. */
  featureType?: DdsFeatureType;
}

const placeIdCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();
const missingLogged = new Set<string>();

/**
 * Google Place IDs typically look like `ChIJ…`.
 * PinToTrip `location.city.id` is a slugifyId name (e.g. "istanbul") — not a Place ID.
 */
export function looksLikeGooglePlaceId(value: string | undefined | null): boolean {
  const v = value?.trim() ?? "";
  if (!v) return false;
  if (/^ChIJ[\w-]+$/.test(v)) return true;
  if (v.length >= 27 && /[A-Z]/.test(v) && /[a-z]/.test(v)) return true;
  return false;
}

function cacheKey(city: CityPlaceIdQuery): string {
  return `${city.key}:${city.featureType ?? "LOCALITY"}`;
}

function isoCountryCode(countryId?: string): string | undefined {
  const id = countryId?.trim();
  if (!id) return undefined;
  if (/^[a-zA-Z]{2}$/.test(id)) return id.toUpperCase();
  return undefined;
}

function placesIncludedType(featureType?: DdsFeatureType): string {
  if (featureType === "COUNTRY") return "country";
  if (featureType === "ADMINISTRATIVE_AREA_LEVEL_1") {
    return "administrative_area_level_1";
  }
  if (featureType === "ADMINISTRATIVE_AREA_LEVEL_2") {
    return "administrative_area_level_2";
  }
  return "locality";
}

/**
 * Types that match a DDS Feature Layer Place ID.
 * Never fall back across incompatible layers (locality ≠ country, etc.).
 */
function matchingGeocodeTypes(featureType?: DdsFeatureType): string[] {
  if (featureType === "COUNTRY") {
    return ["country"];
  }
  if (featureType === "ADMINISTRATIVE_AREA_LEVEL_1") {
    return ["administrative_area_level_1"];
  }
  if (featureType === "ADMINISTRATIVE_AREA_LEVEL_2") {
    return ["administrative_area_level_2"];
  }
  return [
    "locality",
    "postal_town",
    "administrative_area_level_3",
    "administrative_area_level_2",
  ];
}

function pickPlaceIdByTypes(
  results: Array<{ place_id?: string; types?: string[] }>,
  preferredTypes: string[]
): string | null {
  for (const type of preferredTypes) {
    const match = results.find((r) => r.types?.includes(type));
    const placeId = match?.place_id?.trim();
    if (placeId) return placeId;
  }
  return null;
}

function logMissingPlaceId(city: CityPlaceIdQuery, reason: string): void {
  if (missingLogged.has(city.key)) return;
  missingLogged.add(city.key);
  console.error(
    `[PinToTrip DDS] City Google Place ID is missing for "${city.cityName}" (${city.countryName}). ${reason}`,
    {
      key: city.key,
      cityId: city.cityId,
      featureType: city.featureType ?? "LOCALITY",
      note: "location.city.id is a slug, not a Google Place ID",
    }
  );
}

/**
 * Reverse-geocode at lat/lng and pick a result whose types match the DDS layer.
 * Uses language=en so the response is shared with resolveEnglishPlaceIds.
 */
async function resolveViaReverseGeocode(
  city: CityPlaceIdQuery
): Promise<string | null> {
  if (city.lat == null || city.lon == null) return null;

  const results = await geocodeByLocation(city.lat, city.lon, {
    language: "en",
  });

  const placeId = pickPlaceIdByTypes(
    results,
    matchingGeocodeTypes(city.featureType)
  );

  if (placeId) {
    const matched = results.find(
      (r: { place_id?: string; types?: string[]; formatted_address?: string }) =>
        r.place_id === placeId
    );
    console.info(
      `[PinToTrip DDS] Reverse-geocode Place ID for "${city.cityName}":`,
      placeId,
      matched?.types,
      matched?.formatted_address
    );
  }

  return placeId;
}

async function resolveViaPlaces(
  city: CityPlaceIdQuery
): Promise<string | null> {
  const isCountry = city.featureType === "COUNTRY";
  const primaryName = isCountry
    ? city.countryName.trim()
    : city.cityName.trim();
  if (!primaryName) return null;

  const textQuery = isCountry
    ? primaryName
    : [primaryName, city.countryName.trim()].filter(Boolean).join(", ");
  const includedType = placesIncludedType(city.featureType);
  const bias =
    city.lat != null && city.lon != null
      ? `${roundCoord(city.lat)},${roundCoord(city.lon)}`
      : "";
  const searchKey = `places:text:${normalizeQuery(textQuery)}:${includedType}:${bias}`;

  return cachedRequest(searchKey, PLACES_SEARCH_TTL_MS, async () => {
    const { Place } = await loadPlacesLibrary();
    const request = {
      textQuery,
      fields: ["id", "location", "displayName"],
      includedType,
      maxResultCount: 1,
      ...(city.lat != null && city.lon != null
        ? { locationBias: { lat: city.lat, lng: city.lon } }
        : {}),
    };

    const { places } = await Place.searchByText(request);
    const id = places[0]?.id?.trim();
    return id || null;
  });
}

async function resolveViaGeocoder(
  city: CityPlaceIdQuery
): Promise<string | null> {
  const isCountry = city.featureType === "COUNTRY";
  const primaryName = isCountry
    ? city.countryName.trim()
    : city.cityName.trim();
  if (!primaryName) return null;

  const address = isCountry
    ? primaryName
    : [primaryName, city.countryName.trim()].filter(Boolean).join(", ");
  const country = isoCountryCode(city.countryId);

  const results = await geocodeByAddress(address, {
    language: "en",
    country,
  });

  return pickPlaceIdByTypes(results, matchingGeocodeTypes(city.featureType));
}

/**
 * Resolve a Google Place ID for a city or country boundary.
 * Prefers `city.googlePlaceId` from the locations collection (LOCALITY only).
 * Never treats `location.city.id` (slug) as a Google Place ID.
 */
export async function resolveCityGooglePlaceId(
  city: CityPlaceIdQuery
): Promise<string | null> {
  // Stored Place IDs are locality IDs from create flows — only reuse for LOCALITY.
  if (
    (!city.featureType || city.featureType === "LOCALITY") &&
    looksLikeGooglePlaceId(city.googlePlaceId)
  ) {
    return city.googlePlaceId!.trim();
  }

  const key = cacheKey(city);
  const cached = placeIdCache.get(key);
  if (cached) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const label =
    city.featureType === "COUNTRY" ? city.countryName : city.cityName;

  const request = (async (): Promise<string | null> => {
    // Reverse geocode first when coords exist — matches DDS Feature Layer IDs.
    if (city.lat != null && city.lon != null) {
      try {
        const fromReverse = await resolveViaReverseGeocode(city);
        if (fromReverse) {
          placeIdCache.set(key, fromReverse);
          return fromReverse;
        }
      } catch (err) {
        console.warn(
          `[PinToTrip DDS] Reverse geocode failed for "${label}". Trying Places/Geocoder.`,
          err
        );
      }
    }

    try {
      const fromPlaces = await resolveViaPlaces(city);
      if (fromPlaces) {
        placeIdCache.set(key, fromPlaces);
        return fromPlaces;
      }
    } catch (err) {
      console.warn(
        `[PinToTrip DDS] Places Text Search failed for "${label}". Falling back to Geocoder.`,
        err
      );
    }

    try {
      const fromGeocoder = await resolveViaGeocoder(city);
      if (fromGeocoder) {
        placeIdCache.set(key, fromGeocoder);
        return fromGeocoder;
      }
    } catch (err) {
      console.warn(
        `[PinToTrip DDS] Geocoder Place ID lookup failed for "${label}".`,
        err
      );
    }

    logMissingPlaceId(
      city,
      "Reverse geocode, Places Text Search, and Geocoder returned no matching place_id for the requested feature type."
    );
    return null;
  })();

  inflight.set(key, request);
  try {
    return await request;
  } finally {
    inflight.delete(key);
  }
}

/** @deprecated Prefer resolveCityGooglePlaceId */
export async function getCityBoundary(
  city: CityPlaceIdQuery
): Promise<{ key: string; placeId: string } | null> {
  const placeId = await resolveCityGooglePlaceId(city);
  if (!placeId) return null;
  return { key: city.key, placeId };
}

export function cityPlaceIdQueryFromStatus(
  entry: CityStatusEntry
): CityPlaceIdQuery {
  return {
    key: entry.key,
    cityName: entry.cityName,
    countryName: entry.countryName,
    countryId: entry.countryId,
    cityId: entry.cityId,
    googlePlaceId: entry.googlePlaceId,
    lat: entry.lat,
    lon: entry.lon,
  };
}

export function clearCityPlaceIdCache(): void {
  placeIdCache.clear();
  inflight.clear();
  missingLogged.clear();
  clearMapsRequestCache();
}
