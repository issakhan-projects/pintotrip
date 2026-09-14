import { createHash } from "crypto";
import { logger } from "firebase-functions";
import { dedupeAsync } from "./aiDeduplication";
import { getAICache, setAICache, type AICacheScope } from "./aiCache";
import { logAICallMetrics, type AICallOutcome } from "./aiMetrics";
import type { AITokenUsage } from "../aiUsage";

export interface ExecuteAIParams<T> {
  functionName: string;
  fingerprint: string;
  operation: AICacheScope;
  ttlMs: number;
  /** When true, skip durable cache read/write (still dedupes in-flight). */
  skipCache?: boolean;
  execute: () => Promise<{
    result: T;
    model: string;
    usage: AITokenUsage;
    cost: number;
  }>;
}

export interface ExecuteAIResult<T> {
  result: T;
  /** True when OpenAI was not called for this waiter (cache or dedupe). */
  fromCache: boolean;
  /** True when this request joined an in-flight promise. */
  deduplicated: boolean;
  /** True when this instance performed the OpenAI call. */
  billable: boolean;
  model?: string;
  usage?: AITokenUsage;
  cost: number;
  durationMs: number;
  outcome: AICallOutcome;
}

type Produced<T> = {
  result: T;
  fromCache: boolean;
  didExecute: boolean;
  model?: string;
  usage?: AITokenUsage;
  cost: number;
};

/**
 * Cache → in-flight dedupe → execute → cache.
 * Callers must only deduct credits when `billable` is true.
 */
export async function executeCachedAI<T>(
  params: ExecuteAIParams<T>
): Promise<ExecuteAIResult<T>> {
  const started = Date.now();
  const { fingerprint, functionName } = params;

  if (!params.skipCache) {
    const cached = await getAICache<T>(fingerprint);
    if (cached) {
      const durationMs = Date.now() - started;
      logAICallMetrics({
        functionName,
        model: cached.model,
        outcome: "cache_hit",
        fingerprint,
        cacheHit: true,
        deduplicated: false,
        inputTokens: cached.promptTokens ?? 0,
        outputTokens: cached.completionTokens ?? 0,
        estimatedCost: 0,
        durationMs,
      });
      return {
        result: cached.result,
        fromCache: true,
        deduplicated: false,
        billable: false,
        model: cached.model,
        usage:
          typeof cached.promptTokens === "number"
            ? {
                promptTokens: cached.promptTokens,
                completionTokens: cached.completionTokens ?? 0,
                totalTokens:
                  (cached.promptTokens ?? 0) +
                  (cached.completionTokens ?? 0),
              }
            : undefined,
        cost: 0,
        durationMs,
        outcome: "cache_hit",
      };
    }
  }

  const { value: produced, isLeader } = await dedupeAsync(
    fingerprint,
    async (): Promise<Produced<T>> => {
      if (!params.skipCache) {
        const again = await getAICache<T>(fingerprint);
        if (again) {
          return {
            result: again.result,
            fromCache: true,
            didExecute: false,
            model: again.model,
            usage: undefined,
            cost: 0,
          };
        }
      }

      const executed = await params.execute();

      if (!params.skipCache) {
        await setAICache({
          fingerprint,
          operation: params.operation,
          result: executed.result,
          ttlMs: params.ttlMs,
          model: executed.model,
          promptTokens: executed.usage.promptTokens,
          completionTokens: executed.usage.completionTokens,
          cost: executed.cost,
        });
      }

      return {
        result: executed.result,
        fromCache: false,
        didExecute: true,
        model: executed.model,
        usage: executed.usage,
        cost: executed.cost,
      };
    }
  );

  const durationMs = Date.now() - started;
  const deduplicated = !isLeader;
  const billable = Boolean(isLeader && produced.didExecute);
  const outcome: AICallOutcome = produced.fromCache
    ? "cache_hit"
    : deduplicated
      ? "deduped"
      : "miss";

  logAICallMetrics({
    functionName,
    model: produced.model,
    outcome,
    fingerprint,
    cacheHit: produced.fromCache,
    deduplicated,
    inputTokens: billable ? produced.usage?.promptTokens ?? 0 : 0,
    outputTokens: billable ? produced.usage?.completionTokens ?? 0 : 0,
    estimatedCost: billable ? produced.cost : 0,
    durationMs,
  });

  return {
    result: produced.result,
    fromCache: produced.fromCache || deduplicated,
    deduplicated,
    billable,
    model: produced.model,
    usage: produced.usage,
    cost: billable ? produced.cost : 0,
    durationMs,
    outcome,
  };
}

/**
 * Hash remote image bytes for stable findPlace fingerprints.
 * Falls back to hashing the URL if the body cannot be fetched.
 */
export async function hashImageInput(imageUrl: string): Promise<string> {
  try {
    const response = await fetch(imageUrl, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`image fetch ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const slice =
      buffer.byteLength > 2_000_000 ? buffer.subarray(0, 2_000_000) : buffer;
    return createHash("sha256").update(slice).digest("hex");
  } catch (err) {
    logger.warn("hashImageInput fallback to URL hash", {
      error: err instanceof Error ? err.message : String(err),
    });
    return createHash("sha256").update(imageUrl.trim()).digest("hex");
  }
}
