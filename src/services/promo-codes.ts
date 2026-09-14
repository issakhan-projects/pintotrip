import { doc, getDoc } from "firebase/firestore";
import { getFirestoreDb, FirestorePaths } from "@/lib/firebase/firestore";
import {
  normalizePromoCode,
  type AppliedPromo,
  type PromoCode,
  type PromoValidationResult,
} from "@/types/promo-code";

function parsePromoCodeDoc(
  id: string,
  data: Record<string, unknown>
): PromoCode | null {
  if (
    typeof data.promoCode !== "string" ||
    (data.status !== "active" &&
      data.status !== "inactive" &&
      data.status !== "expired") ||
    (data.discountType !== "percent" && data.discountType !== "fixed") ||
    typeof data.discountValue !== "number" ||
    typeof data.startDate !== "number" ||
    typeof data.endDate !== "number" ||
    typeof data.usageLimit !== "number" ||
    typeof data.usedCount !== "number"
  ) {
    return null;
  }

  return {
    id,
    promoCode: data.promoCode,
    status: data.status,
    discountType: data.discountType,
    discountValue: data.discountValue,
    startDate: data.startDate,
    endDate: data.endDate,
    usageLimit: data.usageLimit,
    usedCount: data.usedCount,
    maxUsesPerUser:
      typeof data.maxUsesPerUser === "number" ? data.maxUsesPerUser : 0,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt:
      typeof data.updatedAt === "number" ? data.updatedAt : undefined,
  };
}

/**
 * Validates a promo code against Firestore `promoCodes/{CODE}`.
 * Named for the intended server path; currently reads the collection directly
 * for checkout UI. Prefer a Cloud Function once payment is wired.
 */
export async function validatePromoCodeOnServer(
  rawCode: string
): Promise<PromoValidationResult> {
  const code = normalizePromoCode(rawCode);
  if (!code) {
    return { ok: false, error: "not_found" };
  }

  try {
    const snap = await getDoc(
      doc(getFirestoreDb(), FirestorePaths.promoCode(code))
    );

    if (!snap.exists()) {
      return { ok: false, error: "not_found" };
    }

    const promo = parsePromoCodeDoc(
      snap.id,
      snap.data() as Record<string, unknown>
    );
    if (!promo) {
      return { ok: false, error: "generic" };
    }

    const now = Date.now();

    if (promo.status === "inactive") {
      return { ok: false, error: "inactive" };
    }
    if (promo.status === "expired" || now > promo.endDate) {
      return { ok: false, error: "expired" };
    }
    if (now < promo.startDate) {
      return { ok: false, error: "not_started" };
    }
    if (promo.usageLimit > 0 && promo.usedCount >= promo.usageLimit) {
      return { ok: false, error: "usage_limit_reached" };
    }
    if (promo.status !== "active") {
      return { ok: false, error: "inactive" };
    }

    if (
      promo.discountType === "percent" &&
      (promo.discountValue < 1 || promo.discountValue > 100)
    ) {
      return { ok: false, error: "generic" };
    }
    if (promo.discountType === "fixed" && promo.discountValue <= 0) {
      return { ok: false, error: "generic" };
    }

    const applied: AppliedPromo = {
      code: normalizePromoCode(promo.promoCode || code),
      discountType: promo.discountType,
      discountValue: promo.discountValue,
    };

    return { ok: true, promo: applied };
  } catch {
    return { ok: false, error: "generic" };
  }
}
