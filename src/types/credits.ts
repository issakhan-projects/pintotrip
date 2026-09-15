/**
 * AI credit costs — mirrored from Cloud Functions for UI display only.
 * Enforcement happens only on the backend.
 */
export const AI_CREDIT_COSTS = {
  findPlace: 10,
  getCityIntelligence: 5,
  /** First AI itinerary fill for empty trip days — included, no charge. */
  planTrip: 0,
  /** Recreate AI itinerary — Ordinary trip. */
  planTripRegenerate: 10,
  /** Recreate AI itinerary — Advanced trip. */
  planTripRegenerateAdvanced: 30,
  regenerate: 5,
  /** Create Trip — Ordinary tab. */
  createTripOrdinary: 20,
  /** Create Trip — Advanced tab. */
  createTripAdvanced: 75,
} as const;

/** Starting balance written when a user profile is first created. */
export const SIGNUP_AI_CREDITS = 100;

/** One-time reward for submitting an in-app review (mirrors Cloud Functions). */
export const REVIEW_REWARD_AI_CREDITS = 100;

/** Credits awarded to the inviter when a referred friend finishes onboarding. */
export const REFERRAL_REWARD_AI_CREDITS = 100;

export type AICreditOperation = keyof typeof AI_CREDIT_COSTS;

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

export type ChargeCreateTripRequest = {
  tripId: string;
  mode: "ordinary" | "advanced";
};

export type ChargeCreateTripResult = {
  success: true;
  creditsCharged: number;
  remainingCredits: number;
};

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
