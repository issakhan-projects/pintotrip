import { logger } from "firebase-functions";
import type { AITokenUsage } from "../aiUsage";

export type AICallOutcome =
  | "cache_hit"
  | "deduped"
  | "miss"
  | "partial_cache"
  | "error";

export interface AICallMetricLog {
  functionName: string;
  model?: string;
  outcome: AICallOutcome;
  fingerprint?: string;
  cacheHit?: boolean;
  deduplicated?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
  durationMs: number;
  errorType?: string;
  extra?: Record<string, string | number | boolean | undefined>;
}

/**
 * Lightweight cost/performance log. Never log prompts, images, or PII.
 */
export function logAICallMetrics(metrics: AICallMetricLog): void {
  const {
    functionName,
    model,
    outcome,
    fingerprint,
    cacheHit,
    deduplicated,
    inputTokens,
    outputTokens,
    estimatedCost,
    durationMs,
    errorType,
    extra,
  } = metrics;

  logger.info("ai_call_metrics", {
    functionName,
    model: model ?? null,
    outcome,
    fingerprintPrefix: fingerprint ? fingerprint.slice(0, 12) : null,
    cacheHit: Boolean(cacheHit),
    deduplicated: Boolean(deduplicated),
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    estimatedCost: estimatedCost ?? 0,
    durationMs,
    errorType: errorType ?? null,
    ...extra,
  });
}

export function usageFields(usage?: AITokenUsage): {
  inputTokens: number;
  outputTokens: number;
} {
  return {
    inputTokens: usage?.promptTokens ?? 0,
    outputTokens: usage?.completionTokens ?? 0,
  };
}
