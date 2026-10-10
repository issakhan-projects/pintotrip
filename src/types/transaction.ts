import type { Timestamp } from "firebase/firestore";
import type { SubscriptionPlan } from "@/types/user";

export type BillingTransactionStatus = "success" | "failed";

export type BillingPeriod = "month" | "year";

/**
 * Firestore document: transactions/{paddleTransactionId}
 * Written by Cloud Functions from Paddle webhooks.
 */
export interface BillingTransaction {
  userId: string;
  status: BillingTransactionStatus;
  /** Major-unit amount (already converted from Paddle minor units). */
  amount: number;
  currency: string;
  planId: SubscriptionPlan;
  billingPeriod: BillingPeriod;
  monthlyPriceUsd: number;
  description: string;
  locale: string | null;
  provider: "paddle";
  promoCode: string | null;
  promoDiscountValue: number;
  paddleDiscountId: string | null;
  paddleTransactionId: string;
  paddleEnvironment: "sandbox" | "production";
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type SavedBillingTransaction = BillingTransaction & { id: string };
