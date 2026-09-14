/**
 * AI credit costs — mirrored from Cloud Functions for UI display only.
 * Enforcement happens only on the backend.
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

/** Starting balance written when a user profile is first created. */
export const SIGNUP_AI_CREDITS = 100;

/** One-time reward for submitting an in-app review (mirrors Cloud Functions). */
export const REVIEW_REWARD_AI_CREDITS = 100;

/** Credits awarded to the inviter when a referred friend finishes onboarding. */
export const REFERRAL_REWARD_AI_CREDITS = 100;

export type AICreditOperation = keyof typeof AI_CREDIT_COSTS;

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
