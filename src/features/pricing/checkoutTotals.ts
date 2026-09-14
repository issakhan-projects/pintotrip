import type { AppliedPromo } from "@/types/promo-code";
import type { BillingInterval, PlanDefinition } from "@/features/profile/plans";
import { getYearlySavingsPercent } from "@/features/profile/plans";

export type CheckoutCurrency = "USD" | "KZT";

/** Display FX for Kazakhstan pricing (USD list prices → KZT). */
export const USD_TO_KZT_RATE = 460;

export interface CheckoutTotals {
  /** List price before discounts (monthly, or monthly × 12 for yearly). */
  subtotal: number;
  yearlyDiscountAmount: number;
  yearlyDiscountPercent: number;
  /** Amount after yearly discount, before promo. */
  afterYearly: number;
  promoDiscountAmount: number;
  /** Final charge; floored at 0. */
  total: number;
}

export function computeCheckoutTotals(
  plan: PlanDefinition,
  interval: BillingInterval,
  promo: AppliedPromo | null
): CheckoutTotals {
  const monthly = plan.priceMonthly;
  const subtotal = interval === "year" ? monthly * 12 : monthly;
  const yearlyDiscountPercent =
    interval === "year" ? getYearlySavingsPercent(plan) : 0;
  const yearlyDiscountAmount =
    interval === "year" ? Math.max(0, subtotal - plan.priceYearly) : 0;
  const afterYearly = Math.max(0, subtotal - yearlyDiscountAmount);

  let promoDiscountAmount = 0;
  if (promo && afterYearly > 0) {
    if (promo.discountType === "percent") {
      const discounted = afterYearly * (1 - promo.discountValue / 100);
      promoDiscountAmount = Math.max(0, afterYearly - discounted);
    } else {
      promoDiscountAmount = Math.min(afterYearly, promo.discountValue);
    }
  }

  const total = Math.max(0, afterYearly - promoDiscountAmount);

  return {
    subtotal,
    yearlyDiscountAmount,
    yearlyDiscountPercent,
    afterYearly,
    promoDiscountAmount,
    total,
  };
}

/** True when country / location string indicates Kazakhstan. */
export function isKazakhstanLocation(country?: string | null): boolean {
  const countryNorm = country?.trim().toLowerCase() ?? "";
  if (!countryNorm) return false;
  return (
    countryNorm === "kz" ||
    countryNorm === "kazakhstan" ||
    countryNorm === "қазақстан" ||
    countryNorm.includes("kazakhstan") ||
    countryNorm.includes("қазақстан")
  );
}

/**
 * Pricing currency from location: Kazakhstan → KZT, else USD.
 * Falls back to profile currency / browser locale when country is unknown.
 */
export function resolveCheckoutCurrency(
  profileCurrency?: string | null,
  country?: string | null
): CheckoutCurrency {
  if (isKazakhstanLocation(country)) return "KZT";

  const cur = profileCurrency?.trim().toUpperCase();
  if (cur === "KZT") return "KZT";

  if (typeof navigator !== "undefined") {
    const locale = navigator.language?.toLowerCase() ?? "";
    if (locale.includes("-kz") || locale.endsWith("_kz")) return "KZT";
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    if (
      timeZone === "Asia/Almaty" ||
      timeZone === "Asia/Aqtobe" ||
      timeZone === "Asia/Atyrau" ||
      timeZone === "Asia/Oral" ||
      timeZone === "Asia/Qostanay" ||
      timeZone === "Asia/Qyzylorda" ||
      timeZone === "Asia/Aqtau"
    ) {
      return "KZT";
    }
  }
  return "USD";
}

/** Convert a USD list amount into the display currency amount. */
export function usdToDisplayAmount(
  usdAmount: number,
  currency: CheckoutCurrency
): number {
  if (currency === "KZT") {
    return Math.round(usdAmount * USD_TO_KZT_RATE);
  }
  return usdAmount;
}

export function formatCheckoutAmount(
  amountUsd: number,
  currency: CheckoutCurrency
): string {
  const amount = usdToDisplayAmount(amountUsd, currency);
  if (currency === "KZT") {
    return new Intl.NumberFormat("ru-KZ", {
      style: "currency",
      currency: "KZT",
      maximumFractionDigits: 0,
    }).format(amount);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function addBillingPeriod(
  from: Date,
  interval: BillingInterval
): Date {
  const end = new Date(from);
  if (interval === "year") {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return end;
}

export function formatCheckoutDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
