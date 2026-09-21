/**
 * Parse model planTrip JSON and map to PlanTripResult day + route suggestions.
 */

import type {
  PlaceCategory,
  PlannedDaySuggestion,
  PlannedPlaceSuggestion,
  PlannedRouteRole,
  PlannedRouteSuggestion,
  RoutePoint,
  TripRouteInstant,
  TripRouteTransport,
} from "./types";
import { PLACE_CATEGORIES, TRIP_ROUTE_TRANSPORTS } from "./types";

const PLACE_CATEGORY_SET = new Set<string>(PLACE_CATEGORIES);
const ROUTE_TRANSPORT_SET = new Set<string>(TRIP_ROUTE_TRANSPORTS);

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

/** Remove trailing commas before `]` / `}` (common model slip). */
function stripTrailingCommas(text: string): string {
  return text.replace(/,\s*(?=[\]}])/g, "");
}

/** Normalize fancy quotes the model sometimes emits inside JSON. */
function normalizeQuotes(text: string): string {
  return text
    .replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
}

/**
 * Escape bare `"` that appear inside string values (e.g. `See the "Blue Mosque"`).
 * A quote is treated as the string terminator only when followed by structural
 * JSON (`:` / `,` / `}` / `]`), and for `,` only when the next token looks like
 * another key/value — not prose like `"A", then walk`.
 */
function escapeInnerDoubleQuotes(text: string): string {
  let result = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (!inString) {
      if (c === '"') inString = true;
      result += c;
      continue;
    }

    if (escape) {
      result += c;
      escape = false;
      continue;
    }
    if (c === "\\") {
      result += c;
      escape = true;
      continue;
    }
    if (c !== '"') {
      result += c;
      continue;
    }

    const after = text.slice(i + 1);
    const structural = after.match(/^(\s*)([,:}\]]|$)/);
    if (!structural) {
      result += '\\"';
      continue;
    }

    const punct = structural[2] ?? "";
    if (punct === ",") {
      const rest = after.slice(structural[0]!.length);
      const nextToken = rest.match(/^\s*(["{\[\d\-]|true\b|false\b|null\b)/i);
      if (!nextToken) {
        result += '\\"';
        continue;
      }
    }

    inString = false;
    result += c;
  }

  return result;
}

/**
 * Close truncated JSON when the model hit the output token cap mid-object/array.
 * Tracks braces/brackets outside strings and finishes an open string if needed.
 */
function closeTruncatedJson(text: string): string {
  let inString = false;
  let escape = false;
  const stack: Array<"}" | "]"> = [];

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") {
      if (stack.length > 0 && stack[stack.length - 1] === c) stack.pop();
    }
  }

  let result = text;
  if (inString) result += '"';
  result = result.replace(/[,:]\s*$/, "");
  while (stack.length > 0) {
    result += stack.pop();
  }
  return result;
}

function repairJsonCandidate(text: string): string {
  return escapeInnerDoubleQuotes(
    stripTrailingCommas(normalizeQuotes(text))
  );
}

/**
 * Strip optional markdown fences, then parse JSON.
 * Recovers a JSON object embedded in surrounding prose (web_search forbids
 * JSON mode), repairs trailing commas / inner quotes, and closes truncated
 * objects/arrays from max-token cutoffs.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  const attempts: string[] = [];
  const pushAttempt = (value: string) => {
    if (value && !attempts.includes(value)) attempts.push(value);
  };

  pushAttempt(candidate);
  pushAttempt(repairJsonCandidate(candidate));

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const sliced = candidate.slice(start, end + 1);
    pushAttempt(sliced);
    pushAttempt(repairJsonCandidate(sliced));
  } else if (start >= 0) {
    const partial = candidate.slice(start);
    pushAttempt(closeTruncatedJson(repairJsonCandidate(partial)));
  }

  for (const attempt of [...attempts]) {
    pushAttempt(closeTruncatedJson(repairJsonCandidate(attempt)));
  }

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt) as unknown;
    } catch (err) {
      lastError = err;
    }
  }

  const detail =
    lastError instanceof Error ? lastError.message : "unknown parse error";
  throw new Error(
    `Model response did not contain valid JSON (${detail}).`
  );
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
    why: asString(row.why) ?? "Worth doing in this destination for the available time.",
    category: parseCategory(row.category),
    ...(priceAmount != null && priceAmount >= 0
      ? { priceAmount }
      : {}),
    ...(priceCurrency ? { priceCurrency } : {}),
    ...(priceLabel ? { priceLabel } : {}),
    ...(link ? { link } : {}),
    ...(asString(row.locationId) ? { locationId: asString(row.locationId)! } : {}),
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

  // Prefer ≥1 concrete place per day; empty arrays are rare (e.g. Umrah rest logistics).
  return {
    day: Math.floor(day),
    date,
    title: asString(row.title) ?? `Day ${Math.floor(day)}`,
    description: asString(row.description) ?? undefined,
    places,
  };
}

function parseRoutePoint(
  value: unknown,
  fallbackCity: string,
  fallbackCountry: string
): RoutePoint | null {
  const row = asRecord(value);
  if (!row) return null;
  const name = asString(row.name);
  const city = asString(row.city) ?? fallbackCity;
  if (!name || !city) return null;
  const country = asString(row.country) ?? fallbackCountry;
  const code = asString(row.code)?.toUpperCase();
  const placeId = asEnglishId(row.placeId) ?? asString(row.placeId) ?? undefined;
  const loc = asRecord(row.location);
  const lat = loc ? asNumber(loc.lat) : asNumber(row.lat);
  const lon = loc ? asNumber(loc.lon) : asNumber(row.lon);

  return {
    name,
    city,
    ...(country ? { country } : {}),
    ...(placeId ? { placeId } : {}),
    ...(code ? { code } : {}),
    ...(lat != null &&
    lon != null &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
      ? { location: { lat, lon } }
      : {}),
  };
}

function dateOnlyInstant(date: string, timezone = ""): TripRouteInstant {
  const day = date.trim();
  return {
    datetime: /^\d{4}-\d{2}-\d{2}$/.test(day)
      ? `${day}T00:00:00Z`
      : day,
    timezone,
    timeKnown: false,
  };
}

/**
 * Parse a TripRouteInstant. Never invent clock times:
 * - timeKnown=false when only the date is known (datetime still carries the date)
 * - timeKnown=true only when the model explicitly marks an exact time
 */
function parseRouteInstant(
  value: unknown,
  fallbackDate?: string
): TripRouteInstant | undefined {
  const row = asRecord(value);
  let datetime = row ? asString(row.datetime) : null;
  let timezone = row ? asString(row.timezone) ?? "" : "";
  let timeKnown: boolean | undefined =
    row && typeof row.timeKnown === "boolean" ? row.timeKnown : undefined;

  // Bare YYYY-MM-DD → date placeholder, time unknown.
  if (datetime && /^\d{4}-\d{2}-\d{2}$/.test(datetime)) {
    datetime = `${datetime}T00:00:00Z`;
    if (timeKnown === undefined) timeKnown = false;
  }

  if (!datetime && fallbackDate) {
    return dateOnlyInstant(fallbackDate, timezone);
  }
  if (!datetime) return undefined;

  // Default AI transfers to date-only unless explicitly marked known.
  if (timeKnown === undefined) timeKnown = false;

  // If model claimed a time but left midnight placeholder without timeKnown=true,
  // keep the date and mark time unknown (do not treat midnight as real).
  if (
    timeKnown === false &&
    /T00:00:00(?:\.0+)?(?:Z|[+-]00:00)?$/i.test(datetime)
  ) {
    // already date-only style — fine
  }

  return {
    datetime,
    timezone,
    timeKnown,
  };
}

function parseTransport(value: unknown): TripRouteTransport {
  const raw = asString(value)?.toLowerCase().replace(/\s+/g, "_");
  if (raw === "airport-transfer") return "airport_transfer";
  if (raw && ROUTE_TRANSPORT_SET.has(raw)) {
    return raw as TripRouteTransport;
  }
  if (raw === "shuttle" || raw === "transfer") return "airport_transfer";
  return "other";
}

function parseRouteRole(value: unknown): PlannedRouteRole | undefined {
  const raw = asString(value)?.toLowerCase().replace(/\s+/g, "_");
  if (raw === "user" || raw === "intercity" || raw === "local_transfer") {
    return raw;
  }
  if (raw === "local" || raw === "transfer" || raw === "local-transfer") {
    return "local_transfer";
  }
  if (raw === "missing" || raw === "connection" || raw === "ai") {
    return "intercity";
  }
  return undefined;
}

function parseRoute(
  value: unknown,
  fallbackCity: string,
  fallbackCountry: string,
  emptyDayByNumber: Map<number, { date: string; placeCount: number }>
): PlannedRouteSuggestion | null {
  const row = asRecord(value);
  if (!row) return null;

  const day = asNumber(row.day);
  if (day == null || day < 1) return null;
  const dayMeta = emptyDayByNumber.get(Math.floor(day));
  const date = asString(row.date) ?? dayMeta?.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const from = parseRoutePoint(row.from, fallbackCity, fallbackCountry);
  const to = parseRoutePoint(row.to, fallbackCity, fallbackCountry);
  if (!from || !to) return null;

  const placeCount = dayMeta?.placeCount ?? 0;
  const rawInsert = asNumber(row.insertAt);
  const insertAt = Math.max(
    0,
    Math.min(
      placeCount,
      rawInsert != null ? Math.floor(rawInsert) : 0
    )
  );

  const durationMinutes = asNumber(row.durationMinutes);
  const priceAmount = asNumber(row.priceAmount);
  const priceCurrency = asCurrencyCode(row.priceCurrency);
  const priceLabel = asString(row.priceLabel) ?? undefined;
  const link = asHttpUrl(row.link);
  const note = asString(row.note) ?? undefined;
  // Date is always known — ensure departure carries it even if the model omitted times.
  const departure =
    parseRouteInstant(row.departure, date) ?? dateOnlyInstant(date);
  const arrival = parseRouteInstant(row.arrival);
  const transport = parseTransport(row.transport);
  const durationApproximate =
    row.durationApproximate === true ||
    (transport !== "flight" && transport !== "train");
  const existingRouteId = asString(row.existingRouteId) ?? undefined;
  const role =
    parseRouteRole(row.role) ??
    (existingRouteId ? "user" : undefined);

  return {
    day: Math.floor(day),
    date,
    insertAt,
    from,
    to,
    transport,
    departure,
    ...(arrival ? { arrival } : {}),
    ...(durationMinutes != null && durationMinutes >= 0
      ? { durationMinutes: Math.round(durationMinutes) }
      : {}),
    ...(durationApproximate ? { durationApproximate: true } : {}),
    ...(note ? { note } : {}),
    ...(priceAmount != null && priceAmount >= 0 ? { priceAmount } : {}),
    ...(priceCurrency ? { priceCurrency } : {}),
    ...(priceLabel ? { priceLabel } : {}),
    ...(link ? { link } : {}),
    ...(role ? { role } : {}),
    ...(existingRouteId ? { existingRouteId } : {}),
  };
}

export type ParsedPlanTrip = {
  days: PlannedDaySuggestion[];
  routes: PlannedRouteSuggestion[];
};

export function parseModelPlanTrip(
  raw: unknown,
  fallbackCity: string,
  fallbackCountry: string
): ParsedPlanTrip {
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

  const emptyDayByNumber = new Map(
    days.map((d) => [d.day, { date: d.date, placeCount: d.places.length }])
  );

  const routes = asArray(root.routes)
    .map((r) => parseRoute(r, fallbackCity, fallbackCountry, emptyDayByNumber))
    .filter((r): r is PlannedRouteSuggestion => r != null)
    .sort((a, b) => a.day - b.day || a.insertAt - b.insertAt);

  return { days, routes };
}
