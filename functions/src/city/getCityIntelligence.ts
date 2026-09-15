import { onCall, HttpsError } from "firebase-functions/https";
import { logger } from "firebase-functions";
import { requireAuth, assertNonEmptyString } from "../shared/auth";
import { DEFAULT_FUNCTIONS_REGION, openaiApiKey } from "../shared/config";
import {
  createOpenAICityIntelligenceAnalyzer,
  toSlowCityIntelligence,
} from "../shared/openai";
import { recordAIUsage } from "../shared/aiUsage";
import {
  assertSufficientCredits,
  deductCredits,
} from "../shared/creditService";
import type { InsufficientAICreditsError } from "../shared/credits";
import { initAdmin } from "../shared/admin";
import {
  AI_CACHE_TTL,
  cityIntelligenceFullFingerprint,
  cityIntelligenceSlowFingerprint,
  executeCachedAI,
  getAICache,
  logAICallMetrics,
  setAICache,
} from "../shared/ai";
import type { ModelCityIntelligence } from "./parseModelResponse";
import { attachFrankfurterExchangeRate } from "./attachFrankfurterExchangeRate";
import {
  CITY_INTELLIGENCE_DISCLAIMER,
  type GetCityIntelligenceRequest,
  type CityIntelligenceResult,
  type VisaInfoProvider,
} from "./types";

/**
 * Provider stubs — wire authoritative APIs later.
 * Exchange rates use Frankfurter (see attachFrankfurterExchangeRate).
 */
const visaInfoProviderStub: VisaInfoProvider = {
  name: "stub-visa-info",
  async getRequirements() {
    throw new Error("Visa info provider not configured");
  },
};

function parseRequest(data: unknown): GetCityIntelligenceRequest {
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request body is required.");
  }

  const body = data as Record<string, unknown>;
  assertNonEmptyString(body.city, "city");
  assertNonEmptyString(body.country, "country");

  if (typeof body.lat !== "number" || typeof body.lon !== "number") {
    throw new HttpsError(
      "invalid-argument",
      "lat and lon must be numbers."
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
      "lat/lon must be valid geographic coordinates."
    );
  }

  return {
    city: body.city.trim(),
    country: body.country.trim(),
    lat: body.lat,
    lon: body.lon,
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

export type GetCityIntelligenceResponse =
  | CityIntelligenceResult
  | InsufficientAICreditsError;

/**
 * getCityIntelligence
 *
 * Pipeline:
 * 1. Authenticate caller
 * 2. Full-result cache → return (no credits)
 * 3. Slow-cache hit → slim time-sensitive OpenAI call + merge
 * 4. Else full OpenAI synthesis
 * 5. Credits only when billable AI ran
 * 6. Attach Frankfurter mid-market FX (never from the model)
 */
export const getCityIntelligence = onCall(
  {
    region: DEFAULT_FUNCTIONS_REGION,
    secrets: [openaiApiKey],
    invoker: "public",
    cors: true,
    timeoutSeconds: 90,
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

    const fullFingerprint = cityIntelligenceFullFingerprint({
      city: input.city,
      country: input.country,
      lat: input.lat,
      lon: input.lon,
      userCountry,
      userCurrency,
      language,
    });
    const slowFingerprint = cityIntelligenceSlowFingerprint({
      city: input.city,
      country: input.country,
      lat: input.lat,
      lon: input.lon,
      language,
    });

    void visaInfoProviderStub;

    try {
      const cachedOrLive = await executeCachedAI<CityIntelligenceResult>({
        functionName: "getCityIntelligence",
        fingerprint: fullFingerprint,
        operation: "getCityIntelligence",
        ttlMs: AI_CACHE_TTL.cityIntelligenceFull,
        execute: async () => {
          const creditCheck = await assertSufficientCredits(
            uid,
            "getCityIntelligence"
          );
          if (!creditCheck.ok) {
            throw Object.assign(
              new Error("INSUFFICIENT_AI_CREDITS"),
              creditCheck.response
            );
          }

          const analyzer = createOpenAICityIntelligenceAnalyzer();
          const slowCached =
            await getAICache<ModelCityIntelligence>(slowFingerprint);

          if (slowCached?.result) {
            logAICallMetrics({
              functionName: "getCityIntelligence",
              outcome: "partial_cache",
              fingerprint: slowFingerprint,
              cacheHit: true,
              durationMs: Date.now() - started,
              extra: { phase: "slow_hit_time_sensitive" },
            });

            const { result, raw, metrics } =
              await analyzer.analyzeTimeSensitive({
                ...input,
                userCountry,
                userCurrency,
                language,
                slow: slowCached.result,
              });

            const payload: CityIntelligenceResult = {
              ...result,
              disclaimer: CITY_INTELLIGENCE_DISCLAIMER,
            };

            // Refresh slow cache TTL opportunistically (content unchanged).
            await setAICache({
              fingerprint: slowFingerprint,
              operation: "getCityIntelligenceSlow",
              result: toSlowCityIntelligence(raw),
              ttlMs: AI_CACHE_TTL.cityIntelligenceSlow,
              model: metrics.model,
            });

            return {
              result: payload,
              model: metrics.model,
              usage: metrics.usage,
              cost: metrics.cost,
            };
          }

          const { result, raw, metrics } = await analyzer.analyze({
            ...input,
            userCountry,
            userCurrency,
            language,
          });

          const payload: CityIntelligenceResult = {
            ...result,
            disclaimer: CITY_INTELLIGENCE_DISCLAIMER,
          };

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
            result: payload,
            model: metrics.model,
            usage: metrics.usage,
            cost: metrics.cost,
          };
        },
      });

      if (cachedOrLive.billable) {
        await deductCredits(uid, "getCityIntelligence");
        await recordAIUsage({
          userId: uid,
          operation: "getCityIntelligence",
          cost: cachedOrLive.cost,
        });
      }

      // Always refresh FX from Frankfurter (even on AI cache hits).
      const result = await attachFrankfurterExchangeRate(
        cachedOrLive.result,
        userCurrency
      );

      logger.info("getCityIntelligence completed", {
        uid,
        city: input.city,
        country: input.country,
        currency: result.currency,
        hasFx: Boolean(result.exchangeRate),
        hasVisa: Boolean(result.visaRequirements),
        outcome: cachedOrLive.outcome,
        billable: cachedOrLive.billable,
        tokens: cachedOrLive.usage?.totalTokens ?? 0,
        cost: cachedOrLive.cost,
        durationMs: Date.now() - started,
      });

      return result;
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
        fingerprint: fullFingerprint,
        durationMs: Date.now() - started,
        errorType:
          err instanceof Error ? err.constructor.name : "unknown",
      });

      logger.error("getCityIntelligence failed", {
        uid,
        city: input.city,
        country: input.country,
        error: err instanceof Error ? err.message : String(err),
      });

      if (err instanceof HttpsError) throw err;
      throw mapOpenAIError(err);
    }
  }
);
