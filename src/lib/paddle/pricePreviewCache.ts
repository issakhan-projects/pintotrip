/**
 * Session cache for Paddle PricePreview results — skip the CDN+API wait
 * on repeat visits to /pricing in the same tab.
 */

import type { Environments } from "@paddle/paddle-js";

export type CachedPriceEntry = {
  formatted: string;
  total: string;
  currencyCode: string;
};

export type PricePreviewCachePayload = {
  currencyCode: string;
  byId: Record<string, CachedPriceEntry>;
  cachedAt: number;
  environment: Environments;
  countryCode: string;
  priceIdsKey: string;
};

const STORAGE_PREFIX = "pintotrip.paddle.pricePreview.v1:";
/** Keep localized totals for half an hour within the tab. */
export const PRICE_PREVIEW_CACHE_TTL_MS = 30 * 60 * 1000;

export function priceIdsCacheKey(priceIds: string[]): string {
  return [...priceIds].sort().join(",");
}

export function pricePreviewStorageKey(input: {
  environment: Environments;
  countryCode?: string | null;
  priceIds: string[];
}): string {
  const country = (input.countryCode ?? "auto").trim().toUpperCase() || "AUTO";
  return `${STORAGE_PREFIX}${input.environment}:${country}:${priceIdsCacheKey(input.priceIds)}`;
}

export function readPricePreviewCache(input: {
  environment: Environments;
  countryCode?: string | null;
  priceIds: string[];
}): PricePreviewCachePayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(pricePreviewStorageKey(input));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PricePreviewCachePayload;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.cachedAt !== "number") return null;
    if (Date.now() - parsed.cachedAt > PRICE_PREVIEW_CACHE_TTL_MS) return null;
    if (!parsed.byId || typeof parsed.byId !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePricePreviewCache(
  input: {
    environment: Environments;
    countryCode?: string | null;
    priceIds: string[];
  },
  payload: Omit<
    PricePreviewCachePayload,
    "cachedAt" | "environment" | "countryCode" | "priceIdsKey"
  >
): void {
  if (typeof window === "undefined") return;
  try {
    const full: PricePreviewCachePayload = {
      ...payload,
      cachedAt: Date.now(),
      environment: input.environment,
      countryCode: (input.countryCode ?? "auto").trim().toUpperCase() || "AUTO",
      priceIdsKey: priceIdsCacheKey(input.priceIds),
    };
    window.sessionStorage.setItem(
      pricePreviewStorageKey(input),
      JSON.stringify(full)
    );
  } catch {
    // Private mode / quota — ignore.
  }
}
