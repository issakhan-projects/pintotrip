/**
 * After findPlace AI identification, pin exact lat/lon:
 * 1) placesLocation cache (countryId + cityId + ascii place slug)
 * 2) Google Places Text Search (New) on miss → save to placesLocation
 * Soft-fails: keep AI coords when cache and Places miss.
 */

import { logger } from "firebase-functions";
import { googlePrivateApiKey } from "../shared/config";
import { resolveEnglishPlaceIdsFromCoords } from "../shared/resolveEnglishPlaceIds";
import {
  getPlaceLocation,
  resolvePlaceDocId,
  resolvePlacesLocationIds,
  setPlaceLocation,
  type PlacesLocationIds,
} from "../shared/placesLocation";
import type { AnalyzeLocationResult } from "./types";

const PLACES_TEXT_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchText";

const TEXT_SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.formattedAddress",
].join(",");

const MAX_RESULTS = 3;
const BIAS_RADIUS_M = 45_000;
const MAX_DISTANCE_FROM_BIAS_KM = 80;

type PlacesApiPlace = {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  formattedAddress?: string;
};

type PlacesApiResponse = {
  places?: PlacesApiPlace[];
  error?: { message?: string };
};

type PlacesHit = {
  lat: number;
  lon: number;
  googlePlaceId?: string;
  titleEn?: string;
  address?: string;
};

function isValidCoord(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    !(lat === 0 && lon === 0)
  );
}

function haversineKm(
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
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function normalizeGooglePlaceId(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  return value.trim().replace(/^places\//, "");
}

function biasFromResult(
  result: AnalyzeLocationResult
): { lat: number; lon: number } | undefined {
  if (!isValidCoord(result.lat, result.lon)) return undefined;
  return { lat: result.lat, lon: result.lon };
}

function buildTextQuery(
  result: AnalyzeLocationResult,
  placeDocId: string
): string {
  const title = result.title.trim();
  const city = result.city.trim();
  const country = result.country.trim();
  const hasLatinTitle = /[A-Za-z]/.test(title);

  if (hasLatinTitle) {
    if (city && country) return `${title}, ${city}, ${country}`;
    if (city) return `${title}, ${city}`;
    return title;
  }

  const slugWords = placeDocId.replace(/-/g, " ").trim();
  const namePart = slugWords || title;
  const cityId = result.cityId?.trim() || "";
  const countryId = result.countryId?.trim().toUpperCase() || "";
  if (cityId && countryId) return `${namePart}, ${cityId}, ${countryId}`;
  if (cityId) return `${namePart}, ${cityId}`;
  if (city && country) return `${namePart}, ${city}, ${country}`;
  return namePart;
}

function pickBestPlace(
  places: PlacesApiPlace[],
  bias: { lat: number; lon: number } | undefined
): PlacesHit | null {
  const candidates: PlacesHit[] = [];
  for (const place of places) {
    const lat = place.location?.latitude;
    const lon = place.location?.longitude;
    if (
      typeof lat !== "number" ||
      !Number.isFinite(lat) ||
      typeof lon !== "number" ||
      !Number.isFinite(lon)
    ) {
      continue;
    }
    if (bias && haversineKm(bias, { lat, lon }) > MAX_DISTANCE_FROM_BIAS_KM) {
      continue;
    }
    const displayName =
      typeof place.displayName?.text === "string" &&
      place.displayName.text.trim()
        ? place.displayName.text.trim()
        : undefined;
    const googlePlaceId = normalizeGooglePlaceId(place.id);
    candidates.push({
      lat,
      lon,
      ...(googlePlaceId ? { googlePlaceId } : {}),
      ...(displayName ? { titleEn: displayName } : {}),
      ...(typeof place.formattedAddress === "string" &&
      place.formattedAddress.trim()
        ? { address: place.formattedAddress.trim() }
        : {}),
    });
  }
  if (candidates.length === 0) return null;
  if (!bias) return candidates[0]!;
  candidates.sort((a, b) => haversineKm(bias, a) - haversineKm(bias, b));
  return candidates[0]!;
}

async function searchPlaceCoords(input: {
  query: string;
  bias?: { lat: number; lon: number };
}): Promise<PlacesHit | null> {
  const apiKey = googlePrivateApiKey.value();
  if (!apiKey) {
    throw new Error("GOOGLE_PRIVATE_API_KEY secret is not configured");
  }

  const body: Record<string, unknown> = {
    textQuery: input.query,
    maxResultCount: MAX_RESULTS,
    languageCode: "en",
  };
  if (input.bias) {
    body.locationBias = {
      circle: {
        center: {
          latitude: input.bias.lat,
          longitude: input.bias.lon,
        },
        radius: BIAS_RADIUS_M,
      },
    };
  }

  const response = await fetch(PLACES_TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": TEXT_SEARCH_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json()) as PlacesApiResponse;
  if (!response.ok) {
    const message =
      json.error?.message ||
      `Places Text Search failed (${response.status})`;
    throw new Error(message);
  }

  return pickBestPlace(
    Array.isArray(json.places) ? json.places : [],
    input.bias
  );
}

function applyExactCoords(
  result: AnalyzeLocationResult,
  hit: { lat: number; lon: number }
): AnalyzeLocationResult {
  return {
    ...result,
    lat: hit.lat,
    lon: hit.lon,
    exactCoordinatesConfidence: 1,
    locationConfidence: Math.max(result.locationConfidence ?? 0, 0.95),
  };
}

async function resolveIds(
  result: AnalyzeLocationResult,
  hit?: { lat: number; lon: number }
): Promise<PlacesLocationIds | null> {
  const fromAi = resolvePlacesLocationIds({
    cityName: result.city,
    countryName: result.country,
    cityId: result.cityId,
    countryId: result.countryId,
  });
  if (fromAi) return fromAi;
  if (!hit || !isValidCoord(hit.lat, hit.lon)) return null;

  const english = await resolveEnglishPlaceIdsFromCoords(hit.lat, hit.lon);
  if (!english) return null;
  return resolvePlacesLocationIds({
    cityName: result.city || english.cityNameEn || english.cityId,
    countryName: result.country || english.countryNameEn || english.countryId,
    cityId: result.cityId || english.cityId,
    countryId: result.countryId || english.countryId,
  });
}

async function persistPlacesLocation(input: {
  ids: PlacesLocationIds;
  placeDocId: string;
  result: AnalyzeLocationResult;
  hit: PlacesHit;
}): Promise<void> {
  await setPlaceLocation({
    ids: input.ids,
    placeDocId: input.placeDocId,
    input: {
      title: input.result.title,
      placeSlug: input.placeDocId,
      cityName: input.result.city || input.ids.locationId,
      countryName: input.result.country || input.ids.countryId,
      cityId: input.result.cityId || input.ids.locationId,
      countryId: input.result.countryId || input.ids.countryId,
    },
    place: {
      id: input.placeDocId,
      title: input.result.title.trim(),
      location: { lat: input.hit.lat, lon: input.hit.lon },
      ...(input.hit.googlePlaceId
        ? { placeId: input.hit.googlePlaceId }
        : {}),
      ...(input.hit.titleEn
        ? { titleEn: input.hit.titleEn, displayName: input.hit.titleEn }
        : {}),
      ...(input.hit.address ? { address: input.hit.address } : {}),
    },
  });
}

/**
 * Replace AI lat/lon with cached or Google Places coordinates when identified.
 */
export async function resolveFindPlaceCoordinates(
  result: AnalyzeLocationResult
): Promise<AnalyzeLocationResult> {
  if (!result.identified || !result.title.trim()) return result;

  const placeDocId = resolvePlaceDocId({
    placeSlug: result.placeId,
    title: result.title,
  });
  if (!placeDocId) return result;

  const idsHint = await resolveIds(result);
  if (idsHint) {
    const cached = await getPlaceLocation(idsHint, placeDocId);
    if (cached && isValidCoord(cached.location.lat, cached.location.lon)) {
      logger.info("findPlace coords from placesLocation cache", {
        placeDocId,
        countryId: idsHint.countryId,
        locationId: idsHint.locationId,
      });
      return applyExactCoords(result, cached.location);
    }
  }

  try {
    const hit = await searchPlaceCoords({
      query: buildTextQuery(result, placeDocId),
      bias: biasFromResult(result),
    });
    if (!hit) {
      logger.warn("findPlace Places Text Search returned no coords", {
        placeDocId,
        title: result.title,
        city: result.city,
        country: result.country,
      });
      return result;
    }

    const ids = idsHint ?? (await resolveIds(result, hit));
    if (ids) {
      await persistPlacesLocation({
        ids,
        placeDocId,
        result,
        hit,
      });
    } else {
      logger.warn("findPlace Places hit not cached: missing country/city ids", {
        placeDocId,
        title: result.title,
      });
    }

    logger.info("findPlace coords from Google Places", {
      placeDocId,
      countryId: ids?.countryId ?? null,
      locationId: ids?.locationId ?? null,
      googlePlaceId: hit.googlePlaceId ?? null,
    });

    return applyExactCoords(result, hit);
  } catch (err) {
    logger.warn("findPlace Places lookup failed", {
      placeDocId,
      title: result.title,
      error: err instanceof Error ? err.message : String(err),
    });
    return result;
  }
}
