import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import type { TransactionNotification } from "@paddle/paddle-node-sdk";
import { adminDb } from "../shared/admin";
import {
  getPaddleServer,
  type PaddleBillingEnvironment,
} from "./paddleClient";
import {
  resolveBillingPeriodFromPriceId,
  resolvePlanFromCatalogIds,
  type AppBillingPeriod,
  type AppPlan,
} from "./planMapping";

export type TransactionStatus = "success" | "failed";

export type AppTransactionRecord = {
  userId: string;
  status: TransactionStatus;
  amount: number;
  currency: string;
  planId: AppPlan;
  billingPeriod: AppBillingPeriod;
  monthlyPriceUsd: number;
  description: string;
  locale: string | null;
  provider: "paddle";
  promoCode: string | null;
  promoDiscountValue: number;
  /** Paddle `dsc_…` when a discount was applied (even if code lookup failed). */
  paddleDiscountId: string | null;
  paddleTransactionId: string;
  paddleEnvironment: PaddleBillingEnvironment;
};

/** Currencies with no minor units (Paddle amount already in major units). */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

function parseMinorAmount(
  raw: string | null | undefined,
  currency: string
): number {
  if (!raw?.trim()) return 0;
  const minor = Number(raw);
  if (!Number.isFinite(minor)) return 0;
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return minor;
  return minor / 100;
}

function asCustomData(
  value: unknown
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function billingPeriodFromPriceCycle(input: {
  interval?: string | null;
  frequency?: number | null;
}): AppBillingPeriod | null {
  const interval = (input.interval ?? "").toLowerCase();
  const frequency = input.frequency ?? 1;
  if (interval === "year" && frequency === 1) return "year";
  if (interval === "month" && frequency === 12) return "year";
  if (interval === "month" && frequency === 1) return "month";
  return null;
}

function primaryLine(tx: TransactionNotification): {
  priceId: string | null;
  productId: string | null;
  description: string;
  billingPeriod: AppBillingPeriod | null;
  unitAmount: number;
  unitCurrency: string | null;
} {
  const item = tx.items?.[0];
  const price = item?.price ?? null;
  const priceId = price?.id?.trim() || null;
  const productId = price?.productId?.trim() || null;
  const description =
    price?.description?.trim() ||
    price?.name?.trim() ||
    "Paddle subscription";
  const fromCatalog = resolveBillingPeriodFromPriceId(priceId);
  const fromCycle = billingPeriodFromPriceCycle({
    interval: price?.billingCycle?.interval
      ? String(price.billingCycle.interval)
      : null,
    frequency: price?.billingCycle?.frequency ?? null,
  });
  const unitCurrency = price?.unitPrice?.currencyCode
    ? String(price.unitPrice.currencyCode)
    : null;
  const unitAmount = parseMinorAmount(
    price?.unitPrice?.amount,
    unitCurrency ?? "USD"
  );
  return {
    priceId,
    productId,
    description,
    billingPeriod: fromCatalog ?? fromCycle,
    unitAmount,
    unitCurrency,
  };
}

function promoFromCustomData(
  customData: Record<string, unknown> | null
): string | null {
  if (!customData) return null;
  for (const key of ["promoCode", "discountCode", "discount_code"] as const) {
    const raw = customData[key];
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim().toUpperCase();
    }
  }
  return null;
}

async function resolveDiscountId(
  environment: PaddleBillingEnvironment,
  tx: TransactionNotification
): Promise<string | null> {
  const fromTx = tx.discountId?.trim();
  if (fromTx) return fromTx;

  const transactionId = tx.id?.trim();
  if (!transactionId) return null;

  try {
    const full = await getPaddleServer(environment).transactions.get(
      transactionId
    );
    return full.discountId?.trim() || null;
  } catch (err) {
    logger.warn("paddle transaction: fetch for discountId failed", {
      transactionId,
      environment,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function resolvePromoCode(
  environment: PaddleBillingEnvironment,
  discountId: string | null,
  customData: Record<string, unknown> | null
): Promise<string | null> {
  const fromCustom = promoFromCustomData(customData);
  if (fromCustom) return fromCustom;

  if (!discountId) return null;
  try {
    const discount = await getPaddleServer(environment).discounts.get(
      discountId
    );
    const code = discount.code?.trim();
    if (code) return code.toUpperCase();
    // Automatic / code-less discounts still have a description.
    const description = discount.description?.trim();
    return description || null;
  } catch (err) {
    logger.warn("paddle transaction: discount lookup failed", {
      discountId,
      environment,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function monthlyPriceUsd(input: {
  billingPeriod: AppBillingPeriod | null;
  amount: number;
  currency: string;
  payoutGrandTotalUsd: number | null;
  unitAmount: number;
  unitCurrency: string | null;
}): number {
  const usdTotal =
    input.payoutGrandTotalUsd != null
      ? input.payoutGrandTotalUsd
      : input.currency.toUpperCase() === "USD"
        ? input.amount
        : input.unitCurrency?.toUpperCase() === "USD"
          ? input.unitAmount
          : 0;

  if (input.billingPeriod === "year") {
    return Math.round((usdTotal / 12) * 100) / 100;
  }
  return Math.round(usdTotal * 100) / 100;
}

/**
 * Upsert transactions/{paddleTransactionId} from a verified Paddle transaction event.
 */
export async function savePaddleTransaction(input: {
  userId: string;
  status: TransactionStatus;
  transaction: TransactionNotification;
  environment: PaddleBillingEnvironment;
}): Promise<void> {
  const tx = input.transaction;
  const transactionId = tx.id?.trim();
  if (!transactionId) {
    throw new Error("Paddle transaction missing id");
  }

  const customData = asCustomData(tx.customData);
  const line = primaryLine(tx);
  const planFromCatalog = resolvePlanFromCatalogIds({
    priceId: line.priceId,
    productId: line.productId,
  });
  const planId: AppPlan = planFromCatalog ?? "free";

  const currency = String(tx.currencyCode || "USD").toUpperCase();
  const totals = tx.details?.totals;
  const payout = tx.details?.payoutTotals;
  const amount = parseMinorAmount(
    totals?.grandTotal ?? totals?.total,
    currency
  );
  const discountAmount = parseMinorAmount(totals?.discount, currency);

  const payoutCurrency = payout?.currencyCode
    ? String(payout.currencyCode).toUpperCase()
    : null;
  const payoutGrandTotalUsd =
    payoutCurrency === "USD"
      ? parseMinorAmount(payout?.grandTotal ?? payout?.total, "USD")
      : null;

  const localeRaw = customData?.locale;
  const locale =
    typeof localeRaw === "string" && localeRaw.trim()
      ? localeRaw.trim()
      : null;

  const paddleDiscountId = await resolveDiscountId(
    input.environment,
    tx
  );
  const promoCode = await resolvePromoCode(
    input.environment,
    paddleDiscountId,
    customData
  );

  const record: AppTransactionRecord = {
    userId: input.userId,
    status: input.status,
    amount,
    currency,
    planId,
    billingPeriod: line.billingPeriod ?? "month",
    monthlyPriceUsd: monthlyPriceUsd({
      billingPeriod: line.billingPeriod ?? "month",
      amount,
      currency,
      payoutGrandTotalUsd,
      unitAmount: line.unitAmount,
      unitCurrency: line.unitCurrency,
    }),
    description: line.description,
    locale,
    provider: "paddle",
    promoCode,
    promoDiscountValue: discountAmount,
    paddleDiscountId,
    paddleTransactionId: transactionId,
    paddleEnvironment: input.environment,
  };

  const ref = adminDb().doc(`transactions/${transactionId}`);
  const existing = await ref.get();

  await ref.set(
    {
      ...record,
      updatedAt: FieldValue.serverTimestamp(),
      ...(existing.exists
        ? {}
        : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true }
  );

  logger.info("paddle transaction saved", {
    transactionId,
    userId: input.userId,
    status: input.status,
    planId,
    amount,
    currency,
    promoCode,
    promoDiscountValue: discountAmount,
    paddleDiscountId,
    environment: input.environment,
  });
}
