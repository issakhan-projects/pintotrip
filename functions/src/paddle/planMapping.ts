import {
  paddlePricePlusMonthLive,
  paddlePricePlusMonthSandbox,
  paddlePricePlusYearLive,
  paddlePricePlusYearSandbox,
  paddlePriceProMonthLive,
  paddlePriceProMonthSandbox,
  paddlePriceProYearLive,
  paddlePriceProYearSandbox,
  paddleProductPlus,
  paddleProductPro,
} from "../shared/config";

export type AppPlan = "free" | "plus" | "pro";

/**
 * Hardcoded catalog fallbacks (must match src/features/pricing/tiers.ts).
 * Ensures transaction.completed can unlock Plus/Pro even if Cloud Functions
 * params were not set at deploy time.
 */
const CATALOG_FALLBACK = {
  plusMonthSandbox: "pri_01m2gdwzw7dtbr5eeqt66ra9eq",
  plusYearSandbox: "pri_01m2gdydnzqpj26ma4k90xm80y",
  proMonthSandbox: "pri_01m2gdwjrrdfxqgdy9awh406cb",
  proYearSandbox: "pri_01m2gdy1a8ktkr2gr0j2hcszdy",
  plusMonthLive: "pri_01m28pq2s9q9b0zn0w2zm20jw1",
  plusYearLive: "pri_01m2gccyge9q7f76pbn539tcms",
  /** Catalog live Pro (functions/.env + tiers.ts) */
  proMonthLive: "pri_01m28pr9bsse4r3grg6yhmznbf",
  proYearLive: "pri_01m2gcbw6qv4gpj681nmbhmshz",
  /** Legacy TEMP test prices — keep for webhook mapping of past checkouts */
  tempProMonthLive: "pri_01m486p0pbh5w5b2w5km6rjbfh",
  tempProYearLive: "pri_01m486pp12hcpfk3h54pyekmrx",
} as const;

/**
 * Monthly AI credits granted on paid purchase / billing period (must match
 * src/features/profile/plans.ts). Free is 0 here so leftover signup credits
 * are not subtracted on upgrade.
 */
export const PLAN_AI_CREDITS_MONTHLY: Record<AppPlan, number> = {
  free: 0,
  plus: 200,
  pro: 500,
};

/** App subscription statuses stored on users/{uid}.subscription.status */
export type AppSubscriptionStatus =
  | "active"
  | "canceled"
  | "past_due"
  | "paused";

function collectIds(...values: Array<string | undefined>): Set<string> {
  const set = new Set<string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) set.add(trimmed);
  }
  return set;
}

/** Union of sandbox + live catalog IDs → Plus / Pro. */
export function buildPriceIdPlanMap(): Map<string, "plus" | "pro"> {
  const map = new Map<string, "plus" | "pro">();
  for (const id of collectIds(
    paddlePricePlusMonthSandbox.value(),
    paddlePricePlusYearSandbox.value(),
    paddlePricePlusMonthLive.value(),
    paddlePricePlusYearLive.value(),
    CATALOG_FALLBACK.plusMonthSandbox,
    CATALOG_FALLBACK.plusYearSandbox,
    CATALOG_FALLBACK.plusMonthLive,
    CATALOG_FALLBACK.plusYearLive
  )) {
    map.set(id, "plus");
  }
  for (const id of collectIds(
    paddlePriceProMonthSandbox.value(),
    paddlePriceProYearSandbox.value(),
    paddlePriceProMonthLive.value(),
    paddlePriceProYearLive.value(),
    CATALOG_FALLBACK.proMonthSandbox,
    CATALOG_FALLBACK.proYearSandbox,
    CATALOG_FALLBACK.proMonthLive,
    CATALOG_FALLBACK.proYearLive,
    CATALOG_FALLBACK.tempProMonthLive,
    CATALOG_FALLBACK.tempProYearLive
  )) {
    map.set(id, "pro");
  }
  return map;
}

export function buildProductIdPlanMap(): Map<string, "plus" | "pro"> {
  const map = new Map<string, "plus" | "pro">();
  const plus = paddleProductPlus.value().trim();
  const pro = paddleProductPro.value().trim();
  if (plus) map.set(plus, "plus");
  if (pro) map.set(pro, "pro");
  return map;
}

export type AppBillingPeriod = "month" | "year";

/** Catalog price ID → billing period (sandbox + live). */
export function buildPriceIdBillingPeriodMap(): Map<string, AppBillingPeriod> {
  const map = new Map<string, AppBillingPeriod>();
  for (const id of collectIds(
    paddlePricePlusMonthSandbox.value(),
    paddlePriceProMonthSandbox.value(),
    paddlePricePlusMonthLive.value(),
    paddlePriceProMonthLive.value(),
    CATALOG_FALLBACK.plusMonthSandbox,
    CATALOG_FALLBACK.proMonthSandbox,
    CATALOG_FALLBACK.plusMonthLive,
    CATALOG_FALLBACK.proMonthLive,
    CATALOG_FALLBACK.tempProMonthLive
  )) {
    map.set(id, "month");
  }
  for (const id of collectIds(
    paddlePricePlusYearSandbox.value(),
    paddlePriceProYearSandbox.value(),
    paddlePricePlusYearLive.value(),
    paddlePriceProYearLive.value(),
    CATALOG_FALLBACK.plusYearSandbox,
    CATALOG_FALLBACK.proYearSandbox,
    CATALOG_FALLBACK.plusYearLive,
    CATALOG_FALLBACK.proYearLive,
    CATALOG_FALLBACK.tempProYearLive
  )) {
    map.set(id, "year");
  }
  return map;
}

/**
 * Resolve Plus/Pro from the current subscription line item.
 * Prefer price ID; fall back to product ID.
 */
export function resolvePlanFromCatalogIds(input: {
  priceId?: string | null;
  productId?: string | null;
}): "plus" | "pro" | null {
  const priceId = input.priceId?.trim();
  if (priceId) {
    const fromPrice = buildPriceIdPlanMap().get(priceId);
    if (fromPrice) return fromPrice;
  }
  const productId = input.productId?.trim();
  if (productId) {
    const fromProduct = buildProductIdPlanMap().get(productId);
    if (fromProduct) return fromProduct;
  }
  return null;
}

/** Resolve month/year from catalog price ID when known. */
export function resolveBillingPeriodFromPriceId(
  priceId?: string | null
): AppBillingPeriod | null {
  const id = priceId?.trim();
  if (!id) return null;
  return buildPriceIdBillingPeriodMap().get(id) ?? null;
}

/** Map Paddle subscription.status → app status. */
export function mapPaddleStatusToApp(
  paddleStatus: string | null | undefined
): AppSubscriptionStatus {
  switch ((paddleStatus ?? "").toLowerCase()) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "paused":
      return "paused";
    case "canceled":
    case "cancelled":
      return "canceled";
    default:
      return "canceled";
  }
}

/**
 * Entitled paid plan for access gating.
 * canceled / paused → free. active / past_due keep Plus/Pro.
 */
export function resolveEntitledPlan(input: {
  paddleStatus: string | null | undefined;
  priceId?: string | null;
  productId?: string | null;
}): { plan: AppPlan; status: AppSubscriptionStatus } {
  const status = mapPaddleStatusToApp(input.paddleStatus);
  if (status === "canceled" || status === "paused") {
    return { plan: "free", status };
  }
  const paid = resolvePlanFromCatalogIds({
    priceId: input.priceId,
    productId: input.productId,
  });
  return { plan: paid ?? "free", status };
}
