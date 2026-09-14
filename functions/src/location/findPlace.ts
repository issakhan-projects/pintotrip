import { onCall, HttpsError } from "firebase-functions/https";
import { logger } from "firebase-functions";
import { requireAuth, assertNonEmptyString } from "../shared/auth";
import { DEFAULT_FUNCTIONS_REGION, openaiApiKey } from "../shared/config";
import { createOpenAILocationAnalyzer } from "../shared/openai";
import { recordAIUsage } from "../shared/aiUsage";
import {
  assertSufficientCredits,
  deductCredits,
} from "../shared/creditService";
import type { InsufficientAICreditsError } from "../shared/credits";
import { initAdmin } from "../shared/admin";
import {
  AI_CACHE_TTL,
  executeCachedAI,
  findPlaceImageFingerprint,
  findPlaceLinkFingerprint,
  hashImageInput,
  logAICallMetrics,
} from "../shared/ai";
import type {
  AnalyzeLocationRequest,
  AnalyzeLocationResult,
} from "./types";

function parseRequest(data: unknown): AnalyzeLocationRequest {
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request body is required.");
  }

  const body = data as Record<string, unknown>;
  const type = body.type;
  const language =
    typeof body.language === "string" && body.language.trim()
      ? body.language.trim()
      : undefined;

  if (type === "image") {
    assertNonEmptyString(body.imageUrl, "imageUrl");
    return {
      type: "image",
      imageUrl: body.imageUrl.trim(),
      language,
    };
  }

  if (type === "link") {
    assertNonEmptyString(body.link, "link");
    return { type: "link", link: body.link.trim(), language };
  }

  throw new HttpsError(
    "invalid-argument",
    'Request type must be "image" or "link".'
  );
}

function mapOpenAIError(err: unknown): HttpsError {
  const message =
    err instanceof Error ? err.message : "Location analysis failed.";

  if (/OPENAI_API_KEY/i.test(message)) {
    return new HttpsError(
      "failed-precondition",
      "OPENAI_API_KEY is not configured for Cloud Functions."
    );
  }

  if (
    /Invalid|missing|out of range|not an object|empty|valid JSON|Expected|JSON/i.test(
      message
    )
  ) {
    return new HttpsError(
      "internal",
      "The location model returned an invalid response. Please try again."
    );
  }

  return new HttpsError("internal", message);
}

export type FindPlaceResponse =
  | AnalyzeLocationResult
  | InsufficientAICreditsError;

/**
 * findPlace
 *
 * Adaptive verification pipeline:
 * 1. Authenticate caller
 * 2. Fingerprint + cache / in-flight dedupe (no credits on cache hit)
 * 3. Validate AI credits (findPlace = 10) BEFORE OpenAI
 * 4. Accept image URL or link
 * 5. Initial vision/text identification (no web search)
 * 6. If uncertain → web-search verification
 * 7. On success: deduct credits only when billable + record aiUsage
 * 8. On AI failure: do not deduct credits
 */
export const findPlace = onCall(
  {
    region: DEFAULT_FUNCTIONS_REGION,
    secrets: [openaiApiKey],
    invoker: "public",
    cors: true,
    timeoutSeconds: 180,
    memory: "512MiB",
  },
  async (request): Promise<FindPlaceResponse> => {
    initAdmin();
    const uid = requireAuth(request);
    const input = parseRequest(request.data);
    const language = input.language?.trim() || "en";
    const started = Date.now();

    let fingerprint: string;
    try {
      if (input.type === "image") {
        const imageContentHash = await hashImageInput(input.imageUrl);
        fingerprint = findPlaceImageFingerprint({
          imageContentHash,
          language,
        });
      } else {
        fingerprint = findPlaceLinkFingerprint({
          link: input.link,
          language,
        });
      }
    } catch (err) {
      logger.error("findPlace fingerprint failed", {
        uid,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError("internal", "Could not prepare place analysis.");
    }

    try {
      const cachedOrLive = await executeCachedAI<AnalyzeLocationResult>({
        functionName: "findPlace",
        fingerprint,
        operation: "findPlace",
        ttlMs: AI_CACHE_TTL.findPlace,
        execute: async () => {
          // Credits only when we are about to call OpenAI (leader path).
          const creditCheck = await assertSufficientCredits(uid, "findPlace");
          if (!creditCheck.ok) {
            // Propagate as a typed error so waiters don't cache it.
            const err = Object.assign(
              new Error("INSUFFICIENT_AI_CREDITS"),
              creditCheck.response
            );
            throw err;
          }

          const analyzer = createOpenAILocationAnalyzer();
          const { result, metrics } =
            input.type === "image"
              ? await analyzer.analyzeImage(input.imageUrl, language)
              : await analyzer.analyzeLink(input.link, language);

          return {
            result,
            model: metrics.model,
            usage: metrics.usage,
            cost: metrics.cost,
          };
        },
      });

      if (cachedOrLive.billable) {
        await deductCredits(uid, "findPlace");
        await recordAIUsage({
          userId: uid,
          operation: "findPlace",
          cost: cachedOrLive.cost,
        });
      }

      logger.info("findPlace completed", {
        uid,
        type: input.type,
        language,
        identified: cachedOrLive.result.identified,
        title: cachedOrLive.result.title,
        confidence: cachedOrLive.result.confidence,
        verificationPerformed: cachedOrLive.result.verificationPerformed,
        outcome: cachedOrLive.outcome,
        billable: cachedOrLive.billable,
        tokens: cachedOrLive.usage?.totalTokens ?? 0,
        cost: cachedOrLive.cost,
        durationMs: Date.now() - started,
      });

      return cachedOrLive.result;
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "error" in err &&
        (err as { error: unknown }).error === "INSUFFICIENT_AI_CREDITS"
      ) {
        const response = err as InsufficientAICreditsError;
        logger.info("findPlace blocked: insufficient credits", {
          uid,
          requiredCredits: response.requiredCredits,
          availableCredits: response.availableCredits,
        });
        return response;
      }

      logAICallMetrics({
        functionName: "findPlace",
        outcome: "error",
        fingerprint,
        durationMs: Date.now() - started,
        errorType:
          err instanceof Error ? err.constructor.name : "unknown",
      });

      logger.error("findPlace failed", {
        uid,
        type: input.type,
        error: err instanceof Error ? err.message : String(err),
      });

      if (err instanceof HttpsError) throw err;
      throw mapOpenAIError(err);
    }
  }
);
