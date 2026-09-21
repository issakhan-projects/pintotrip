/**
 * AI credit costs — mirrored from Cloud Functions for UI display only.
 * Enforcement happens only on the backend.
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

/** Starting balance written when a user profile is first created. */
export const SIGNUP_AI_CREDITS = 100;

/** One-time reward for submitting an in-app review (mirrors Cloud Functions). */
export const REVIEW_REWARD_AI_CREDITS = 100;

/** Credits awarded to the inviter when a referred friend finishes onboarding. */
export const REFERRAL_REWARD_AI_CREDITS = 100;

export type AICreditOperation = keyof typeof AI_CREDIT_COSTS;

export function planTripOperation(
  createMode?: string | null
): Extract<AICreditOperation, "planTrip" | "planTripAdvanced"> {
  return createMode === "advanced" ? "planTripAdvanced" : "planTrip";
}

export function planTripCost(createMode?: string | null): number {
  return AI_CREDIT_COSTS[planTripOperation(createMode)];
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

export function planTripRegenerateCost(createMode?: string | null): number {
  return AI_CREDIT_COSTS[planTripRegenerateOperation(createMode)];
}

export type InsufficientAICreditsError = {
  success: false;
  error: "INSUFFICIENT_AI_CREDITS";
  message: "Not enough AI credits";
  requiredCredits: number;
  availableCredits: number;
};

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

export function formatInsufficientCreditsMessage(
  err: InsufficientAICreditsError
): string {
  return `${err.message}. Need ${err.requiredCredits}, you have ${err.availableCredits}.`;
}
