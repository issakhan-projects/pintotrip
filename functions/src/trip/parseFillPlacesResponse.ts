/**
 * Parse fillTripPlannerAiPlaces model JSON into nested place payloads.
 */

import { PLACE_CATEGORIES, type PlaceCategory } from "./types";

const PLACE_CATEGORY_SET = new Set<string>(PLACE_CATEGORIES);

export type ParsedFillSavedRef = { locationId: string };

export type ParsedFillLocationPlace = {
  id: string;
  title: string;
  description: string;
  note?: string;
  cityId: string;
  status: "planned";
  category?: PlaceCategory;
  location: { lat: number; lon: number };
  city: { id: string; name: string };
  country: { id: string; name: string };
  images: Array<{ url: string; source: "user" | "external" }>;
  price?: { amount?: number; currency?: string; label?: string };
  links?: Array<{ url: string; label?: string }>;
  confidence?: number;
  source?: { type: "image" | "link" | "manual" | "city"; url?: string };
  ai?: { why: string; model: string };
};

export type ParsedFillNestedPlace =
  | ParsedFillSavedRef
  | ParsedFillLocationPlace;

export type ParsedFillCitySlot = {
  cityId: string;
  places: ParsedFillNestedPlace[];
};

export type ParsedFillDay = {
  day: number;
  date: string;
  places: ParsedFillCitySlot[];
};

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

function parseCategory(value: unknown): PlaceCategory | undefined {
  const s = asString(value)?.toLowerCase();
  if (!s || !PLACE_CATEGORY_SET.has(s)) return undefined;
  return s as PlaceCategory;
}

function parseLocationPlace(
  row: Record<string, unknown>,
  fallbackCityId: string,
  fallbackCityName: string,
  fallbackCountryId: string,
  fallbackCountryName: string
): ParsedFillLocationPlace | null {
  const title = asString(row.title);
  if (!title) return null;

  const rawId = asString(row.id) || slugifyAscii(title);
  const id = isAsciiId(rawId) ? rawId.toLowerCase() : slugifyAscii(title);
  if (!isAsciiId(id)) return null;

  const locRaw =
    row.location && typeof row.location === "object"
      ? (row.location as Record<string, unknown>)
      : row;
  const lat = asNumber(locRaw.lat) ?? asNumber(row.lat);
  const lon = asNumber(locRaw.lon) ?? asNumber(row.lon);
  if (lat == null || lon == null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const cityIdRaw =
    asString(row.cityId) ||
    (row.city && typeof row.city === "object"
      ? asString((row.city as Record<string, unknown>).id)
      : null) ||
    fallbackCityId;
  const cityId = isAsciiId(cityIdRaw) ? cityIdRaw.toLowerCase() : fallbackCityId;

  const cityObj =
    row.city && typeof row.city === "object"
      ? (row.city as Record<string, unknown>)
      : {};
  const countryObj =
    row.country && typeof row.country === "object"
      ? (row.country as Record<string, unknown>)
      : {};

  const cityName =
    asString(cityObj.name) || fallbackCityName || cityId;
  const countryIdRaw =
    asString(countryObj.id) || fallbackCountryId || "unknown";
  const countryId = /^[a-z]{2}$/i.test(countryIdRaw)
    ? countryIdRaw.toLowerCase()
    : fallbackCountryId || "xx";
  const countryName =
    asString(countryObj.name) || fallbackCountryName || countryId;

  const description = asString(row.description) || title;
  const note = asString(row.note) ?? undefined;
  const category = parseCategory(row.category);

  const priceRaw =
    row.price && typeof row.price === "object"
      ? (row.price as Record<string, unknown>)
      : null;
  const priceAmount = priceRaw ? asNumber(priceRaw.amount) : asNumber(row.priceAmount);
  const priceCurrency =
    (priceRaw ? asString(priceRaw.currency) : null) ||
    asString(row.priceCurrency);
  const priceLabel =
    (priceRaw ? asString(priceRaw.label) : null) || asString(row.priceLabel);

  const linksRaw = Array.isArray(row.links) ? row.links : null;
  const links: Array<{ url: string; label?: string }> = [];
  if (linksRaw) {
    for (const item of linksRaw) {
      if (!item || typeof item !== "object") continue;
      const url = asHttpUrl((item as Record<string, unknown>).url);
      if (!url) continue;
      const label = asString((item as Record<string, unknown>).label) ?? undefined;
      links.push({ url, ...(label ? { label } : {}) });
    }
  } else {
    const single = asHttpUrl(row.link);
    if (single) links.push({ url: single });
  }

  const aiRaw =
    row.ai && typeof row.ai === "object"
      ? (row.ai as Record<string, unknown>)
      : null;
  const why =
    (aiRaw ? asString(aiRaw.why) : null) ||
    asString(row.why) ||
    description;

  const confidence = asNumber(row.confidence) ?? 0.7;

  return {
    id,
    title,
    description,
    ...(note ? { note } : {}),
    cityId,
    status: "planned",
    ...(category ? { category } : {}),
    location: { lat, lon },
    city: { id: cityId, name: cityName },
    country: { id: countryId, name: countryName },
    images: [],
    ...(priceAmount != null || priceCurrency || priceLabel
      ? {
          price: {
            ...(priceAmount != null && priceAmount >= 0
              ? { amount: priceAmount }
              : {}),
            ...(priceCurrency && /^[A-Za-z]{3}$/.test(priceCurrency)
              ? { currency: priceCurrency.toUpperCase() }
              : {}),
            ...(priceLabel ? { label: priceLabel } : {}),
          },
        }
      : {}),
    ...(links.length ? { links } : {}),
    confidence: Math.min(1, Math.max(0, confidence)),
    source: { type: "manual" },
    ai: {
      why,
      model: "fillTripPlannerAiPlaces",
    },
  };
}

function parseNestedPlace(
  raw: unknown,
  fallbackCityId: string,
  fallbackCityName: string,
  fallbackCountryId: string,
  fallbackCountryName: string,
  allowedSavedIds: Set<string>
): ParsedFillNestedPlace | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;

  // Saved ref takes priority when locationId is present and allowed.
  const locationId = asString(row.locationId);
  if (locationId) {
    if (!allowedSavedIds.has(locationId)) return null;
    return { locationId };
  }

  return parseLocationPlace(
    row,
    fallbackCityId,
    fallbackCityName,
    fallbackCountryId,
    fallbackCountryName
  );
}

export function extractFillPlacesJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1]?.trim() || trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("fillTripPlannerAiPlaces: no JSON object in model response.");
  }
  return JSON.parse(body.slice(start, end + 1)) as unknown;
}

export function parseFillPlacesModelResponse(
  raw: unknown,
  context: {
    allowedSavedIdsByCity: Map<string, Set<string>>;
    cityMeta: Map<
      string,
      { cityName: string; countryId: string; countryName: string }
    >;
  }
): ParsedFillDay[] {
  if (!raw || typeof raw !== "object") return [];
  const body = raw as Record<string, unknown>;
  const daysRaw = Array.isArray(body.itinerary) ? body.itinerary : [];
  const out: ParsedFillDay[] = [];

  for (const dayRow of daysRaw) {
    if (!dayRow || typeof dayRow !== "object") continue;
    const d = dayRow as Record<string, unknown>;
    const dayNum = asNumber(d.day);
    const date = asString(d.date);
    if (dayNum == null || !date) continue;

    const slotsRaw = Array.isArray(d.places) ? d.places : [];
    const slots: ParsedFillCitySlot[] = [];

    for (const slotRow of slotsRaw) {
      if (!slotRow || typeof slotRow !== "object") continue;
      const s = slotRow as Record<string, unknown>;
      const cityIdRaw = asString(s.cityId);
      if (!cityIdRaw || !isAsciiId(cityIdRaw)) continue;
      const cityId = cityIdRaw.toLowerCase();
      const meta = context.cityMeta.get(cityId);
      const allowed = context.allowedSavedIdsByCity.get(cityId) ?? new Set();

      const placesRaw = Array.isArray(s.places) ? s.places : [];
      const places: ParsedFillNestedPlace[] = [];
      const seenSaved = new Set<string>();
      const seenNew = new Set<string>();

      for (const p of placesRaw) {
        const parsed = parseNestedPlace(
          p,
          cityId,
          meta?.cityName ?? cityId,
          meta?.countryId ?? "xx",
          meta?.countryName ?? "",
          allowed
        );
        if (!parsed) continue;
        if ("locationId" in parsed) {
          if (seenSaved.has(parsed.locationId)) continue;
          seenSaved.add(parsed.locationId);
          places.push(parsed);
        } else {
          if (seenNew.has(parsed.id)) continue;
          seenNew.add(parsed.id);
          places.push(parsed);
        }
      }

      slots.push({ cityId, places });
    }

    out.push({ day: Math.floor(dayNum), date, places: slots });
  }

  return out;
}
