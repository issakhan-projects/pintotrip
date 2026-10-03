/**
 * After AI invents place lat/lon, resolve real coordinates:
 * 1) placesLocation Firestore cache (match by countryId + cityId + ascii place id)
 * 2) Google Places Text Search (New) on miss → save to cache
 * Soft-fails: keeps AI coords when both miss or error.
 *
 * Never match cache on localized title / cityName / countryName.
 */

import { logger } from "firebase-functions";
import { googlePrivateApiKey } from "../../shared/config";
import {
  findCachedPlace,
  getPlacesForLocation,
  resolvePlaceDocId,
  resolvePlacesLocationIds,
  setPlaceLocation,
  type PlacesCityCache,
  type PlacesLocationIds,
} from "../../shared/placesLocation";
import type {
  TripPlannerAiRequestDestination,
  TripPlannerAiResponseDay,
  TripPlannerAiResponseLocationPlace,
  TripPlannerAiResponseNestedPlace,
} from "./tripPlannerAiTypes";

const PLACES_TEXT_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchText";

const TEXT_SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.formattedAddress",
].join(",");

/** Reject Places matches that land far outside the destination city. */
const MAX_DISTANCE_FROM_CITY_KM = 80;
const MAX_RESULTS = 3;
const BIAS_RADIUS_M = 45_000;
/** Cap concurrent Places calls (planTrip timeout budget). */
const CONCURRENCY = 4;

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

type ResolvedCoords = {
  lat: number;
  lon: number;
  placeId?: string;
  /** English display name from Places (languageCode=en). */
  titleEn?: string;
  displayName?: string;
  address?: string;
  source: "cache" | "places";
};

function isLocationPlace(
  place: TripPlannerAiResponseNestedPlace
): place is TripPlannerAiResponseLocationPlace {
  return Boolean(
    place &&
      typeof place === "object" &&
      "title" in place &&
      "location" in place &&
      !("locationId" in place)
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

function cityBias(
  dest: TripPlannerAiRequestDestination | undefined,
  place: TripPlannerAiResponseLocationPlace
): { lat: number; lon: number } | undefined {
  const info = dest?.cityInfo;
  if (typeof info?.lat === "number" && typeof info?.lon === "number") {
    return { lat: info.lat, lon: info.lon };
  }
  if (
    Number.isFinite(place.location.lat) &&
    Number.isFinite(place.location.lon)
  ) {
    return { lat: place.location.lat, lon: place.location.lon };
  }
  return undefined;
}

/** Dedup key — English/ASCII ids only (not localized title). */
function jobKey(
  countryId: string,
  cityId: string,
  placeDocId: string
): string {
  return `${countryId}|${cityId}|${placeDocId}`;
}

/**
 * Text Search query: prefer English slug words + ascii cityId when title is
 * non-Latin; still pass localized title (Places handles it) as fallback.
 */
function buildTextQuery(
  place: TripPlannerAiResponseLocationPlace,
  placeDocId: string
): string {
  const title = place.title.trim();
  const cityId = (place.city.id || place.cityId || "").trim();
  const countryId = (place.country.id || "").trim().toUpperCase();
  const hasLatinTitle = /[A-Za-z]/.test(title);

  if (hasLatinTitle) {
    const city = place.city.name.trim();
    const country = place.country.name.trim();
    if (city && country) return `${title}, ${city}, ${country}`;
    if (city) return `${title}, ${city}`;
    return title;
  }

  // Non-Latin display title — query with ascii slug + city/country ids.
  const slugWords = placeDocId.replace(/-/g, " ").trim();
  const namePart = slugWords || title;
  if (cityId && countryId) return `${namePart}, ${cityId}, ${countryId}`;
  if (cityId) return `${namePart}, ${cityId}`;
  return namePart;
}

function fromCacheEntry(entry: {
  location: { lat: number; lon: number };
  placeId?: string;
  titleEn?: string;
  displayName?: string;
  address?: string;
}): ResolvedCoords {
  return {
    lat: entry.location.lat,
    lon: entry.location.lon,
    source: "cache",
    ...(entry.placeId ? { placeId: entry.placeId } : {}),
    ...(entry.titleEn ? { titleEn: entry.titleEn } : {}),
    ...(entry.displayName ? { displayName: entry.displayName } : {}),
    ...(entry.address ? { address: entry.address } : {}),
  };
}

function pickBestPlace(
  places: PlacesApiPlace[],
  bias: { lat: number; lon: number } | undefined
): ResolvedCoords | null {
  const candidates: ResolvedCoords[] = [];
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
    if (bias && haversineKm(bias, { lat, lon }) > MAX_DISTANCE_FROM_CITY_KM) {
      continue;
    }
    const displayName =
      typeof place.displayName?.text === "string" && place.displayName.text.trim()
        ? place.displayName.text.trim()
        : undefined;
    candidates.push({
      lat,
      lon,
      source: "places",
      ...(typeof place.id === "string" && place.id.trim()
        ? { placeId: place.id.trim() }
        : {}),
      ...(displayName ? { titleEn: displayName, displayName } : {}),
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
}): Promise<ResolvedCoords | null> {
  const apiKey = googlePrivateApiKey.value();
  if (!apiKey) {
    throw new Error("GOOGLE_PRIVATE_API_KEY secret is not configured");
  }

  const body: Record<string, unknown> = {
    textQuery: input.query,
    maxResultCount: MAX_RESULTS,
    // Prefer English names for titleEn / stable caching across locales.
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

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

type EnrichJob = {
  key: string;
  place: TripPlannerAiResponseLocationPlace;
  /** English/ASCII place slug (AI place.id). */
  placeDocId: string;
  placeAsciiId: string;
  ids: PlacesLocationIds | null;
  bias?: { lat: number; lon: number };
};

/**
 * Overwrite AI-invented place coordinates with cached / Google Places coords.
 * Saved `{ locationId }` refs are left untouched.
 * Cache match: countryId + cityId + ascii place id (not localized title).
 */
export async function enrichItineraryPlaceCoordinates(
  itinerary: TripPlannerAiResponseDay[],
  destinations: Record<string, TripPlannerAiRequestDestination>
): Promise<TripPlannerAiResponseDay[]> {
  const jobsByKey = new Map<string, EnrichJob>();
  for (const day of itinerary) {
    for (const slot of day.places ?? []) {
      const dest = destinations[slot.cityId];
      const candidates = [
        ...(slot.places ?? []),
        ...(slot.whereToEat ?? []),
      ];
      for (const nested of candidates) {
        if (!isLocationPlace(nested)) continue;
        const title = nested.title?.trim();
        if (!title) continue;

        const cityId =
          nested.city.id?.trim() ||
          nested.cityId?.trim() ||
          dest?.cityId?.trim() ||
          "";
        const countryId =
          nested.country.id?.trim() || dest?.countryId?.trim() || "";

        const placeDocId = resolvePlaceDocId({
          placeSlug: nested.id,
          title,
        });
        if (!placeDocId) continue;

        const ids = resolvePlacesLocationIds({
          cityName: nested.city.name || dest?.cityName || cityId,
          countryName: nested.country.name || dest?.countryName || countryId,
          cityId: cityId || dest?.cityId,
          countryId: countryId || dest?.countryId,
        });

        const key = ids
          ? jobKey(ids.countryId, ids.locationId, placeDocId)
          : `noid|${placeDocId}|${title.toLowerCase()}`;
        if (jobsByKey.has(key)) continue;

        jobsByKey.set(key, {
          key,
          place: nested,
          placeDocId,
          placeAsciiId: placeDocId,
          ids,
          bias: cityBias(dest, nested),
        });
      }
    }
  }

  if (jobsByKey.size === 0) return itinerary;

  const jobs = [...jobsByKey.values()];
  const resolved = new Map<string, ResolvedCoords>();

  // --- 1) Batch-load placesLocation cache per city (keyed by ascii ids) ---
  const cityCache = new Map<string, PlacesCityCache>();
  const cityIdsSeen = new Map<string, PlacesLocationIds>();
  for (const job of jobs) {
    if (!job.ids) continue;
    const cityKey = `${job.ids.countryId}/${job.ids.locationId}`;
    if (!cityIdsSeen.has(cityKey)) cityIdsSeen.set(cityKey, job.ids);
  }

  await mapPool([...cityIdsSeen.entries()], CONCURRENCY, async ([cityKey, ids]) => {
    const map = await getPlacesForLocation(ids);
    cityCache.set(cityKey, map);
  });

  let cacheHits = 0;
  const misses: EnrichJob[] = [];

  for (const job of jobs) {
    if (job.ids) {
      const cityKey = `${job.ids.countryId}/${job.ids.locationId}`;
      const cache = cityCache.get(cityKey);
      const entry = cache
        ? findCachedPlace(cache, { placeDocId: job.placeDocId })
        : null;
      if (entry) {
        resolved.set(job.key, fromCacheEntry(entry));
        cacheHits += 1;
        continue;
      }
    }
    misses.push(job);
  }

  // --- 2) Google Places Text Search only for cache misses ---
  let placesHits = 0;
  let failedCount = 0;

  await mapPool(misses, CONCURRENCY, async (job) => {
    try {
      const hit = await searchPlaceCoords({
        query: buildTextQuery(job.place, job.placeDocId),
        bias: job.bias,
      });
      if (!hit) {
        failedCount += 1;
        return;
      }

      resolved.set(job.key, hit);
      placesHits += 1;

      // --- 3) Persist with ASCII match keys (id / cityId / countryId / placeId) ---
      if (job.ids) {
        await setPlaceLocation({
          ids: job.ids,
          placeDocId: job.placeDocId,
          input: {
            title: job.place.title,
            placeSlug: job.placeAsciiId,
            cityName: job.place.city.name,
            countryName: job.place.country.name,
            cityId: job.place.city.id || job.place.cityId || job.ids.locationId,
            countryId: job.place.country.id || job.ids.countryId,
          },
          place: {
            id: job.placeAsciiId,
            title: job.place.title.trim(),
            location: { lat: hit.lat, lon: hit.lon },
            ...(hit.placeId ? { placeId: hit.placeId } : {}),
            ...(hit.titleEn ? { titleEn: hit.titleEn } : {}),
            ...(hit.displayName ? { displayName: hit.displayName } : {}),
            ...(hit.address ? { address: hit.address } : {}),
          },
        });
      }
    } catch (err) {
      failedCount += 1;
      logger.warn("enrichPlaceCoordinates Places lookup failed", {
        placeId: job.placeAsciiId,
        cityId: job.ids?.locationId ?? null,
        countryId: job.ids?.countryId ?? null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  logger.info("enrichPlaceCoordinates finished", {
    uniquePlaces: jobs.length,
    cacheHits,
    placesHits,
    failedCount,
  });

  if (resolved.size === 0) return itinerary;

  function applyResolved(
    nested: TripPlannerAiResponseNestedPlace,
    slotCityId: string
  ): TripPlannerAiResponseNestedPlace {
    if (!isLocationPlace(nested)) return nested;
    const placeDocId = resolvePlaceDocId({
      placeSlug: nested.id,
      title: nested.title,
    });
    if (!placeDocId) return nested;
    const dest = destinations[slotCityId];
    const ids = resolvePlacesLocationIds({
      cityName: nested.city.name || dest?.cityName || "",
      countryName: nested.country.name || dest?.countryName || "",
      cityId: nested.city.id || nested.cityId || dest?.cityId || "",
      countryId: nested.country.id || dest?.countryId || "",
    });
    const key = ids
      ? jobKey(ids.countryId, ids.locationId, placeDocId)
      : `noid|${placeDocId}|${nested.title.trim().toLowerCase()}`;
    const hit = resolved.get(key);
    if (!hit) return nested;
    return {
      ...nested,
      location: { lat: hit.lat, lon: hit.lon },
    };
  }

  return itinerary.map((day) => ({
    ...day,
    places: (day.places ?? []).map((slot) => ({
      ...slot,
      places: (slot.places ?? []).map((nested) =>
        applyResolved(nested, slot.cityId)
      ),
      ...(slot.whereToEat?.length
        ? {
            whereToEat: slot.whereToEat.map((nested) =>
              applyResolved(nested, slot.cityId)
            ) as TripPlannerAiResponseLocationPlace[],
          }
        : {}),
    })),
  }));
}
