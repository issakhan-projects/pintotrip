import { REFERRAL_REWARD_AI_CREDITS } from "./credits";

export { REFERRAL_REWARD_AI_CREDITS };

export const REFERRALS_COLLECTION = "referrals";

/** Alphabet without ambiguous chars (no I, O, 0, 1). */
export const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REFERRAL_CODE_LENGTH = 8;

export type ReferralStatus = "pending" | "completed";

/**
 * Firestore document: referrals/{referralId}
 * Written only by Cloud Functions (Admin SDK).
 */
export interface Referral {
  code: string;
  referrerId: string;
  referredUserId: string | null;
  referrerEmail: string;
  status: ReferralStatus;
  rewardCredits: number;
  createdAt: number;
  completedAt: number | null;
}

export type CreateReferralResult = {
  code: string;
  referralId: string;
  /** Path only — client builds absolute URL with current origin. */
  path: string;
  rewardCredits: number;
};

export type CompleteReferralRequest = {
  code: string;
  referralId?: string;
};

export type CompleteReferralOutcome =
  | "ok"
  | "alreadyCompleted"
  | "invalid_code"
  | "self_referral"
  | "not_pending"
  | "referrer_missing";

export type CompleteReferralResult = {
  outcome: CompleteReferralOutcome;
  creditsAwarded?: number;
  referrerBalance?: number;
};
