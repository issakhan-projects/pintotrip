/**
 * Parse and normalize model JSON for adaptive place identification.
 */

import type {
  AnalyzeLocationResult,
  ConfidenceLevel,
  LocationAlternative,
  PlaceCategory,
} from "./types";
import { PLACE_CATEGORIES } from "./types";

const PLACE_CATEGORY_SET = new Set<string>(PLACE_CATEGORIES);

export type CoordinateAccuracy = "exact" | "approximate" | "area";

export interface ModelLocationAlternative {
  placeName: string;
  placeId?: string;
  city: string;
  cityId?: string;
  country: string;
  countryId?: string;
  confidence: number;
}

/** Initial vision/text identification (no web verification). */
export interface ModelInitialIdentification {
  identified: boolean;
  placeName: string | null;
  placeId: string | null;
  description: string;
  city: string | null;
  cityId: string | null;
  country: string | null;
  countryId: string | null;
  countryCode: string | null;
  category: PlaceCategory | null;
  latitude: number | null;
  longitude: number | null;
  coordinatesAccuracy: CoordinateAccuracy;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  reason: string;
  isDistinctive: boolean;
  isSpecificPlace: boolean;
  hasDistinctiveEvidence: boolean;
  /** True when another landmark could reasonably match the same visual class. */
  couldMatchMultipleLandmarks: boolean;
  possibleAlternatives: ModelLocationAlternative[];
  visualClues: string[];
  suggestedSearchQueries: string[];
}

/** Final result after optional verification. */
export interface ModelVerifiedIdentification {
  identified: boolean;
  placeName: string | null;
  placeId: string | null;
  description: string;
  city: string | null;
  cityId: string | null;
  country: string | null;
  countryId: string | null;
  countryCode: string | null;
  category: PlaceCategory | null;
  latitude: number | null;
  longitude: number | null;
  coordinatesAccuracy: CoordinateAccuracy;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  reason: string;
  verificationPerformed: boolean;
  alternatives: ModelLocationAlternative[];
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function asNumber(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`Invalid numeric field: ${field}`);
}

function asOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Lowercase ASCII slug — English machine ids only (drops non-Latin). */
function asEnglishId(value: unknown): string | null {
  const raw = asOptionalString(value);
  if (!raw) return null;
  const slug = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || null;
}

function asCountryId(
  value: unknown,
  countryCode: string | null
): string | null {
  if (countryCode && /^[A-Z]{2}$/.test(countryCode)) {
    return countryCode.toLowerCase();
  }
  const fromField = asEnglishId(value);
  if (fromField && /^[a-z]{2}$/.test(fromField)) return fromField;
  return fromField;
}

function nestedField(
  value: unknown,
  key: string
): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>)[key];
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

function asAccuracy(value: unknown): CoordinateAccuracy {
  if (value === "exact" || value === "approximate" || value === "area") {
    return value;
  }
  return "approximate";
}

function asConfidenceLevel(
  value: unknown,
  confidence: number
): ConfidenceLevel {
  if (value === "high" || value === "medium" || value === "low") return value;
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.7) return "medium";
  return "low";
}

function parseCategory(value: unknown): PlaceCategory | null {
  const raw = asOptionalString(value)?.toLowerCase();
  if (raw && PLACE_CATEGORY_SET.has(raw)) {
    return raw as PlaceCategory;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asOptionalString(item))
    .filter((v): v is string => v !== null);
}

function parseAlternative(item: unknown): ModelLocationAlternative | null {
  if (!item || typeof item !== "object") return null;
  const alt = item as Record<string, unknown>;
  const placeName =
    asOptionalString(alt.placeName) ?? asOptionalString(alt.title);
  const country =
    asOptionalString(alt.country) ??
    asOptionalString(nestedField(alt.country, "name"));
  if (!placeName || !country) return null;
  let confidence = 0;
  try {
    confidence = clamp01(asNumber(alt.confidence, "alternatives.confidence"));
  } catch {
    confidence = 0;
  }
  const countryCode =
    asOptionalString(alt.countryCode)?.toUpperCase() ??
    asOptionalString(nestedField(alt.country, "code"))?.toUpperCase() ??
    null;
  const countryId = asCountryId(
    alt.countryId ?? nestedField(alt.country, "id"),
    countryCode
  );
  const cityId = asEnglishId(alt.cityId ?? nestedField(alt.city, "id"));
  const placeId = asEnglishId(alt.placeId);
  return {
    placeName,
    ...(placeId ? { placeId } : {}),
    city:
      asOptionalString(alt.city) ??
      asOptionalString(nestedField(alt.city, "name")) ??
      "",
    ...(cityId ? { cityId } : {}),
    country,
    ...(countryId ? { countryId } : {}),
    confidence,
  };
}

function parseAlternatives(value: unknown): ModelLocationAlternative[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(parseAlternative)
    .filter((v): v is ModelLocationAlternative => v !== null);
}

function validateOptionalCoords(
  lat: number | null,
  lon: number | null
): { latitude: number | null; longitude: number | null } {
  if (lat === null && lon === null) return { latitude: null, longitude: null };
  if (lat === null || lon === null) {
    return { latitude: null, longitude: null };
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error("Model coordinates are out of range.");
  }
  return { latitude: lat, longitude: lon };
}

function exactCoordinatesConfidence(accuracy: CoordinateAccuracy): number {
  switch (accuracy) {
    case "exact":
      return 0.95;
    case "approximate":
      return 0.7;
    case "area":
      return 0.4;
  }
}

/** Remove trailing commas before `]` / `}` (common model slip). */
function stripTrailingCommas(text: string): string {
  return text.replace(/,\s*(?=[\]}])/g, "");
}

/**
 * Close truncated JSON when the model hit the output token cap mid-object/array.
 * Tracks braces/brackets outside strings and finishes an open string if needed.
 */
function closeTruncatedJson(text: string): string {
  let inString = false;
  let escape = false;
  const stack: Array<"}" | "]"> = [];

  for (let i = 0; i < text.length; i++) {
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
  // Drop a dangling comma / colon after the last complete value.
  result = result.replace(/[,:]\s*$/, "");
  while (stack.length > 0) {
    result += stack.pop();
  }
  return result;
}

function tryParseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

/**
 * Strip optional markdown fences, then parse JSON.
 * Also recovers a JSON object embedded in surrounding prose (needed when
 * web_search forbids JSON mode), repairs trailing commas, and closes
 * truncated objects/arrays from max-token cutoffs.
 */
export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  const attempts: string[] = [];
  const pushAttempt = (value: string) => {
    if (value && !attempts.includes(value)) attempts.push(value);
  };

  pushAttempt(candidate);
  pushAttempt(stripTrailingCommas(candidate));

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const sliced = candidate.slice(start, end + 1);
    pushAttempt(sliced);
    pushAttempt(stripTrailingCommas(sliced));
  } else if (start >= 0) {
    // Truncated before the final `}` — try closing open structures.
    const partial = candidate.slice(start);
    pushAttempt(closeTruncatedJson(stripTrailingCommas(partial)));
  }

  // Always try a closed/repaired variant of the best candidate.
  for (const attempt of [...attempts]) {
    pushAttempt(closeTruncatedJson(stripTrailingCommas(attempt)));
  }

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return tryParseJson(attempt);
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

export function parseModelInitialIdentification(
  raw: unknown
): ModelInitialIdentification {
  if (!raw || typeof raw !== "object") {
    throw new Error("Model response is not an object.");
  }

  const body = raw as Record<string, unknown>;
  const confidence = clamp01(
    (() => {
      try {
        return asNumber(body.confidence, "confidence");
      } catch {
        return 0;
      }
    })()
  );
  const confidenceLevel = asConfidenceLevel(body.confidenceLevel, confidence);
  const nestedCoords =
    body.coordinates && typeof body.coordinates === "object"
      ? (body.coordinates as Record<string, unknown>)
      : null;
  const coords = validateOptionalCoords(
    asOptionalNumber(body.latitude ?? body.lat ?? nestedCoords?.lat),
    asOptionalNumber(body.longitude ?? body.lon ?? nestedCoords?.lon)
  );

  const placeName =
    asOptionalString(body.placeName) ?? asOptionalString(body.title);
  const city =
    asOptionalString(body.city) ??
    asOptionalString(nestedField(body.city, "name"));
  let country = asOptionalString(body.country);
  if (!country) {
    country = asOptionalString(nestedField(body.country, "name"));
  }
  if (
    !country &&
    body.city &&
    typeof body.city === "object" &&
    (body.city as Record<string, unknown>).country &&
    typeof (body.city as Record<string, unknown>).country === "object"
  ) {
    country = asOptionalString(
      (
        (body.city as Record<string, unknown>).country as Record<
          string,
          unknown
        >
      ).name
    );
  }

  const countryCode =
    asOptionalString(body.countryCode)?.toUpperCase() ??
    asOptionalString(nestedField(body.country, "code"))?.toUpperCase() ??
    null;
  const placeId = asEnglishId(body.placeId);
  const cityId = asEnglishId(body.cityId ?? nestedField(body.city, "id"));
  const countryId = asCountryId(
    body.countryId ?? nestedField(body.country, "id"),
    countryCode
  );

  const identified = asBoolean(body.identified, Boolean(placeName && country));

  return {
    identified: identified && Boolean(placeName),
    placeName,
    placeId,
    description:
      asOptionalString(body.description) ??
      asOptionalString(body.reason) ??
      "",
    city,
    cityId,
    country,
    countryId,
    countryCode,
    category: parseCategory(body.category),
    latitude: coords.latitude,
    longitude: coords.longitude,
    coordinatesAccuracy: asAccuracy(
      body.coordinatesAccuracy ??
        (body.coordinates && typeof body.coordinates === "object"
          ? (body.coordinates as Record<string, unknown>).accuracy
          : undefined)
    ),
    confidence,
    confidenceLevel,
    reason: asOptionalString(body.reason) ?? asOptionalString(body.why) ?? "",
    isDistinctive: asBoolean(body.isDistinctive, confidence >= 0.85),
    isSpecificPlace: asBoolean(body.isSpecificPlace, identified),
    hasDistinctiveEvidence: asBoolean(
      body.hasDistinctiveEvidence,
      confidence >= 0.85
    ),
    couldMatchMultipleLandmarks: asBoolean(
      body.couldMatchMultipleLandmarks,
      false
    ),
    possibleAlternatives: parseAlternatives(
      body.possibleAlternatives ?? body.alternatives
    ),
    visualClues: asStringArray(body.visualClues),
    suggestedSearchQueries: asStringArray(body.suggestedSearchQueries),
  };
}

export function parseModelVerifiedIdentification(
  raw: unknown
): ModelVerifiedIdentification {
  if (!raw || typeof raw !== "object") {
    throw new Error("Verification response is not an object.");
  }

  const body = raw as Record<string, unknown>;
  const confidence = clamp01(
    (() => {
      try {
        return asNumber(body.confidence, "confidence");
      } catch {
        return 0;
      }
    })()
  );
  const confidenceLevel = asConfidenceLevel(body.confidenceLevel, confidence);
  const nestedCoords =
    body.coordinates && typeof body.coordinates === "object"
      ? (body.coordinates as Record<string, unknown>)
      : null;
  const coords = validateOptionalCoords(
    asOptionalNumber(body.latitude ?? body.lat ?? nestedCoords?.lat),
    asOptionalNumber(body.longitude ?? body.lon ?? nestedCoords?.lon)
  );

  const placeName =
    asOptionalString(body.placeName) ?? asOptionalString(body.title);
  const identified = asBoolean(body.identified, Boolean(placeName));
  const city =
    asOptionalString(body.city) ??
    asOptionalString(nestedField(body.city, "name"));
  let country = asOptionalString(body.country);
  if (!country) {
    country = asOptionalString(nestedField(body.country, "name"));
  }
  if (
    !country &&
    body.city &&
    typeof body.city === "object" &&
    (body.city as Record<string, unknown>).country &&
    typeof (body.city as Record<string, unknown>).country === "object"
  ) {
    country = asOptionalString(
      (
        (body.city as Record<string, unknown>).country as Record<
          string,
          unknown
        >
      ).name
    );
  }

  const countryCode =
    asOptionalString(body.countryCode)?.toUpperCase() ??
    asOptionalString(nestedField(body.country, "code"))?.toUpperCase() ??
    null;
  const placeId = asEnglishId(body.placeId);
  const cityId = asEnglishId(body.cityId ?? nestedField(body.city, "id"));
  const countryId = asCountryId(
    body.countryId ?? nestedField(body.country, "id"),
    countryCode
  );

  return {
    identified: identified && Boolean(placeName),
    placeName,
    placeId,
    description: asOptionalString(body.description) ?? "",
    city,
    cityId,
    country,
    countryId,
    countryCode,
    category: parseCategory(body.category),
    latitude: coords.latitude,
    longitude: coords.longitude,
    coordinatesAccuracy: asAccuracy(body.coordinatesAccuracy),
    confidence,
    confidenceLevel,
    reason: asOptionalString(body.reason) ?? asOptionalString(body.why) ?? "",
    verificationPerformed: asBoolean(body.verificationPerformed, true),
    alternatives: parseAlternatives(body.alternatives),
  };
}

/**
 * Adaptive verification gate.
 * Skip verification only when identification is clearly specific and distinctive.
 * Famous lookalikes / multi-landmark ambiguity always require verification.
 */
export function needsVerification(
  initial: ModelInitialIdentification
): boolean {
  const seriousAlternatives = initial.possibleAlternatives.filter(
    (alt) =>
      alt.confidence >= 0.45 ||
      (initial.confidence < 0.9 &&
        alt.confidence >= Math.max(0.3, initial.confidence - 0.2))
  );

  // Any named lookalike means the famous candidate is not unique enough to skip.
  const hasNamedLookalikes = initial.possibleAlternatives.some(
    (alt) => alt.placeName.trim().length > 0
  );

  const clearlyIdentified =
    initial.identified &&
    initial.confidence >= 0.85 &&
    initial.confidenceLevel === "high" &&
    initial.isDistinctive &&
    initial.isSpecificPlace &&
    initial.hasDistinctiveEvidence &&
    !initial.couldMatchMultipleLandmarks &&
    seriousAlternatives.length === 0 &&
    !hasNamedLookalikes &&
    Boolean(initial.placeName) &&
    Boolean(initial.country);

  return !clearlyIdentified;
}

function toPublicAlternatives(
  alts: ModelLocationAlternative[]
): LocationAlternative[] {
  return alts.slice(0, 3).map((alt) => ({
    title: alt.placeName,
    ...(alt.placeId ? { placeId: alt.placeId } : {}),
    city: alt.city || undefined,
    ...(alt.cityId ? { cityId: alt.cityId } : {}),
    country: alt.country,
    ...(alt.countryId ? { countryId: alt.countryId } : {}),
    confidence: alt.confidence,
  }));
}

function emptyUnidentifiedResult(
  reason: string,
  alternatives: ModelLocationAlternative[],
  verificationPerformed: boolean
): AnalyzeLocationResult {
  return {
    identified: false,
    title: "",
    placeId: undefined,
    description: "",
    lat: 0,
    lon: 0,
    why: reason,
    city: "",
    cityId: undefined,
    country: "",
    countryId: undefined,
    countryCode: undefined,
    confidence: 0,
    confidenceLevel: "low",
    locationConfidence: 0,
    exactCoordinatesConfidence: 0,
    verificationPerformed,
    alternatives: toPublicAlternatives(alternatives),
  };
}

/**
 * Map model output → callable AnalyzeLocationResult (web contract).
 */
export function toAnalyzeLocationResult(
  analysis: ModelInitialIdentification | ModelVerifiedIdentification,
  options: { verificationPerformed: boolean }
): AnalyzeLocationResult {
  const verificationPerformed =
    "verificationPerformed" in analysis
      ? analysis.verificationPerformed
      : options.verificationPerformed;

  const alternatives =
    "alternatives" in analysis
      ? analysis.alternatives
      : analysis.possibleAlternatives;

  if (!analysis.identified || !analysis.placeName) {
    return emptyUnidentifiedResult(
      analysis.reason ||
        "The image is visually similar to multiple locations and could not be reliably identified.",
      alternatives,
      verificationPerformed
    );
  }

  const lat = analysis.latitude ?? 0;
  const lon = analysis.longitude ?? 0;

  return {
    identified: true,
    title: analysis.placeName,
    placeId: analysis.placeId ?? undefined,
    description: analysis.description || analysis.reason,
    lat,
    lon,
    why: analysis.reason,
    city: analysis.city ?? "",
    cityId: analysis.cityId ?? undefined,
    country: analysis.country ?? "",
    countryId: analysis.countryId ?? undefined,
    countryCode: analysis.countryCode ?? undefined,
    category: analysis.category ?? "other",
    confidence: analysis.confidence,
    confidenceLevel: analysis.confidenceLevel,
    locationConfidence: analysis.confidence,
    exactCoordinatesConfidence: exactCoordinatesConfidence(
      analysis.coordinatesAccuracy
    ),
    verificationPerformed,
    alternatives: toPublicAlternatives(alternatives),
  };
}

/** @deprecated kept for call sites that still reference the old name */
export type ModelLocationAnalysis = ModelInitialIdentification;

export function parseModelLocationAnalysis(
  raw: unknown
): ModelInitialIdentification {
  return parseModelInitialIdentification(raw);
}
