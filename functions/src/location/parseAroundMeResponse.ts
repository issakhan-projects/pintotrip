/**
 * Parse findAroundMe GPT JSON into locations-subcollection shaped places.
 * Always prefers Google Places hits for coords / identity; GPT only enriches text.
 */

import { logger } from "firebase-functions";
import { PLACE_CATEGORIES, type PlaceCategory } from "../trip/types";
import type { NearbyPlaceHit } from "./nearbySearch";
import type { AroundMePlaceResult } from "./aroundMeResultTypes";

const PLACE_CATEGORY_SET = new Set<string>(PLACE_CATEGORIES);

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t || null;
}

function asNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function isAsciiId(value: string): boolean {
  const id = value.trim().toLowerCase();
  if (!id || id === "unknown") return false;
  if (id.startsWith("chij")) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}

function isIsoCountryId(value: string): boolean {
  const id = value.trim().toLowerCase();
  return /^[a-z]{2}$/.test(id) && id !== "xx";
}

function asHttpUrl(value: unknown): string | null {
  const s = asString(value);
  if (!s || !/^https?:\/\//i.test(s)) return null;
  return s;
}

function slugifyAscii(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Normalize Places API ids: "places/ChIJ…" → "ChIJ…". */
export function normalizeGooglePlaceId(value: string): string {
  return value.trim().replace(/^places\//, "");
}

function parseCategory(value: unknown): PlaceCategory | undefined {
  const s = asString(value)?.toLowerCase();
  if (!s || !PLACE_CATEGORY_SET.has(s)) return undefined;
  return s as PlaceCategory;
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  // Prefer fenced ```json blocks from Responses API.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence?.[1]?.trim() || trimmed;

  if (candidate.startsWith("{")) {
    return JSON.parse(candidate) as unknown;
  }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(candidate.slice(start, end + 1)) as unknown;
  }
  throw new Error("Expected a JSON object in model response.");
}

export function extractAroundMeJsonObject(raw: string): unknown {
  return extractJsonObject(raw);
}

export type FallbackIds = {
  cityId: string;
  cityName: string;
  countryId: string;
  countryName: string;
};

function resolveCityCountry(
  row: Record<string, unknown>,
  fallback: FallbackIds
): { cityId: string; cityName: string; countryId: string; countryName: string } | null {
  const cityName =
    (isAsciiId(fallback.cityId) && fallback.cityName
      ? fallback.cityName
      : null) ||
    asString(
      row.city && typeof row.city === "object"
        ? (row.city as Record<string, unknown>).name
        : null
    ) ||
    fallback.cityName ||
    "Nearby";

  const countryName =
    (isIsoCountryId(fallback.countryId) && fallback.countryName
      ? fallback.countryName
      : null) ||
    asString(
      row.country && typeof row.country === "object"
        ? (row.country as Record<string, unknown>).name
        : null
    ) ||
    fallback.countryName ||
    "Unknown";

  let cityId = isAsciiId(fallback.cityId)
    ? fallback.cityId
    : asString(
        row.city && typeof row.city === "object"
          ? (row.city as Record<string, unknown>).id
          : null
      )?.toLowerCase() || "";
  if (!isAsciiId(cityId)) cityId = slugifyAscii(cityName);
  if (!isAsciiId(cityId)) cityId = "nearby";

  let countryId = isIsoCountryId(fallback.countryId)
    ? fallback.countryId
    : asString(
        row.country && typeof row.country === "object"
          ? (row.country as Record<string, unknown>).id
          : null
      )?.toLowerCase() || "";
  if (!isIsoCountryId(countryId)) {
    // Do not drop places — keep empty ISO only when truly unknown.
    countryId = isIsoCountryId(countryId) ? countryId : fallback.countryId;
  }
  if (!isIsoCountryId(countryId)) {
    return null;
  }

  return { cityId, cityName, countryId, countryName };
}

function parseOnePlace(
  row: Record<string, unknown>,
  hit: NearbyPlaceHit,
  fallback: FallbackIds
): AroundMePlaceResult | null {
  const title = asString(row.title) || hit.title;
  if (!title) return null;

  const rawId = asString(row.id) || slugifyAscii(title);
  let id = isAsciiId(rawId) ? rawId.toLowerCase() : slugifyAscii(title);
  if (!isAsciiId(id)) {
    id = slugifyAscii(normalizeGooglePlaceId(hit.googlePlaceId)) || "place";
  }
  if (!isAsciiId(id)) return null;

  const lat = hit.lat;
  const lon = hit.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const ids = resolveCityCountry(row, fallback);
  if (!ids) return null;

  const description =
    asString(row.description) ||
    hit.address ||
    `Nearby place: ${title}.`;
  const note = asString(row.note) || undefined;
  const category = parseCategory(row.category);
  const confidence = asNumber(row.confidence);
  const clampedConfidence =
    confidence === null ? 0.75 : Math.min(1, Math.max(0, confidence));

  const aiRaw =
    row.ai && typeof row.ai === "object"
      ? (row.ai as Record<string, unknown>)
      : null;
  const why =
    asString(aiRaw?.why) ||
    `Matches the selected Around Me type near you.`;

  let price: AroundMePlaceResult["price"];
  if (row.price && typeof row.price === "object") {
    const p = row.price as Record<string, unknown>;
    const amount = asNumber(p.amount);
    const currency = asString(p.currency)?.toUpperCase() || undefined;
    const label = asString(p.label) || undefined;
    if (amount !== null || currency || label) {
      price = {
        ...(amount !== null ? { amount } : {}),
        ...(currency ? { currency } : {}),
        ...(label ? { label } : {}),
      };
    }
  }

  let links: AroundMePlaceResult["links"];
  if (Array.isArray(row.links)) {
    const parsed: Array<{ url: string; label?: string }> = [];
    for (const item of row.links) {
      if (!item || typeof item !== "object") continue;
      const link = item as Record<string, unknown>;
      const url = asHttpUrl(link.url);
      if (!url) continue;
      const label = asString(link.label) || undefined;
      parsed.push({ url, ...(label ? { label } : {}) });
    }
    if (parsed.length > 0) links = parsed;
  }
  if (!links && hit.googleMapsUri) {
    links = [{ url: hit.googleMapsUri, label: "Google Maps" }];
  }

  return {
    googlePlaceId: normalizeGooglePlaceId(hit.googlePlaceId),
    id,
    title,
    description,
    ...(note ? { note } : {}),
    status: "planned",
    ...(category ? { category } : {}),
    lat,
    lon,
    city: { id: ids.cityId, name: ids.cityName },
    country: { id: ids.countryId, name: ids.countryName },
    images: [],
    ...(price ? { price } : {}),
    ...(links ? { links } : {}),
    confidence: clampedConfidence,
    ai: { why, model: "findAroundMe" },
    source: { type: "around_me" },
  };
}

/** Build places from Google hits only — used when GPT enrichment fails. */
export function placesFromHits(
  hits: NearbyPlaceHit[],
  fallback: FallbackIds
): AroundMePlaceResult[] {
  const out: AroundMePlaceResult[] = [];
  for (const hit of hits) {
    const parsed = parseOnePlace({}, hit, fallback);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function parseAroundMePlaces(
  raw: unknown,
  hits: NearbyPlaceHit[],
  fallback: FallbackIds
): AroundMePlaceResult[] {
  if (!raw || typeof raw !== "object") {
    throw new Error("Around Me model response is not an object.");
  }
  const placesRaw = (raw as Record<string, unknown>).places;
  if (!Array.isArray(placesRaw)) {
    throw new Error("Around Me model response missing places array.");
  }

  const byGoogleId = new Map<string, Record<string, unknown>>();
  for (const row of placesRaw) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const gid = asString(rec.googlePlaceId);
    if (!gid) continue;
    byGoogleId.set(normalizeGooglePlaceId(gid), rec);
    byGoogleId.set(gid, rec);
  }

  const out: AroundMePlaceResult[] = [];
  let dropped = 0;
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    const key = normalizeGooglePlaceId(hit.googlePlaceId);
    const row =
      byGoogleId.get(key) ||
      byGoogleId.get(hit.googlePlaceId) ||
      (placesRaw[i] && typeof placesRaw[i] === "object"
        ? (placesRaw[i] as Record<string, unknown>)
        : null) ||
      {};
    const parsed = parseOnePlace(row, hit, fallback);
    if (parsed) {
      out.push(parsed);
    } else {
      dropped += 1;
    }
  }

  if (dropped > 0) {
    logger.warn("parseAroundMePlaces dropped places", {
      hitCount: hits.length,
      parsedCount: out.length,
      dropped,
      fallbackCountryId: fallback.countryId,
      fallbackCityId: fallback.cityId,
    });
  }

  return out;
}
