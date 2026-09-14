/**
 * Firestore document: promoCodes/{id}
 * Doc id is often the uppercase code (e.g. WELCOME50).
 */
export interface PromoCode {
  id: string;
  /** Normalized UPPERCASE code string. */
  promoCode: string;
  status: "active" | "inactive" | "expired";
  discountType: "percent" | "fixed";
  /** percent: 1–100; fixed: USD amount > 0 */
  discountValue: number;
  /** ms epoch */
  startDate: number;
  /** ms epoch */
  endDate: number;
  /** 0 = unlimited global uses */
  usageLimit: number;
  usedCount: number;
  /** 0 = no per-user cap in validation UI path */
  maxUsesPerUser: number;
  createdAt: number;
  updatedAt?: number;
}

/** Client-validated success payload shown in checkout UI. */
export interface AppliedPromo {
  code: string;
  discountType: "percent" | "fixed";
  discountValue: number;
}

export type PromoValidationErrorCode =
  | "not_found"
  | "inactive"
  | "not_started"
  | "expired"
  | "usage_limit_reached"
  | "generic";

export type PromoValidationResult =
  | { ok: true; promo: AppliedPromo }
  | { ok: false; error: PromoValidationErrorCode };

export const PROMO_ERROR_MESSAGES: Record<PromoValidationErrorCode, string> = {
  not_found: "Promo code not found.",
  inactive: "This promo code is not active.",
  not_started: "This promo code is not valid yet.",
  expired: "This promo code has expired.",
  usage_limit_reached: "This promo code has reached its usage limit.",
  generic: "Could not validate the promo code. Try again.",
};

/** Normalize user input: trim + uppercase. */
export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase();
}
