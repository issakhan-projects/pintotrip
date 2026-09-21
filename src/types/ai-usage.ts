import type { Timestamp } from "firebase/firestore";

export type AIOperationUsage = {
  count: number;
  cost: number;
};

/**
 * Firestore document: aiUsage/{yyyy-MM}
 * Global monthly totals across all users (cost monitoring / optimization).
 * Written by Cloud Functions only; not readable by clients.
 */
export type AIUsageMonthly = {
  year: number;
  month: number;
  operations: Record<string, AIOperationUsage>;
  totalCount: number;
  totalCost: number;
  updatedAt: Timestamp;
};

/** Known AI callable operation keys. */
export type AIOperationName =
  | "findPlace"
  | "getCityIntelligence"
  | "planTrip"
  | "planTripAdvanced"
  | "planTripRegenerate"
  | "planTripRegenerateAdvanced"
  | "resolveCityAirports";
