import type { SubscriptionPlan } from "@/types/user";

export type BillingInterval = "month" | "year";

export interface PlanDefinition {
  id: SubscriptionPlan;
  name: string;
  priceMonthly: number;
  /** Annual prepaid price (typically ~2 months free vs monthly). */
  priceYearly: number;
  aiCreditsMonthly: number;
  description: string;
  features: string[];
  ctaLabel: string;
  recommended?: boolean;
}

export const PLAN_DEFINITIONS: Record<SubscriptionPlan, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    priceMonthly: 0,
    priceYearly: 0,
    aiCreditsMonthly: 30,
    description: "Start discovering places with a light AI allowance.",
    features: [
      "30 AI credits / month",
      "Save up to 10 places",
      "View saved places",
      "Map and list views",
      "Basic travel information",
    ],
    ctaLabel: "Get Started",
  },
  plus: {
    id: "plus",
    name: "Plus",
    priceMonthly: 9.99,
    priceYearly: 99.9,
    aiCreditsMonthly: 200,
    description: "More AI credits for frequent travelers.",
    features: [
      "200 AI credits / month",
      "Save up to 100 places",
      "AI-powered place identification",
      "City intelligence",
      "Map and list views",
      "Travel statistics",
    ],
    ctaLabel: "Upgrade to Plus",
    recommended: true,
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMonthly: 14.99,
    priceYearly: 149.9,
    aiCreditsMonthly: 500,
    description: "Highest AI allowance for heavy trip planning.",
    features: [
      "500 AI credits / month",
      "AI-powered place identification",
      "City intelligence",
      "Highlighted maps",
      "Trip planner",
      "Search places by name",
      "More AI usage",
      "Save up to 300 places",
      "Travel statistics",
      "Priority access to new AI features",
    ],
    ctaLabel: "Upgrade to Pro",
  },
};

export const PLAN_ORDER: SubscriptionPlan[] = ["free", "plus", "pro"];

/** Active saved locations allowed on users/{uid}/locations. */
export const LOCATION_LIMITS: Record<SubscriptionPlan, number> = {
  free: 10,
  plus: 100,
  pro: 300,
};

/**
 * Included Google Places Text Search (name search) requests per month.
 * `0` = feature off. `null` = not configured yet (awaiting product counts).
 * While plus/pro are null, Pro may still unlock packs via AI credits;
 * Free is always off; Plus stays off until a positive limit is set.
 */
export const PLACE_SEARCH_MONTHLY_LIMITS: Record<
  SubscriptionPlan,
  number | null
> = {
  free: 0,
  plus: null,
  pro: null,
};

/**
 * Location cap for the subscription that actually grants access.
 * Canceled, paused, or inactive paid plans fall back to the free cap.
 */
export function locationLimitForSubscription(
  subscription:
    | { plan?: SubscriptionPlan | null; status?: string | null }
    | null
    | undefined
): { plan: SubscriptionPlan; limit: number } {
  const plan = subscription?.plan;
  if (
    isSubscriptionEntitled(subscription) &&
    (plan === "plus" || plan === "pro")
  ) {
    return { plan, limit: LOCATION_LIMITS[plan] };
  }
  return { plan: "free", limit: LOCATION_LIMITS.free };
}

export type ComparisonValue = boolean | number | string;

export interface PlanComparisonRow {
  feature: string;
  free: ComparisonValue;
  plus: ComparisonValue;
  pro: ComparisonValue;
}

export const PLAN_COMPARISON_ROWS: PlanComparisonRow[] = [
  {
    feature: "AI Credits / month",
    free: 30,
    plus: 200,
    pro: 500,
  },
  {
    feature: "Saved places",
    free: 10,
    plus: 100,
    pro: 300,
  },
  {
    feature: "Personal Map",
    free: true,
    plus: true,
    pro: true,
  },
  {
    feature: "AI Place Identification",
    free: false,
    plus: true,
    pro: true,
  },
  {
    feature: "City Intelligence",
    free: false,
    plus: true,
    pro: true,
  },
  {
    feature: "Travel Statistics",
    free: true,
    plus: true,
    pro: true,
  },
  {
    feature: "Highlighted Maps",
    free: false,
    plus: false,
    pro: true,
  },
  {
    feature: "Trip Planner",
    free: false,
    plus: false,
    pro: true,
  },
  {
    feature: "Search Places by Name",
    free: false,
    plus: false,
    pro: true,
  },
  {
    feature: "Priority AI Features",
    free: false,
    plus: false,
    pro: true,
  },
];

export function getPlanDefinition(
  plan: SubscriptionPlan | undefined | null
): PlanDefinition {
  return PLAN_DEFINITIONS[plan ?? "free"] ?? PLAN_DEFINITIONS.free;
}

/** Trip planner, map highlights, and Google name search are Pro-only. */
export function isProPlan(
  plan: SubscriptionPlan | undefined | null
): boolean {
  return plan === "pro";
}

/** Monthly Places Text Search allowance for an entitled subscription (0 if none). */
export function placeSearchMonthlyLimit(
  subscription:
    | { plan?: SubscriptionPlan | null; status?: string | null }
    | null
    | undefined
): number {
  if (!isSubscriptionEntitled(subscription)) return 0;
  const plan = subscription?.plan ?? "free";
  const limit = PLACE_SEARCH_MONTHLY_LIMITS[plan];
  return typeof limit === "number" ? limit : 0;
}

/**
 * Google place name search (Places Text Search).
 * Free is always off. Plus/Pro follow PLACE_SEARCH_MONTHLY_LIMITS;
 * while those are null, Pro keeps temporary AI-credit pack unlock.
 */
export function canUsePlaceNameSearch(
  subscription:
    | { plan?: SubscriptionPlan | null; status?: string | null }
    | null
    | undefined
): boolean {
  if (!isSubscriptionEntitled(subscription)) return false;
  const plan = subscription?.plan;
  if (plan !== "plus" && plan !== "pro") return false;

  const limit = PLACE_SEARCH_MONTHLY_LIMITS[plan];
  if (limit === null) return plan === "pro";
  return limit > 0;
}

/**
 * Paid access from mirrored Paddle state (webhook source of truth).
 * Grants during active + past_due; denies canceled / paused / inactive / free.
 */
export function isSubscriptionEntitled(
  subscription:
    | { plan?: SubscriptionPlan | null; status?: string | null }
    | null
    | undefined
): boolean {
  const plan = subscription?.plan ?? "free";
  if (plan === "free") return false;
  const status = (subscription?.status ?? "inactive").toLowerCase();
  return status === "active" || status === "past_due";
}

/** Pro features require entitled Pro subscription (not checkout alone). */
export function isProEntitled(
  subscription:
    | { plan?: SubscriptionPlan | null; status?: string | null }
    | null
    | undefined
): boolean {
  return (
    isSubscriptionEntitled(subscription) && subscription?.plan === "pro"
  );
}

export function getPlanPrice(
  plan: PlanDefinition,
  interval: BillingInterval
): number {
  return interval === "year" ? plan.priceYearly : plan.priceMonthly;
}

/** Full-year list price at the monthly rate (compare-at when yearly is selected). */
export function getYearlyListPrice(plan: PlanDefinition): number {
  return plan.priceMonthly * 12;
}

/** Effective monthly rate when billed yearly (for display). */
export function getEffectiveMonthlyPrice(plan: PlanDefinition): number {
  if (plan.priceYearly <= 0) return 0;
  return plan.priceYearly / 12;
}

export function formatPlanPrice(
  plan: PlanDefinition,
  interval: BillingInterval = "month",
  formatAmount: (usd: number) => string = (usd) =>
    usd === 0 ? "$0" : `$${usd.toFixed(2)}`
): string {
  const price = getPlanPrice(plan, interval);
  const period = interval === "year" ? "/ year" : "/ month";
  return `${formatAmount(price)} ${period}`;
}

/** Approx. savings vs paying monthly for a full year. */
export function getYearlySavingsPercent(plan: PlanDefinition): number {
  if (plan.priceMonthly <= 0) return 0;
  const fullYear = plan.priceMonthly * 12;
  if (fullYear <= 0) return 0;
  return Math.round((1 - plan.priceYearly / fullYear) * 100);
}
