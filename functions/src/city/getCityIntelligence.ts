import { onCall, HttpsError } from "firebase-functions/https";
import { logger } from "firebase-functions";
import { requireAuth, assertNonEmptyString } from "../shared/auth";
import {
  DEFAULT_FUNCTIONS_REGION,
  googlePrivateApiKey,
  openaiApiKey,
} from "../shared/config";
import {
  createOpenAICityIntelligenceAnalyzer,
  toSlowCityIntelligence,
} from "../shared/openai";
import { recordAIUsage } from "../shared/aiUsage";
import {
  assertSufficientCreditUnits,
  deductCreditUnits,
} from "../shared/creditService";
import type { InsufficientAICreditsError } from "../shared/credits";
import { initAdmin } from "../shared/admin";
import {
  AI_CACHE_TTL,
  cityIntelligenceFullFingerprint,
  cityIntelligenceSlowFingerprint,
  executeCachedAI,
  logAICallMetrics,
  setAICache,
} from "../shared/ai";
import { resolveEnglishPlaceIdsFromCoords } from "../shared/resolveEnglishPlaceIds";
import { attachFrankfurterExchangeRate } from "./attachFrankfurterExchangeRate";
import {
  getReadyCityIntelligence,
  setReadyCityIntelligence,
} from "./readyCityIntelligence";
import {
  CITY_INTELLIGENCE_DISCLAIMER,
  type CityIntelligenceCityInput,
  type GetCityIntelligenceRequest,
  type GetCityIntelligenceBatchResult,
  type CityIntelligenceResult,
  type VisaInfoProvider,
} from "./types";

const MAX_CITIES = 8;

const visaInfoProviderStub: VisaInfoProvider = {
  name: "stub-visa-info",
  async getRequirements() {
    throw new Error("Visa info provider not configured");
  },
};

function asciiSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isIsoCountryId(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  // "xx" was the old broken fallback — never treat it as a real country.
  if (!trimmed || trimmed === "xx" || trimmed === "unknown") return false;
  return /^[a-z]{2}$/.test(trimmed);
}

function isAsciiCityId(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === "unknown" || trimmed === "city") return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed);
}

/**
 * Resolve ISO countryId + ASCII cityId.
 * Prefer caller ids; otherwise reverse-geocode (language=en).
 * Never returns the sentinel "xx".
 */
async function resolvePlaceIds(input: CityIntelligenceCityInput): Promise<{
  cityId: string;
  countryId: string;
}> {
  let cityId = isAsciiCityId(input.cityId)
    ? input.cityId.trim().toLowerCase()
    : "";
  let countryId = isIsoCountryId(input.countryId)
    ? input.countryId.trim().toLowerCase()
    : "";

  if (!cityId) {
    const fromName = asciiSlug(input.city);
    if (isAsciiCityId(fromName)) cityId = fromName;
  }

  if (cityId && countryId) {
    return { cityId, countryId };
  }

  const english = await resolveEnglishPlaceIdsFromCoords(input.lat, input.lon);
  if (english) {
    if (!countryId && isIsoCountryId(english.countryId)) {
      countryId = english.countryId;
    }
    if (!cityId && isAsciiCityId(english.cityId)) {
      cityId = english.cityId;
    }
  }

  // Last-resort city slug so the callable still returns a result payload.
  if (!cityId) {
    const fallback = asciiSlug(input.city);
    cityId = isAsciiCityId(fallback) ? fallback : "city";
  }

  return { cityId, countryId };
}

function parseCityEntry(raw: unknown, index: number): CityIntelligenceCityInput {
  if (!raw || typeof raw !== "object") {
    throw new HttpsError(
      "invalid-argument",
      `cities[${index}] must be an object.`
    );
  }
  const body = raw as Record<string, unknown>;
  assertNonEmptyString(body.city, `cities[${index}].city`);
  assertNonEmptyString(body.country, `cities[${index}].country`);

  if (typeof body.lat !== "number" || typeof body.lon !== "number") {
    throw new HttpsError(
      "invalid-argument",
      `cities[${index}].lat and lon must be numbers.`
    );
  }

  if (
    !Number.isFinite(body.lat) ||
    !Number.isFinite(body.lon) ||
    body.lat < -90 ||
    body.lat > 90 ||
    body.lon < -180 ||
    body.lon > 180
  ) {
    throw new HttpsError(
      "invalid-argument",
      `cities[${index}] lat/lon must be valid geographic coordinates.`
    );
  }

  return {
    city: String(body.city).trim(),
    country: String(body.country).trim(),
    lat: body.lat,
    lon: body.lon,
    cityId:
      typeof body.cityId === "string" && body.cityId.trim()
        ? body.cityId.trim()
        : undefined,
    countryId:
      typeof body.countryId === "string" && body.countryId.trim()
        ? body.countryId.trim()
        : undefined,
  };
}

function parseRequest(data: unknown): GetCityIntelligenceRequest {
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request body is required.");
  }

  const body = data as Record<string, unknown>;

  // Preferred: cities[]
  let cities: CityIntelligenceCityInput[] = [];
  if (Array.isArray(body.cities)) {
    if (body.cities.length === 0) {
      throw new HttpsError("invalid-argument", "cities must not be empty.");
    }
    if (body.cities.length > MAX_CITIES) {
      throw new HttpsError(
        "invalid-argument",
        `At most ${MAX_CITIES} cities are supported.`
      );
    }
    cities = body.cities.map((entry, index) => parseCityEntry(entry, index));
  } else if (
    typeof body.city === "string" &&
    typeof body.country === "string"
  ) {
    // Legacy single-city shape → normalize to cities[]
    cities = [
      parseCityEntry(
        {
          city: body.city,
          country: body.country,
          lat: body.lat,
          lon: body.lon,
          cityId: body.cityId,
          countryId: body.countryId,
        },
        0
      ),
    ];
  } else {
    throw new HttpsError(
      "invalid-argument",
      "Provide cities: [{ city, country, lat, lon }] (1+ entries)."
    );
  }

  return {
    cities,
    userCountry:
      typeof body.userCountry === "string" && body.userCountry.trim()
        ? body.userCountry.trim()
        : undefined,
    userCurrency:
      typeof body.userCurrency === "string" && body.userCurrency.trim()
        ? body.userCurrency.trim().toUpperCase()
        : undefined,
    language:
      typeof body.language === "string" && body.language.trim()
        ? body.language.trim()
        : undefined,
  };
}

function mapOpenAIError(err: unknown): HttpsError {
  const message =
    err instanceof Error ? err.message : "City intelligence failed.";

  if (/OPENAI_API_KEY/i.test(message)) {
    return new HttpsError(
      "failed-precondition",
      "OPENAI_API_KEY is not configured for Cloud Functions."
    );
  }

  if (/Invalid|missing|not an object|empty/i.test(message)) {
    return new HttpsError(
      "internal",
      "The city intelligence model returned an invalid response. Please try again."
    );
  }

  return new HttpsError("internal", message);
}

type CityResolveOutcome = {
  result: CityIntelligenceResult;
  billable: boolean;
  cost: number;
  usageTokens: number;
  outcome: string;
};

async function resolveOneCity(params: {
  uid: string;
  city: CityIntelligenceCityInput;
  userCountry: string;
  userCurrency: string;
  language: string;
  started: number;
  /** When false, skip credit pre-check (batch already checked worst-case). */
  checkCredits: boolean;
}): Promise<CityResolveOutcome> {
  const {
    uid,
    city,
    userCountry,
    userCurrency,
    language,
    started,
    checkCredits,
  } = params;

  const { cityId, countryId } = await resolvePlaceIds(city);

  const fullFingerprint = cityIntelligenceFullFingerprint({
    city: city.city,
    country: city.country,
    lat: city.lat,
    lon: city.lon,
    userCountry,
    userCurrency,
    language,
  });
  const slowFingerprint = cityIntelligenceSlowFingerprint({
    city: city.city,
    country: city.country,
    lat: city.lat,
    lon: city.lon,
    language,
  });

  const cachedOrLive = await executeCachedAI<CityIntelligenceResult>({
    functionName: "getCityIntelligence",
    fingerprint: fullFingerprint,
    operation: "getCityIntelligence",
    ttlMs: AI_CACHE_TTL.cityIntelligenceFull,
    execute: async () => {
      if (checkCredits) {
        const creditCheck = await assertSufficientCreditUnits(
          uid,
          "getCityIntelligence",
          1
        );
        if (!creditCheck.ok) {
          throw Object.assign(
            new Error("INSUFFICIENT_AI_CREDITS"),
            creditCheck.response
          );
        }
      }

      const analyzer = createOpenAICityIntelligenceAnalyzer();
      const userLanguage = language.trim() || "en";
      const primaryLanguage =
        userLanguage.split(/[-_]/)[0]?.toLowerCase() || "en";

      // Shared, language-agnostic city facts — reuse for every traveler.
      const ready = await getReadyCityIntelligence({
        countryId,
        cityId,
        cityName: city.city,
        countryName: city.country,
      });

      // Complete ready → only AI for visa (cheapest). FX via Frankfurter after.
      if (ready.complete && ready.model) {
        logAICallMetrics({
          functionName: "getCityIntelligence",
          outcome: "partial_cache",
          fingerprint: `${countryId}/${cityId}`,
          cacheHit: true,
          durationMs: Date.now() - started,
          extra: { phase: "ready_complete_visa_only" },
        });

        const { result, raw, metrics } = await analyzer.analyzeVisaOnly({
          city: city.city,
          country: city.country,
          userCountry,
          language: userLanguage,
          cityId,
          countryId,
          slow: ready.model,
        });

        await setAICache({
          fingerprint: slowFingerprint,
          operation: "getCityIntelligenceSlow",
          result: toSlowCityIntelligence(raw),
          ttlMs: AI_CACHE_TTL.cityIntelligenceSlow,
          model: metrics.model,
        });

        return {
          result: {
            ...result,
            disclaimer: CITY_INTELLIGENCE_DISCLAIMER,
          },
          model: metrics.model,
          usage: metrics.usage,
          cost: metrics.cost,
        };
      }

      // Missing / incomplete ready → generate shared facts in English once,
      // save flat for everyone, then localize visa if the user isn't on English.
      logAICallMetrics({
        functionName: "getCityIntelligence",
        outcome: "miss",
        fingerprint: `${countryId}/${cityId}`,
        cacheHit: false,
        durationMs: Date.now() - started,
        extra: {
          phase: "seed_ready_english",
          missing: ready.missing.join(",") || "all",
        },
      });

      const seeded = await analyzer.analyze({
        city: city.city,
        country: city.country,
        lat: city.lat,
        lon: city.lon,
        userCountry,
        userCurrency,
        language: "en",
        cityId,
        countryId,
      });

      await setReadyCityIntelligence({
        countryId,
        cityId,
        cityName: city.city,
        countryName: city.country,
        raw: seeded.raw,
      });

      let result = seeded.result;
      let raw = seeded.raw;
      let metrics = seeded.metrics;

      if (primaryLanguage !== "en") {
        const localized = await analyzer.analyzeVisaOnly({
          city: city.city,
          country: city.country,
          userCountry,
          language: userLanguage,
          cityId,
          countryId,
          slow: toSlowCityIntelligence(seeded.raw),
        });
        result = localized.result;
        raw = localized.raw;
        metrics = {
          model: seeded.metrics.model,
          usage: {
            promptTokens:
              seeded.metrics.usage.promptTokens +
              localized.metrics.usage.promptTokens,
            completionTokens:
              seeded.metrics.usage.completionTokens +
              localized.metrics.usage.completionTokens,
            totalTokens:
              seeded.metrics.usage.totalTokens +
              localized.metrics.usage.totalTokens,
          },
          cost: seeded.metrics.cost + localized.metrics.cost,
        };
      }

      await setAICache({
        fingerprint: slowFingerprint,
        operation: "getCityIntelligenceSlow",
        result: toSlowCityIntelligence(raw),
        ttlMs: AI_CACHE_TTL.cityIntelligenceSlow,
        model: metrics.model,
        promptTokens: metrics.usage.promptTokens,
        completionTokens: metrics.usage.completionTokens,
        cost: metrics.cost,
      });

      return {
        result: {
          ...result,
          disclaimer: CITY_INTELLIGENCE_DISCLAIMER,
        },
        model: metrics.model,
        usage: metrics.usage,
        cost: metrics.cost,
      };
    },
  });

  const withFx = await attachFrankfurterExchangeRate(
    cachedOrLive.result,
    userCurrency
  );

  return {
    result: withFx,
    billable: cachedOrLive.billable,
    cost: cachedOrLive.cost ?? 0,
    usageTokens: cachedOrLive.usage?.totalTokens ?? 0,
    outcome: cachedOrLive.outcome,
  };
}

export type GetCityIntelligenceResponse =
  | GetCityIntelligenceBatchResult
  | InsufficientAICreditsError;

/**
 * getCityIntelligence — one or more cities.
 * Credits: 5 per billable city (cache hits are free).
 */
export const getCityIntelligence = onCall(
  {
    region: DEFAULT_FUNCTIONS_REGION,
    secrets: [openaiApiKey, googlePrivateApiKey],
    invoker: "public",
    cors: true,
    timeoutSeconds: 180,
    memory: "512MiB",
  },
  async (request): Promise<GetCityIntelligenceResponse> => {
    initAdmin();
    const uid = requireAuth(request);
    const input = parseRequest(request.data);
    const started = Date.now();

    const userCountry = input.userCountry ?? "Unknown";
    const userCurrency = input.userCurrency ?? "USD";
    const language = input.language ?? "en";
    const generatedAt = new Date().toISOString();

    void visaInfoProviderStub;

    try {
      // Worst-case credit hold: every city misses cache.
      const creditCheck = await assertSufficientCreditUnits(
        uid,
        "getCityIntelligence",
        input.cities.length
      );
      if (!creditCheck.ok) {
        return creditCheck.response;
      }

      const results: CityIntelligenceResult[] = [];
      let billableUnits = 0;
      let totalCost = 0;
      let totalTokens = 0;

      // Resolve cities in parallel — sequential AI calls stacked latency badly
      // on multi-destination trips (and gpt-6-luna cold seeds).
      const outcomes = await Promise.all(
        input.cities.map((city) =>
          resolveOneCity({
            uid,
            city,
            userCountry,
            userCurrency,
            language,
            started,
            checkCredits: false,
          })
        )
      );

      for (const outcome of outcomes) {
        results.push(outcome.result);
        if (outcome.billable) billableUnits += 1;
        totalCost += outcome.cost;
        totalTokens += outcome.usageTokens;
      }

      if (billableUnits > 0) {
        await deductCreditUnits(uid, "getCityIntelligence", billableUnits);
        await recordAIUsage({
          userId: uid,
          operation: "getCityIntelligence",
          cost: totalCost,
        });
      }

      logger.info("getCityIntelligence completed", {
        uid,
        cityCount: results.length,
        billableUnits,
        hasFx: results.some((r) => Boolean(r.exchangeRate)),
        hasVisa: results.some((r) => Boolean(r.visa)),
        tokens: totalTokens,
        cost: totalCost,
        durationMs: Date.now() - started,
      });

      return {
        results,
        disclaimer: CITY_INTELLIGENCE_DISCLAIMER,
        generatedAt,
      };
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "error" in err &&
        (err as { error: unknown }).error === "INSUFFICIENT_AI_CREDITS"
      ) {
        const response = err as InsufficientAICreditsError;
        logger.info("getCityIntelligence blocked: insufficient credits", {
          uid,
          requiredCredits: response.requiredCredits,
          availableCredits: response.availableCredits,
        });
        return response;
      }

      logAICallMetrics({
        functionName: "getCityIntelligence",
        outcome: "error",
        durationMs: Date.now() - started,
        errorType: err instanceof Error ? err.constructor.name : "unknown",
      });

      logger.error("getCityIntelligence failed", {
        uid,
        cityCount: input.cities.length,
        error: err instanceof Error ? err.message : String(err),
      });

      if (err instanceof HttpsError) throw err;
      throw mapOpenAIError(err);
    }
  }
);
