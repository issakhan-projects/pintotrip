/**
 * One-time AI credit packs (top-up when the monthly allowance runs out).
 * Keep sandbox + live price IDs; runtime picks by hostname (see getPaddlePublicEnv).
 */

import type { Environments } from "@paddle/paddle-js";
import { getPaddlePublicEnv } from "@/lib/paddle/env";

export type CreditPackId = "credits-600" | "credits-1000";

export interface CreditPack {
  id: CreditPackId;
  credits: number;
  /** Display fallback when PricePreview is unavailable (USD list price). */
  fallbackUsd: string;
  priceId: {
    sandbox: string;
    live: string;
  };
}

export const CREDIT_PACKS: CreditPack[] = [
  {
    id: "credits-600",
    credits: 600,
    fallbackUsd: "$9.99",
    priceId: {
      sandbox: "pri_01m487a286zsx0rm67vcz2g4bq",
      live: "pri_01m48763r1ryggyz6cjnpp2hgx",
    },
  },
  {
    id: "credits-1000",
    credits: 1000,
    fallbackUsd: "$14.99",
    priceId: {
      sandbox: "pri_01m487af1fzymgn14v3bdjk91b",
      live: "pri_01m4874yeptgyk7c5aj324aa9k",
    },
  },
];

function catalogKey(environment: Environments): "sandbox" | "live" {
  return environment === "production" ? "live" : "sandbox";
}

export function peekCreditPackPriceId(
  pack: CreditPack,
  environment?: Environments
): string | null {
  const env = environment ?? getPaddlePublicEnv().environment;
  const priceId = pack.priceId[catalogKey(env)]?.trim();
  if (!priceId || !priceId.startsWith("pri_")) return null;
  return priceId;
}

export function getCreditPackPriceId(
  pack: CreditPack,
  environment?: Environments
): string {
  const priceId = peekCreditPackPriceId(pack, environment);
  if (!priceId) {
    throw new Error(
      `Missing Paddle price ID for credit pack ${pack.id}. Edit src/features/pricing/creditPacks.ts.`
    );
  }
  return priceId;
}

export function listConfiguredCreditPackPriceIds(
  environment?: Environments
): string[] {
  const env = environment ?? getPaddlePublicEnv().environment;
  const ids: string[] = [];
  for (const pack of CREDIT_PACKS) {
    const id = peekCreditPackPriceId(pack, env);
    if (id) ids.push(id);
  }
  return ids;
}

export function getCreditPack(id: CreditPackId): CreditPack {
  const pack = CREDIT_PACKS.find((p) => p.id === id);
  if (!pack) {
    throw new Error(`Unknown credit pack: ${id}`);
  }
  return pack;
}

/** Credits for a catalog price ID (sandbox or live). */
export function creditPackAmountFromPriceId(
  priceId?: string | null
): number {
  const id = priceId?.trim();
  if (!id) return 0;
  for (const pack of CREDIT_PACKS) {
    if (pack.priceId.sandbox === id || pack.priceId.live === id) {
      return pack.credits;
    }
  }
  return 0;
}

export function creditPackAmountFromItems(
  items: Array<{ priceId?: string | null; quantity?: number | null }>
): number {
  let total = 0;
  for (const item of items) {
    const unit = creditPackAmountFromPriceId(item.priceId);
    if (unit <= 0) continue;
    const qty =
      typeof item.quantity === "number" && Number.isFinite(item.quantity)
        ? Math.max(1, Math.floor(item.quantity))
        : 1;
    total += unit * qty;
  }
  return total;
}
