import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { adminDb } from "./admin";
import { estimateTokenCost } from "./ai/aiCost";

export type AIOperationUsage = {
  count: number;
  cost: number;
};

export type AIUsageMonthly = {
  year: number;
  month: number;
  operations: Record<string, AIOperationUsage>;
  totalCount: number;
  totalCost: number;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

export type AIOperationName =
  | "findPlace"
  | "getCityIntelligence"
  | "planTrip"
  | "planTripRegenerate";

export interface AITokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Approximate gpt-4o-class cost — delegates to shared aiCost. */
export function estimateGpt4oCost(usage: AITokenUsage): number {
  return estimateTokenCost(usage);
}

export function usageFromCompletion(usage?: {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
} | null): AITokenUsage {
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const totalTokens =
    usage?.total_tokens ?? promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

function monthDocId(now = new Date()): {
  year: number;
  month: number;
  docId: string;
} {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const docId = `${year}-${String(month).padStart(2, "0")}`;
  return { year, month, docId };
}

/**
 * Increment global aiUsage/{yyyy-MM} for one successful AI operation.
 * Aggregates spend across all users for cost monitoring / optimization.
 * Admin SDK only — clients cannot read or write this collection.
 */
export async function recordAIUsage(params: {
  operation: AIOperationName | string;
  cost: number;
  count?: number;
  /** Optional, for logs only — not stored on the monthly aggregate. */
  userId?: string;
}): Promise<void> {
  const { operation, userId } = params;
  const count = params.count ?? 1;
  const cost = Number.isFinite(params.cost) ? Math.max(0, params.cost) : 0;
  const { year, month, docId } = monthDocId();
  const ref = adminDb().doc(`aiUsage/${docId}`);

  try {
    await ref.set(
      {
        year,
        month,
        [`operations.${operation}.count`]: FieldValue.increment(count),
        [`operations.${operation}.cost`]: FieldValue.increment(cost),
        totalCount: FieldValue.increment(count),
        totalCost: FieldValue.increment(cost),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    logger.error("recordAIUsage failed", {
      userId,
      operation,
      cost,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
