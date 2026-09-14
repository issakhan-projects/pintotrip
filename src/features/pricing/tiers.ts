/**
 * Editable Paddle subscription tiers (Free / Plus / Pro).
 * Keep sandbox + live price IDs; runtime picks by hostname (see getPaddlePublicEnv).
 */

import type { Environments } from "@paddle/paddle-js";
import { getPaddlePublicEnv } from "@/lib/paddle/env";

export type TierName = "free" | "plus" | "pro";

export type BillingInterval = "month" | "year";

export type TierPriceIds = { month: string; year: string };

export interface Tier {
  name: TierName;
  /** Display title on the pricing card. */
  label: string;
  description: string;
  features: string[];
  /** Omit for Free — paid tiers only. */
  priceId?: {
    sandbox: TierPriceIds;
    live: TierPriceIds;
  };
  recommended?: boolean;
  ctaLabel?: string;
}

export const TIERS: Tier[] = [
  {
    name: "free",
    label: "Free",
    description: "Start discovering places with a light AI allowance.",
    features: [
      "30 AI credits / month",
      "Save places to personal map",
      "View saved places",
      "Map and list views",
      "Basic travel information",
    ],
    ctaLabel: "Get Started",
  },
  {
    name: "plus",
    label: "Plus",
    description: "More AI credits for frequent travelers.",
    features: [
      "200 AI credits / month",
      "Save places to personal map",
      "AI-powered place identification",
      "City intelligence",
      "Map and list views",
      "Travel statistics",
    ],
    priceId: {
      sandbox: {
        month: "pri_01m2gdwzw7dtbr5eeqt66ra9eq",
        year: "pri_01m2gdydnzqpj26ma4k90xm80y",
      },
      live: {
        month: "pri_01m28pq2s9q9b0zn0w2zm20jw1",
        year: "pri_01m2gccyge9q7f76pbn539tcms",
      },
    },
    recommended: true,
    ctaLabel: "Subscribe",
  },
  {
    name: "pro",
    label: "Pro",
    description: "Highest AI allowance for heavy trip planning.",
    features: [
      "500 AI credits / month",
      "AI-powered place identification",
      "City intelligence",
      "Highlighted maps",
      "Trip planner",
      "Search places by name",
      "More AI usage",
      "Save unlimited places",
      "Travel statistics",
      "Priority access to new AI features",
    ],
    priceId: {
      sandbox: {
        month: "pri_01m2gdwjrrdfxqgdy9awh406cb",
        year: "pri_01m2gdy1a8ktkr2gr0j2hcszdy",
      },
      live: {
        month: "pri_01m28pr9bsse4r3grg6yhmznbf",
        year: "pri_01m2gcbw6qv4gpj681nmbhmshz",
      },
    },
    ctaLabel: "Subscribe",
  },
];

function catalogKey(environment: Environments): "sandbox" | "live" {
  return environment === "production" ? "live" : "sandbox";
}

export function resolveTierPriceIds(
  tier: Tier,
  environment?: Environments
): TierPriceIds | null {
  if (!tier.priceId) return null;
  const env = environment ?? getPaddlePublicEnv().environment;
  return tier.priceId[catalogKey(env)] ?? null;
}

export function isPaidTier(tier: Tier): boolean {
  return tier.name !== "free";
}

export function getPaidTiers(): Tier[] {
  return TIERS.filter(isPaidTier);
}

export function getTier(name: TierName): Tier {
  const tier = TIERS.find((t) => t.name === name);
  if (!tier) {
    throw new Error(`Unknown pricing tier: ${name}`);
  }
  return tier;
}

export function peekTierPriceId(
  tier: Tier,
  interval: BillingInterval,
  environment?: Environments
): string | null {
  const ids = resolveTierPriceIds(tier, environment);
  const priceId = ids?.[interval]?.trim();
  if (!priceId || !priceId.startsWith("pri_")) return null;
  return priceId;
}

export function getTierPriceId(
  tier: Tier,
  interval: BillingInterval,
  environment?: Environments
): string {
  const priceId = peekTierPriceId(tier, interval, environment);
  if (!priceId) {
    throw new Error(
      `Missing Paddle price ID for ${tier.name}/${interval}. Edit src/features/pricing/tiers.ts.`
    );
  }
  return priceId;
}

/** Configured price IDs for the active (or given) Paddle environment. */
export function listConfiguredPriceIds(environment?: Environments): string[] {
  const env = environment ?? getPaddlePublicEnv().environment;
  const ids: string[] = [];
  for (const tier of getPaidTiers()) {
    for (const interval of ["month", "year"] as const) {
      const id = peekTierPriceId(tier, interval, env);
      if (id) ids.push(id);
    }
  }
  return ids;
}

/** True when every paid tier has month + year IDs for the active environment. */
export function tiersHavePriceIds(environment?: Environments): boolean {
  const env = environment ?? getPaddlePublicEnv().environment;
  return getPaidTiers().every((tier) => {
    const ids = resolveTierPriceIds(tier, env);
    return Boolean(
      ids?.month.trim().startsWith("pri_") &&
        ids?.year.trim().startsWith("pri_")
    );
  });
}
