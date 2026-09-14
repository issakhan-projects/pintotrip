/** Alphabet without ambiguous chars (no I, O, 0, 1). */
export const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REFERRAL_CODE_LENGTH = 8;
export const REFERRALS_COLLECTION = "referrals";
export const REFERRAL_REWARD_AI_CREDITS = 100;
export const CODE_UNIQUENESS_ATTEMPTS = 12;

export type ReferralStatus = "pending" | "completed";

export type ReferralDoc = {
  code: string;
  referrerId: string;
  referredUserId: string | null;
  referrerEmail: string;
  status: ReferralStatus;
  rewardCredits: number;
  createdAt: number;
  completedAt: number | null;
};

export type CompleteReferralOutcome =
  | "ok"
  | "alreadyCompleted"
  | "invalid_code"
  | "self_referral"
  | "not_pending"
  | "referrer_missing";

export function normalizeReferralCode(
  raw: unknown
): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (cleaned.length !== REFERRAL_CODE_LENGTH) return null;
  for (const ch of cleaned) {
    if (!REFERRAL_CODE_ALPHABET.includes(ch)) return null;
  }
  return cleaned;
}

export function generateReferralCode(): string {
  const alphabet = REFERRAL_CODE_ALPHABET;
  const length = REFERRAL_CODE_LENGTH;
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i]! % alphabet.length]!;
  }
  return out;
}

export function buildInvitePath(code: string, referralId: string): string {
  return `/invite/${encodeURIComponent(code)}?rid=${encodeURIComponent(referralId)}`;
}
