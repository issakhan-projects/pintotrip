/**
 * Central AI credit costs (units deducted from users/{uid}.aiCreditsBalance).
 */
export const AI_CREDIT_COSTS = {
  findPlace: 10,
  getCityIntelligence: 5,
  /** First AI itinerary fill for empty trip days. */
  planTrip: 20,
  /** Recreate AI itinerary preview (additional charge). */
  planTripRegenerate: 10,
  regenerate: 5,
} as const;

export type AICreditOperation = keyof typeof AI_CREDIT_COSTS;

export type InsufficientAICreditsError = {
  success: false;
  error: "INSUFFICIENT_AI_CREDITS";
  message: "Not enough AI credits";
  requiredCredits: number;
  availableCredits: number;
};

export function getRequiredCredits(operation: AICreditOperation): number {
  return AI_CREDIT_COSTS[operation];
}

export function isInsufficientAICreditsError(
  value: unknown
): value is InsufficientAICreditsError {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    (value as { success: unknown }).success === false &&
    "error" in value &&
    (value as { error: unknown }).error === "INSUFFICIENT_AI_CREDITS"
  );
}
