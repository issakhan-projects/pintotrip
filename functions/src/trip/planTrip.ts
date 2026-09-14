import { onCall, HttpsError } from "firebase-functions/https";
import { logger } from "firebase-functions";
import { requireAuth, assertNonEmptyString } from "../shared/auth";
import { DEFAULT_FUNCTIONS_REGION, openaiApiKey } from "../shared/config";
import { createOpenAITripPlanner } from "../shared/openai";
import { recordAIUsage } from "../shared/aiUsage";
import {
  assertSufficientCredits,
  deductCredits,
} from "../shared/creditService";
import type { InsufficientAICreditsError } from "../shared/credits";
import { getRequiredCredits } from "../shared/credits";
import { initAdmin } from "../shared/admin";
import {
  AI_CACHE_TTL,
  executeCachedAI,
  planTripFingerprint,
} from "../shared/ai";
import {
  LEISURE_TYPES,
  type LeisureType,
  type PlanTripExistingDay,
  type PlanTripMode,
  type PlanTripRequest,
  type PlanTripResult,
  type PlannedDaySuggestion,
} from "./types";

function isLeisureType(value: unknown): value is LeisureType {
  return (
    typeof value === "string" &&
    (LEISURE_TYPES as readonly string[]).includes(value)
  );
}

/** Accept country id/code, common labels, and holy-city destinations. */
function isSaudiArabiaDestination(input: {
  countryName: string;
  countryId?: string;
  cityName?: string;
  cityId?: string;
}): boolean {
  const countryId = input.countryId?.trim().toLowerCase() ?? "";
  if (countryId === "sa" || countryId === "ksa") return true;

  const country = input.countryName.trim().toLowerCase();
  if (country === "sa" || country === "ksa") return true;
  if (country.includes("saudi")) return true;
  // المملكة العربية السعودية / السعودية
  if (country.includes("سعود")) return true;

  const city = `${input.cityId ?? ""} ${input.cityName ?? ""}`
    .trim()
    .toLowerCase();
  if (
    /\b(makkah|mecca|madinah|medina|jeddah|riyadh)\b/.test(city) ||
    city.includes("مكة") ||
    city.includes("مدينة") ||
    city.includes("المدينة") ||
    city.includes("جدة") ||
    city.includes("الرياض")
  ) {
    return true;
  }

  return false;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseExistingDays(value: unknown): PlanTripExistingDay[] {
  if (!Array.isArray(value)) {
    throw new HttpsError(
      "invalid-argument",
      "existingDays must be an array."
    );
  }

  return value.map((row, index) => {
    if (!row || typeof row !== "object") {
      throw new HttpsError(
        "invalid-argument",
        `existingDays[${index}] must be an object.`
      );
    }
    const body = row as Record<string, unknown>;
    if (typeof body.day !== "number" || !Number.isFinite(body.day)) {
      throw new HttpsError(
        "invalid-argument",
        `existingDays[${index}].day must be a number.`
      );
    }
    assertNonEmptyString(body.date, `existingDays[${index}].date`);
    if (!isIsoDate(body.date.trim())) {
      throw new HttpsError(
        "invalid-argument",
        `existingDays[${index}].date must be YYYY-MM-DD.`
      );
    }
    const placeTitles = Array.isArray(body.placeTitles)
      ? body.placeTitles
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    return {
      day: Math.floor(body.day),
      date: body.date.trim(),
      title:
        typeof body.title === "string" && body.title.trim()
          ? body.title.trim()
          : undefined,
      placeTitles,
    };
  });
}

function parseRequest(data: unknown): PlanTripRequest {
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request body is required.");
  }

  const body = data as Record<string, unknown>;
  assertNonEmptyString(body.tripId, "tripId");
  assertNonEmptyString(body.startDate, "startDate");
  assertNonEmptyString(body.endDate, "endDate");

  if (!isIsoDate(body.startDate.trim()) || !isIsoDate(body.endDate.trim())) {
    throw new HttpsError(
      "invalid-argument",
      "startDate and endDate must be YYYY-MM-DD."
    );
  }

  if (!isLeisureType(body.leisureType)) {
    throw new HttpsError(
      "invalid-argument",
      `leisureType must be one of: ${LEISURE_TYPES.join(", ")}.`
    );
  }

  const destRaw = body.destination;
  if (!destRaw || typeof destRaw !== "object") {
    throw new HttpsError("invalid-argument", "destination is required.");
  }
  const dest = destRaw as Record<string, unknown>;
  assertNonEmptyString(dest.cityName, "destination.cityName");
  assertNonEmptyString(dest.countryName, "destination.countryName");

  const countryName = dest.countryName.trim();
  const countryId =
    typeof dest.countryId === "string" && dest.countryId.trim()
      ? dest.countryId.trim().toLowerCase()
      : undefined;
  const cityId =
    typeof dest.cityId === "string" && dest.cityId.trim()
      ? dest.cityId.trim().toLowerCase()
      : undefined;
  const cityName = dest.cityName.trim();

  if (
    body.leisureType === "umrah" &&
    !isSaudiArabiaDestination({
      countryName,
      countryId,
      cityName,
      cityId,
    })
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Umrah planner is only available for trips in Saudi Arabia."
    );
  }

  const lat =
    typeof dest.lat === "number" && Number.isFinite(dest.lat)
      ? dest.lat
      : undefined;
  const lon =
    typeof dest.lon === "number" && Number.isFinite(dest.lon)
      ? dest.lon
      : undefined;

  const mode: PlanTripMode =
    body.mode === "regenerate" ? "regenerate" : "generate";

  const currencyRaw =
    typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";
  const currency =
    currencyRaw && /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : undefined;

  return {
    tripId: body.tripId.trim(),
    destination: {
      cityName,
      countryName,
      ...(countryId ? { countryId } : {}),
      ...(cityId ? { cityId } : {}),
      lat,
      lon,
    },
    startDate: body.startDate.trim(),
    endDate: body.endDate.trim(),
    leisureType: body.leisureType,
    mode,
    language:
      typeof body.language === "string" && body.language.trim()
        ? body.language.trim()
        : undefined,
    ...(currency ? { currency } : {}),
    existingDays: parseExistingDays(body.existingDays),
  };
}

function filterToEmptyDays(
  suggestions: PlannedDaySuggestion[],
  emptyDayNumbers: Set<number>
): PlannedDaySuggestion[] {
  return suggestions
    .filter((d) => emptyDayNumbers.has(d.day))
    .map((d) => ({
      ...d,
      places: d.places.slice(0, 4),
    }))
    .filter((d) => d.places.length > 0)
    .sort((a, b) => a.day - b.day);
}

function mapOpenAIError(err: unknown): HttpsError {
  const message =
    err instanceof Error ? err.message : "Trip planning failed.";

  if (/OPENAI_API_KEY/i.test(message)) {
    return new HttpsError(
      "failed-precondition",
      "OPENAI_API_KEY is not configured for Cloud Functions."
    );
  }

  if (/Invalid|missing|not an object|empty|no usable/i.test(message)) {
    return new HttpsError(
      "internal",
      "The trip planner model returned an invalid response. Please try again."
    );
  }

  return new HttpsError("internal", message);
}

export type PlanTripResponse = PlanTripResult | InsufficientAICreditsError;

/**
 * planTrip
 *
 * Pipeline:
 * 1. Authenticate caller
 * 2. Validate AI credits (20 generate / 10 regenerate) BEFORE OpenAI
 * 3. Suggest places only for empty itinerary days for the leisure type
 * 4. On success: deduct credits + record aiUsage
 * 5. On AI failure: do not deduct credits
 *
 * Persistence of locations / itinerary is done by the client after user confirms.
 */
export const planTrip = onCall(
  {
    region: DEFAULT_FUNCTIONS_REGION,
    secrets: [openaiApiKey],
    invoker: "public",
    cors: true,
    timeoutSeconds: 180,
    memory: "512MiB",
  },
  async (request): Promise<PlanTripResponse> => {
    initAdmin();
    const uid = requireAuth(request);
    const input = parseRequest(request.data);

    const emptyDays = input.existingDays.filter(
      (d) => d.placeTitles.length === 0
    );
    const occupiedDays = input.existingDays.filter(
      (d) => d.placeTitles.length > 0
    );

    if (emptyDays.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "All trip days already have places. Clear a day or extend dates first."
      );
    }

    const operation =
      input.mode === "regenerate" ? "planTripRegenerate" : "planTrip";

    const emptyDaysKey = JSON.stringify(
      emptyDays.map((d) => ({ day: d.day, date: d.date }))
    );
    const occupiedDaysKey = JSON.stringify(
      occupiedDays.map((d) => ({
        day: d.day,
        date: d.date,
        titles: d.placeTitles,
      }))
    );
    const fingerprint = planTripFingerprint({
      cityName: input.destination.cityName,
      countryName: input.destination.countryName,
      leisureType: input.leisureType,
      language: input.language ?? "en",
      currency: input.currency ?? "USD",
      mode: input.mode ?? "generate",
      emptyDaysKey,
      occupiedDaysKey,
      lat: input.destination.lat,
      lon: input.destination.lon,
    });

    try {
      const cachedOrLive = await executeCachedAI<{
        days: PlannedDaySuggestion[];
        model: string;
      }>({
        functionName: "planTrip",
        fingerprint,
        operation: "planTrip",
        ttlMs: AI_CACHE_TTL.planTrip,
        // regenerate always needs a fresh plan; still dedupe in-flight.
        skipCache: input.mode === "regenerate",
        execute: async () => {
          const creditCheck = await assertSufficientCredits(uid, operation);
          if (!creditCheck.ok) {
            throw Object.assign(
              new Error("INSUFFICIENT_AI_CREDITS"),
              creditCheck.response
            );
          }

          const analyzer = createOpenAITripPlanner();
          const { resultDays, metrics } = await analyzer.plan({
            cityName: input.destination.cityName,
            countryName: input.destination.countryName,
            lat: input.destination.lat,
            lon: input.destination.lon,
            leisureType: input.leisureType,
            language: input.language ?? "en",
            currency: input.currency ?? "USD",
            emptyDays,
            occupiedDays,
          });

          const emptyDayNumbers = new Set(emptyDays.map((d) => d.day));
          const days = filterToEmptyDays(resultDays, emptyDayNumbers);

          if (days.length === 0) {
            throw new Error("Plan trip model returned no usable empty days.");
          }

          const dateByDay = new Map(emptyDays.map((d) => [d.day, d.date]));
          const normalizedDays = days.map((d) => ({
            ...d,
            date: dateByDay.get(d.day) ?? d.date,
          }));

          return {
            result: { days: normalizedDays, model: metrics.model },
            model: metrics.model,
            usage: metrics.usage,
            cost: metrics.cost,
          };
        },
      });

      let remainingCredits = 0;
      let creditsCharged = 0;
      if (cachedOrLive.billable) {
        remainingCredits = await deductCredits(uid, operation);
        creditsCharged = getRequiredCredits(operation);
        await recordAIUsage({
          operation,
          cost: cachedOrLive.cost,
          userId: uid,
        });
      } else {
        // Cache/dedupe hit — report current balance without charging.
        const balanceCheck = await assertSufficientCredits(uid, operation);
        remainingCredits = balanceCheck.ok
          ? balanceCheck.availableCredits
          : balanceCheck.response.availableCredits;
      }

      logger.info("planTrip success", {
        uid,
        tripId: input.tripId,
        leisureType: input.leisureType,
        mode: input.mode ?? "generate",
        emptyDayCount: emptyDays.length,
        filledDayCount: cachedOrLive.result.days.length,
        placeCount: cachedOrLive.result.days.reduce(
          (n, d) => n + d.places.length,
          0
        ),
        creditsCharged,
        outcome: cachedOrLive.outcome,
        billable: cachedOrLive.billable,
      });

      return {
        success: true,
        leisureType: input.leisureType,
        days: cachedOrLive.result.days,
        creditsCharged,
        remainingCredits,
        model: cachedOrLive.result.model,
      };
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "error" in err &&
        (err as { error: unknown }).error === "INSUFFICIENT_AI_CREDITS"
      ) {
        const response = err as InsufficientAICreditsError;
        logger.info("planTrip blocked: insufficient credits", {
          uid,
          operation,
          requiredCredits: response.requiredCredits,
          availableCredits: response.availableCredits,
        });
        return response;
      }

      logger.error("planTrip failed", {
        uid,
        tripId: input.tripId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw mapOpenAIError(err);
    }
  }
);
