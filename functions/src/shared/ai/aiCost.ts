import type { AITokenUsage } from "../aiUsage";

/** Approximate gpt-4o-class list prices (USD per 1M tokens). */
const INPUT_PER_MILLION = 2.5;
const OUTPUT_PER_MILLION = 10;

/**
 * High-detail vision tile estimate (OpenAI vision pricing heuristic).
 * Used for observability only — not billed to users.
 */
const HIGH_DETAIL_IMAGE_INPUT_TOKENS_EST = 765;

export function estimateTokenCost(usage: AITokenUsage): number {
  const input = (usage.promptTokens / 1_000_000) * INPUT_PER_MILLION;
  const output = (usage.completionTokens / 1_000_000) * OUTPUT_PER_MILLION;
  return Math.round((input + output) * 1_000_000) / 1_000_000;
}

export function estimateVisionImageCost(imageCount: number): number {
  const tokens = Math.max(0, imageCount) * HIGH_DETAIL_IMAGE_INPUT_TOKENS_EST;
  return Math.round((tokens / 1_000_000) * INPUT_PER_MILLION * 1_000_000) / 1_000_000;
}

export { INPUT_PER_MILLION, OUTPUT_PER_MILLION, HIGH_DETAIL_IMAGE_INPUT_TOKENS_EST };
