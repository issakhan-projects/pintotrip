/**
 * Parse model planTrip JSON and map to PlanTripResult day suggestions.
 */

import type {
  PlaceCategory,
  PlannedDaySuggestion,
  PlannedPlaceSuggestion,
} from "./types";
import { PLACE_CATEGORIES } from "./types";

const PLACE_CATEGORY_SET = new Set<string>(PLACE_CATEGORIES);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseCategory(value: unknown): PlaceCategory {
  const raw = asString(value)?.toLowerCase();
  if (raw && PLACE_CATEGORY_SET.has(raw)) {
    return raw as PlaceCategory;
  }
  return "other";
}

/** Lowercase ASCII slug — drops non-Latin so localized ids cannot leak through. */
function asEnglishId(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  const slug = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || undefined;
}

function asCountryCode(value: unknown): string | undefined {
  const raw = asString(value)?.toUpperCase();
  if (raw && /^[A-Z]{2}$/.test(raw)) return raw;
  return undefined;
}

function asCountryId(
  value: unknown,
  countryCode?: string
): string | undefined {
  if (countryCode) return countryCode.toLowerCase();
  const fromField = asEnglishId(value);
  if (fromField && /^[a-z]{2}$/.test(fromField)) return fromField;
  return fromField;
}

function asCurrencyCode(value: unknown): string | undefined {
  const raw = asString(value)?.toUpperCase();
  if (raw && /^[A-Z]{3}$/.test(raw)) return raw;
  return undefined;
}

function asHttpUrl(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Model response is not valid JSON.");
  }
}

function parsePlace(
  value: unknown,
  fallbackCity: string,
  fallbackCountry: string
): PlannedPlaceSuggestion | null {
  const row = asRecord(value);
  if (!row) return null;

  const title = asString(row.title);
  const lat = asNumber(row.lat);
  const lon = asNumber(row.lon);
  if (!title || lat == null || lon == null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const countryCode = asCountryCode(row.countryCode);
  const countryId = asCountryId(row.countryId, countryCode);
  const cityId = asEnglishId(row.cityId);
  const priceAmount = asNumber(row.priceAmount);
  const priceCurrency = asCurrencyCode(row.priceCurrency);
  const priceLabel = asString(row.priceLabel) ?? undefined;
  const link = asHttpUrl(row.link);

  return {
    title,
    description:
      asString(row.description) ??
      asString(row.why) ??
      "Suggested for your trip.",
    lat,
    lon,
    cityName: asString(row.cityName) ?? fallbackCity,
    countryName: asString(row.countryName) ?? fallbackCountry,
    ...(cityId ? { cityId } : {}),
    ...(countryId ? { countryId } : {}),
    ...(countryCode ? { countryCode } : {}),
    why: asString(row.why) ?? "Fits your selected leisure focus.",
    category: parseCategory(row.category),
    ...(priceAmount != null && priceAmount >= 0
      ? { priceAmount }
      : {}),
    ...(priceCurrency ? { priceCurrency } : {}),
    ...(priceLabel ? { priceLabel } : {}),
    ...(link ? { link } : {}),
  };
}

function parseDay(
  value: unknown,
  fallbackCity: string,
  fallbackCountry: string
): PlannedDaySuggestion | null {
  const row = asRecord(value);
  if (!row) return null;

  const day = asNumber(row.day);
  const date = asString(row.date);
  if (day == null || !date || day < 1) return null;

  const places = asArray(row.places)
    .map((p) => parsePlace(p, fallbackCity, fallbackCountry))
    .filter((p): p is PlannedPlaceSuggestion => p != null)
    .slice(0, 4);

  if (places.length === 0) return null;

  return {
    day: Math.floor(day),
    date,
    title: asString(row.title) ?? `Day ${Math.floor(day)}`,
    description: asString(row.description) ?? undefined,
    places,
  };
}

export function parseModelPlanTrip(
  raw: unknown,
  fallbackCity: string,
  fallbackCountry: string
): PlannedDaySuggestion[] {
  const root = asRecord(raw);
  if (!root) {
    throw new Error("Plan trip model response is not an object.");
  }

  const days = asArray(root.days)
    .map((d) => parseDay(d, fallbackCity, fallbackCountry))
    .filter((d): d is PlannedDaySuggestion => d != null)
    .sort((a, b) => a.day - b.day);

  if (days.length === 0) {
    throw new Error("Plan trip model returned no usable days.");
  }

  return days;
}
