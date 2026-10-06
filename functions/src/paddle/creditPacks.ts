/**
 * One-time AI credit packs. Price IDs must match
 * src/features/pricing/creditPacks.ts (sandbox + live).
 */

export type CreditPackId = "credits-600" | "credits-1000";

export const CREDIT_PACK_CREDITS: Record<CreditPackId, number> = {
  "credits-600": 600,
  "credits-1000": 1000,
};

/** Sandbox + live Paddle price IDs → pack. */
const PRICE_ID_TO_PACK: Record<string, CreditPackId> = {
  pri_01m487a286zsx0rm67vcz2g4bq: "credits-600",
  pri_01m48763r1ryggyz6cjnpp2hgx: "credits-600",
  pri_01m487af1fzymgn14v3bdjk91b: "credits-1000",
  pri_01m4874yeptgyk7c5aj324aa9k: "credits-1000",
};

export function resolveCreditPackFromPriceId(
  priceId?: string | null
): CreditPackId | null {
  const id = priceId?.trim();
  if (!id) return null;
  return PRICE_ID_TO_PACK[id] ?? null;
}

export function creditPackGrantAmount(priceId?: string | null): number {
  const pack = resolveCreditPackFromPriceId(priceId);
  if (!pack) return 0;
  return CREDIT_PACK_CREDITS[pack];
}
