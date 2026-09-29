/**
 * Google Places Nearby Search (New) + Text Search for Around Me.
 *
 * Hard geographic filter is mandatory — Text Search soft bias alone often
 * returns popular US places when the query lacks a city name.
 */

import { logger } from "firebase-functions";
import { googlePrivateApiKey } from "../shared/config";
import {
  AROUND_ME_SEARCH,
  aroundMeTypeLabel,
  DEFAULT_AROUND_ME_RADIUS_KM,
  type AroundMeRadiusKm,
  type AroundMeTypeId,
} from "./aroundMeTypes";

const NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.formattedAddress",
  "places.types",
  "places.googleMapsUri",
  "places.rating",
  "places.userRatingCount",
].join(",");

/** Final results returned to the client / GPT. */
export const AROUND_ME_MAX_RESULTS = 7;
/** Ask Places for a wider pool, then rank + filter down. */
const PLACES_FETCH_COUNT = 20;

export type NearbyPlaceHit = {
  googlePlaceId: string;
  title: string;
  lat: number;
  lon: number;
  address?: string;
  types?: string[];
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  /** Meters from the search center. */
  distanceM?: number;
};

type PlacesApiPlace = {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  formattedAddress?: string;
  types?: string[];
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
};

type PlacesApiResponse = {
  places?: PlacesApiPlace[];
  error?: { message?: string };
};

function radiusMeters(radiusKm: AroundMeRadiusKm): number {
  return radiusKm * 1_000;
}

function haversineM(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Bounding box for Text Search hard locationRestriction. */
function circleToRectangle(
  lat: number,
  lon: number,
  radiusM: number
): {
  low: { latitude: number; longitude: number };
  high: { latitude: number; longitude: number };
} {
  const latDelta = radiusM / 111_320;
  const lonDelta =
    radiusM / (111_320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.2));
  return {
    low: { latitude: lat - latDelta, longitude: lon - lonDelta },
    high: { latitude: lat + latDelta, longitude: lon + lonDelta },
  };
}

function interestScore(place: NearbyPlaceHit, maxDistanceM: number): number {
  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;
  const reviewFactor = Math.log10(reviews + 1);
  const distancePenalty =
    typeof place.distanceM === "number"
      ? Math.min(place.distanceM, maxDistanceM) / maxDistanceM
      : 0.5;
  return rating * reviewFactor * (1.15 - distancePenalty * 0.3);
}

function normalizePlace(
  place: PlacesApiPlace,
  center: { lat: number; lon: number },
  maxDistanceM: number
): NearbyPlaceHit | null {
  const googlePlaceId =
    typeof place.id === "string" && place.id.trim()
      ? place.id.trim().replace(/^places\//, "")
      : "";
  const title =
    typeof place.displayName?.text === "string"
      ? place.displayName.text.trim()
      : "";
  const lat = place.location?.latitude;
  const lon = place.location?.longitude;
  if (
    !googlePlaceId ||
    !title ||
    typeof lat !== "number" ||
    !Number.isFinite(lat) ||
    typeof lon !== "number" ||
    !Number.isFinite(lon)
  ) {
    return null;
  }

  const distanceM = haversineM(center, { lat, lon });
  if (distanceM > maxDistanceM) {
    return null;
  }

  const address =
    typeof place.formattedAddress === "string" && place.formattedAddress.trim()
      ? place.formattedAddress.trim()
      : undefined;
  const types = Array.isArray(place.types)
    ? place.types.filter((t): t is string => typeof t === "string" && Boolean(t))
    : undefined;
  const googleMapsUri =
    typeof place.googleMapsUri === "string" && place.googleMapsUri.trim()
      ? place.googleMapsUri.trim()
      : undefined;
  const rating =
    typeof place.rating === "number" && Number.isFinite(place.rating)
      ? place.rating
      : undefined;
  const userRatingCount =
    typeof place.userRatingCount === "number" &&
    Number.isFinite(place.userRatingCount)
      ? place.userRatingCount
      : undefined;

  return {
    googlePlaceId,
    title,
    lat,
    lon,
    distanceM,
    ...(address ? { address } : {}),
    ...(types && types.length > 0 ? { types } : {}),
    ...(googleMapsUri ? { googleMapsUri } : {}),
    ...(rating !== undefined ? { rating } : {}),
    ...(userRatingCount !== undefined ? { userRatingCount } : {}),
  };
}

function dedupeByPlaceId(places: NearbyPlaceHit[]): NearbyPlaceHit[] {
  const seen = new Set<string>();
  const out: NearbyPlaceHit[] = [];
  for (const place of places) {
    if (seen.has(place.googlePlaceId)) continue;
    seen.add(place.googlePlaceId);
    out.push(place);
  }
  return out;
}

function rankAndTrim(
  places: NearbyPlaceHit[],
  maxDistanceM: number
): NearbyPlaceHit[] {
  return dedupeByPlaceId(places)
    .sort(
      (a, b) =>
        interestScore(b, maxDistanceM) - interestScore(a, maxDistanceM)
    )
    .slice(0, AROUND_ME_MAX_RESULTS);
}

async function postPlaces(
  url: string,
  body: Record<string, unknown>,
  center: { lat: number; lon: number },
  maxDistanceM: number
): Promise<NearbyPlaceHit[]> {
  const apiKey = googlePrivateApiKey.value();
  if (!apiKey) {
    throw new Error("GOOGLE_PRIVATE_API_KEY secret is not configured");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json()) as PlacesApiResponse;
  if (!response.ok) {
    const message =
      json.error?.message || `Places search failed (${response.status})`;
    throw new Error(message);
  }

  const places = Array.isArray(json.places) ? json.places : [];
  const normalized: NearbyPlaceHit[] = [];
  for (const place of places) {
    const hit = normalizePlace(place, center, maxDistanceM);
    if (hit) normalized.push(hit);
  }
  return normalized;
}

async function searchNearby(input: {
  lat: number;
  lon: number;
  includedTypes: string[];
  radiusM: number;
}): Promise<NearbyPlaceHit[]> {
  const body: Record<string, unknown> = {
    maxResultCount: PLACES_FETCH_COUNT,
    languageCode: "en",
    rankPreference: "POPULARITY",
    locationRestriction: {
      circle: {
        center: { latitude: input.lat, longitude: input.lon },
        radius: input.radiusM,
      },
    },
  };
  if (input.includedTypes.length > 0) {
    body.includedTypes = input.includedTypes;
  }

  return postPlaces(
    NEARBY_URL,
    body,
    { lat: input.lat, lon: input.lon },
    input.radiusM
  );
}

async function searchText(input: {
  lat: number;
  lon: number;
  textQuery: string;
  includedType?: string;
  radiusM: number;
}): Promise<NearbyPlaceHit[]> {
  const body: Record<string, unknown> = {
    textQuery: input.textQuery,
    maxResultCount: PLACES_FETCH_COUNT,
    languageCode: "en",
    locationRestriction: {
      rectangle: circleToRectangle(input.lat, input.lon, input.radiusM),
    },
  };
  if (input.includedType) {
    body.includedType = input.includedType;
  }

  return postPlaces(
    TEXT_SEARCH_URL,
    body,
    { lat: input.lat, lon: input.lon },
    input.radiusM
  );
}

function buildLocalTextQuery(
  noun: string,
  cityName?: string,
  countryName?: string
): string {
  const city = cityName?.trim();
  const country = countryName?.trim();
  if (city && country) return `${noun} in ${city}, ${country}`;
  if (city) return `${noun} in ${city}`;
  return noun;
}

/**
 * Find up to 7 interesting places near lat/lon for the given Around Me type.
 * Always hard-filters by distance and ranks by rating × review volume.
 */
export async function nearbySearchAroundMe(input: {
  lat: number;
  lon: number;
  typeId: AroundMeTypeId;
  radiusKm?: AroundMeRadiusKm;
  cityName?: string;
  countryName?: string;
}): Promise<NearbyPlaceHit[]> {
  const radiusKm = input.radiusKm ?? DEFAULT_AROUND_ME_RADIUS_KM;
  const radiusM = radiusMeters(radiusKm);
  const strategy = AROUND_ME_SEARCH[input.typeId];
  let hits: NearbyPlaceHit[] = [];
  const label = aroundMeTypeLabel(input.typeId);
  const localQuery = buildLocalTextQuery(
    strategy.mode === "text" ? strategy.textQuery : label,
    input.cityName,
    input.countryName
  );

  try {
    if (strategy.mode === "nearby") {
      hits = await searchNearby({
        lat: input.lat,
        lon: input.lon,
        includedTypes: strategy.includedTypes,
        radiusM,
      });
    } else {
      hits = await searchText({
        lat: input.lat,
        lon: input.lon,
        textQuery: localQuery,
        includedType: strategy.includedType,
        radiusM,
      });
    }
  } catch (err) {
    logger.warn("nearbySearchAroundMe primary search failed", {
      typeId: input.typeId,
      mode: strategy.mode,
      lat: input.lat,
      lon: input.lon,
      radiusKm,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (hits.length === 0) {
    try {
      hits = await searchText({
        lat: input.lat,
        lon: input.lon,
        textQuery: buildLocalTextQuery(
          `best ${label}`,
          input.cityName,
          input.countryName
        ),
        radiusM,
      });
    } catch (err) {
      logger.warn("nearbySearchAroundMe fallback search failed", {
        typeId: input.typeId,
        radiusKm,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const ranked = rankAndTrim(hits, radiusM);

  logger.info("nearbySearchAroundMe", {
    typeId: input.typeId,
    mode: strategy.mode,
    lat: input.lat,
    lon: input.lon,
    radiusKm,
    cityName: input.cityName,
    countryName: input.countryName,
    rawCount: hits.length,
    resultCount: ranked.length,
    topTitles: ranked.slice(0, 3).map((h) => h.title),
  });

  return ranked;
}
