/**
 * Google Places Text Search (name search) monthly allowances by plan.
 * Free is hard-off. Plus/Pro counts are set when product decides.
 * `null` = not configured yet (Pro may still unlock via AI credit packs).
 */

export type AppPlan = "free" | "plus" | "pro";

export const PLACE_SEARCH_MONTHLY_LIMITS: Record<AppPlan, number | null> = {
  free: 0,
  /** Set when product provides Plus monthly Places Text Search count. */
  plus: null,
  /** Set when product provides Pro monthly Places Text Search count. */
  pro: null,
};

export type SubscriptionLike = {
  plan?: AppPlan | null;
  status?: string | null;
} | null | undefined;

/** Paid access from mirrored Paddle state (active + past_due). */
export function isSubscriptionEntitled(subscription: SubscriptionLike): boolean {
  const plan = subscription?.plan ?? "free";
  if (plan === "free") return false;
  const status = (subscription?.status ?? "inactive").toLowerCase();
  return status === "active" || status === "past_due";
}

/**
 * Whether the user may unlock Google place name search (monthly quota or
 * temporary Pro credit packs while plus/pro limits are still null).
 */
export function canUsePlaceNameSearch(subscription: SubscriptionLike): boolean {
  if (!isSubscriptionEntitled(subscription)) return false;
  const plan = subscription?.plan;
  if (plan !== "plus" && plan !== "pro") return false;

  const limit = PLACE_SEARCH_MONTHLY_LIMITS[plan];
  // Quotas not configured yet: keep Pro credit-pack unlock; Plus stays off.
  if (limit === null) return plan === "pro";
  return limit > 0;
}

export function placeSearchMonthlyLimit(
  subscription: SubscriptionLike
): number {
  if (!isSubscriptionEntitled(subscription)) return 0;
  const plan = subscription?.plan ?? "free";
  const limit = PLACE_SEARCH_MONTHLY_LIMITS[plan];
  return typeof limit === "number" ? limit : 0;
}
