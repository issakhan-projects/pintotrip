/**
 * Central AI credit costs (units deducted from users/{uid}.aiCreditsBalance).
 */
export const AI_CREDIT_COSTS = {
  findPlace: 10,
  getCityIntelligence: 5,
  /** First AI itinerary fill — Ordinary trip. */
  planTrip: 50,
  /** First AI itinerary fill — Advanced trip. */
  planTripAdvanced: 100,
  /** Recreate AI itinerary — Ordinary trip. */
  planTripRegenerate: 25,
  /** Recreate AI itinerary — Advanced trip. */
  planTripRegenerateAdvanced: 50,
  regenerate: 5,
  /** Resolve primary airports for trip cities (cached heavily). */
  resolveCityAirports: 1,
} as const;

export type AICreditOperation = keyof typeof AI_CREDIT_COSTS;

export function planTripOperation(
  createMode?: string | null
): Extract<AICreditOperation, "planTrip" | "planTripAdvanced"> {
  return createMode === "advanced" ? "planTripAdvanced" : "planTrip";
}

export function planTripRegenerateOperation(
  createMode?: string | null
): Extract<
  AICreditOperation,
  "planTripRegenerate" | "planTripRegenerateAdvanced"
> {
  return createMode === "advanced"
    ? "planTripRegenerateAdvanced"
    : "planTripRegenerate";
}

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
