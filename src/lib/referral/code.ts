import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
} from "@/types/referral";

/**
 * Normalize a referral code: trim, uppercase, strip non-alphabet chars.
 * Returns null if the result is not a valid length code.
 */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
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

/** Generate a random referral code (caller must check uniqueness). */
export function generateReferralCode(
  length: number = REFERRAL_CODE_LENGTH
): string {
  const alphabet = REFERRAL_CODE_ALPHABET;
  let out = "";
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i]! % alphabet.length]!;
  }
  return out;
}
