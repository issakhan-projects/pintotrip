import { loadPlacesLibrary } from "./loader";
import { geocodeByAddress, geocodeByLocation, hasUsableMapCoords } from "./geocode";
import type { CityStatusEntry } from "./cityStatus";
import type { DdsFeatureType } from "./ddsCapabilities";
import {
  PLACES_SEARCH_TTL_MS,
  cachedRequest,
  clearMapsRequestCache,
  normalizeQuery,
  roundCoord,
} from "./requestCache";
import { trackPlacesApiCacheHit, trackPlacesApiNetwork } from "./placesApiUsage";
import { devLog } from "@/lib/devLog";

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

type GeocodeResultLike = {
  place_id?: string;
  types?: string[];
  address_components?: Array<{ long_name?: string; types: string[] }>;
  formatted_address?: string;
};

function pickPlaceIdByTypes(
  results: GeocodeResultLike[],
  preferredTypes: string[]
): string | null {
  for (const type of preferredTypes) {
    const match = results.find((r) => r.types?.includes(type));
    const placeId = match?.place_id?.trim();
    if (placeId) return placeId;
  }
  return null;
}

function resultsHavePlaceId(results: GeocodeResultLike[]): boolean {
  return results.some((r) => Boolean(r.place_id?.trim()));
}

/** Admin / country type string used in Geocoder address_components. */
function geocodeComponentType(
  featureType?: DdsFeatureType
): string | null {
  if (featureType === "COUNTRY") return "country";
  if (featureType === "ADMINISTRATIVE_AREA_LEVEL_1") {
    return "administrative_area_level_1";
  }
  if (featureType === "ADMINISTRATIVE_AREA_LEVEL_2") {
    return "administrative_area_level_2";
  }
  return null;
}

/**
 * City geocodes often return a locality result whose `types` do not include
 * Admin1/Admin2, but `address_components` still name the containing region.
 */
function componentLongName(
  results: GeocodeResultLike[],
  componentType: string
): string | null {
  for (const result of results) {
    const comp = result.address_components?.find((c) =>
      c.types.includes(componentType)
    );
    const name = comp?.long_name?.trim();
    if (name) return name;
  }
  return null;
}

function logMissingPlaceId(city: CityPlaceIdQuery, reason: string): void {
  if (missingLogged.has(city.key)) return;
  missingLogged.add(city.key);
  devLog.error(
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
): Promise<{
  placeId: string | null;
  hadPlaceIds: boolean;
  results: GeocodeResultLike[];
}> {
  if (!hasUsableMapCoords(city.lat, city.lon)) {
    return { placeId: null, hadPlaceIds: false, results: [] };
  }
  const lat = city.lat as number;
  const lon = city.lon as number;

  const results = await geocodeByLocation(lat, lon, {
    language: "en",
  });
  const hadPlaceIds = resultsHavePlaceId(results);
  const placeId = pickPlaceIdByTypes(
    results,
    matchingGeocodeTypes(city.featureType)
  );

  return { placeId, hadPlaceIds, results };
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

  return cachedRequest(
    searchKey,
    PLACES_SEARCH_TTL_MS,
    async () => {
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
    },
    {
      onNetworkFetch: () =>
        trackPlacesApiNetwork({
          kind: "textSearch",
          source: "maps/cityPlaceId",
          detail: {
            query: textQuery,
            includedType,
            cityKey: city.key,
          },
        }),
      onCacheHit: () =>
        trackPlacesApiCacheHit({
          kind: "textSearch",
          source: "maps/cityPlaceId",
          detail: {
            query: textQuery,
            includedType,
            cityKey: city.key,
          },
        }),
    }
  );
}

async function resolveViaGeocoder(
  city: CityPlaceIdQuery
): Promise<{
  placeId: string | null;
  hadPlaceIds: boolean;
  results: GeocodeResultLike[];
}> {
  const isCountry = city.featureType === "COUNTRY";
  const primaryName = isCountry
    ? city.countryName.trim()
    : city.cityName.trim();
  if (!primaryName) {
    return { placeId: null, hadPlaceIds: false, results: [] };
  }

  const address = isCountry
    ? primaryName
    : [primaryName, city.countryName.trim()].filter(Boolean).join(", ");
  const country = isoCountryCode(city.countryId);

  const results = await geocodeByAddress(address, {
    language: "en",
    country,
  });

  return {
    placeId: pickPlaceIdByTypes(results, matchingGeocodeTypes(city.featureType)),
    hadPlaceIds: resultsHavePlaceId(results),
    results,
  };
}

/**
 * When DDS needs Admin1/Admin2 but geocode returned a locality (e.g. Ella, LK),
 * re-geocode the containing region named in address_components.
 */
async function resolveViaContainingAdmin(
  city: CityPlaceIdQuery,
  priorResults: GeocodeResultLike[]
): Promise<string | null> {
  const componentType = geocodeComponentType(city.featureType);
  if (
    !componentType ||
    componentType === "country" ||
    priorResults.length === 0
  ) {
    return null;
  }

  const adminName = componentLongName(priorResults, componentType);
  if (!adminName) return null;

  // Same query as the city name would not help (already tried).
  if (
    normalizeQuery(adminName) === normalizeQuery(city.cityName) ||
    normalizeQuery(adminName) === normalizeQuery(city.countryName)
  ) {
    return null;
  }

  const address = [adminName, city.countryName.trim()]
    .filter(Boolean)
    .join(", ");
  const results = await geocodeByAddress(address, {
    language: "en",
    country: isoCountryCode(city.countryId),
  });
  return pickPlaceIdByTypes(results, matchingGeocodeTypes(city.featureType));
}

/**
 * Resolve a Google Place ID for a city or country boundary.
 * Prefers `city.googlePlaceId` from the locations collection (LOCALITY only).
 * Never treats `location.city.id` (slug) as a Google Place ID.
 *
 * Order: stored id → reverse geocode → forward geocode → Places Text Search
 * (Places only when geocoding returned no place_id at all).
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
    let geocodeHadPlaceIds = false;
    let lastResults: GeocodeResultLike[] = [];

    // Reverse geocode first when coords exist — matches DDS Feature Layer IDs.
    if (hasUsableMapCoords(city.lat, city.lon)) {
      try {
        const fromReverse = await resolveViaReverseGeocode(city);
        if (fromReverse.hadPlaceIds) geocodeHadPlaceIds = true;
        if (fromReverse.results.length) lastResults = fromReverse.results;
        if (fromReverse.placeId) {
          placeIdCache.set(key, fromReverse.placeId);
          return fromReverse.placeId;
        }
      } catch (err) {
        devLog.warn(
          `[PinToTrip DDS] Reverse geocode failed for "${label}". Trying forward geocode.`,
          err
        );
      }
    }

    try {
      const fromGeocoder = await resolveViaGeocoder(city);
      if (fromGeocoder.hadPlaceIds) geocodeHadPlaceIds = true;
      if (fromGeocoder.results.length) lastResults = fromGeocoder.results;
      if (fromGeocoder.placeId) {
        placeIdCache.set(key, fromGeocoder.placeId);
        return fromGeocoder.placeId;
      }
    } catch (err) {
      devLog.warn(
        `[PinToTrip DDS] Geocoder Place ID lookup failed for "${label}".`,
        err
      );
    }

    // Locality geocode → containing Admin1/Admin2 named in address_components.
    if (lastResults.length > 0) {
      try {
        const fromAdmin = await resolveViaContainingAdmin(city, lastResults);
        if (fromAdmin) {
          placeIdCache.set(key, fromAdmin);
          return fromAdmin;
        }
      } catch (err) {
        devLog.warn(
          `[PinToTrip DDS] Containing-admin Place ID lookup failed for "${label}".`,
          err
        );
      }
    }

    // Geocoding already returned place_id(s) — type just didn't match the DDS
    // layer. Skip Places Text Search; callers fall back to country highlight.
    if (geocodeHadPlaceIds) {
      logMissingPlaceId(
        city,
        "Geocode returned place_id(s) but none matched the requested feature type; skipped Places Text Search."
      );
      return null;
    }

    try {
      const fromPlaces = await resolveViaPlaces(city);
      if (fromPlaces) {
        placeIdCache.set(key, fromPlaces);
        return fromPlaces;
      }
    } catch (err) {
      devLog.warn(
        `[PinToTrip DDS] Places Text Search failed for "${label}".`,
        err
      );
    }

    logMissingPlaceId(
      city,
      "Reverse geocode, forward geocode, and Places Text Search returned no matching place_id for the requested feature type."
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
