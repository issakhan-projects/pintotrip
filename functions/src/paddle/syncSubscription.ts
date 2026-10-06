import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { adminDb } from "../shared/admin";
import { creditPackGrantAmount } from "./creditPacks";
import {
  PLAN_AI_CREDITS_MONTHLY,
  resolveBillingPeriodFromPriceId,
  resolveEntitledPlan,
  type AppBillingPeriod,
  type AppPlan,
  type AppSubscriptionStatus,
} from "./planMapping";

export const PADDLE_WEBHOOK_EVENTS_COLLECTION = "paddleWebhookEvents";

export type SubscriptionWrite = {
  plan: AppPlan;
  status: AppSubscriptionStatus;
  paddleCustomerId?: string;
  paddleSubscriptionId?: string;
  paddleEnvironment?: "sandbox" | "production";
  productId?: string;
  priceId?: string;
  currentPeriodEnd?: Timestamp | null;
  cancelAtPeriodEnd?: boolean;
  cancelEffectiveAt?: Timestamp | null;
  planCreditGrantKey?: string | null;
  planCreditGrantPlan?: "plus" | "pro" | null;
  updatedAt: FirebaseFirestore.FieldValue;
};

type StoredSubscription = {
  plan?: AppPlan;
  status?: AppSubscriptionStatus;
  planCreditGrantKey?: string | null;
  planCreditGrantPlan?: "plus" | "pro" | null;
};

function readBalance(data: FirebaseFirestore.DocumentData | undefined): number {
  const raw = data?.aiCreditsBalance;
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

function paidMonthlyCredits(plan: AppPlan | string | null | undefined): number {
  if (plan === "plus" || plan === "pro") return PLAN_AI_CREDITS_MONTHLY[plan];
  return 0;
}

function storedPeriodEndIso(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    try {
      return (value as Timestamp).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function periodEndEpochMs(endsAt: string | null | undefined): number | null {
  if (!endsAt?.trim()) return null;
  const ms = Date.parse(endsAt);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * One grant per Paddle billing period (and a top-up if the user upgrades
 * Plus → Pro in the same period). Yearly prices grant 12× monthly credits.
 */
export function planCreditGrantKey(input: {
  paddleSubscriptionId?: string | null;
  currentPeriodEnd?: string | null;
}): string | null {
  const subId = input.paddleSubscriptionId?.trim();
  const endMs = periodEndEpochMs(input.currentPeriodEnd);
  if (!subId || endMs == null) return null;
  return `period:${subId}:${endMs}`;
}

export function planCreditGrantAmount(input: {
  plan: AppPlan;
  billingPeriod?: AppBillingPeriod | null;
}): number {
  const monthly = paidMonthlyCredits(input.plan);
  if (monthly <= 0) return 0;
  if (input.billingPeriod === "year") return monthly * 12;
  return monthly;
}

function readCustomFirebaseUid(
  customData: Record<string, unknown> | null | undefined
): string | undefined {
  if (!customData || typeof customData !== "object") return undefined;
  const raw =
    customData.firebaseUid ??
    customData.firebase_uid ??
    customData.uid ??
    customData.userId;
  if (typeof raw !== "string") return undefined;
  const uid = raw.trim();
  return uid.length > 0 ? uid : undefined;
}

/**
 * Map a Paddle customer / email / customData to users/{uid}.
 * Returns null when no existing Firebase user can be resolved (safe ignore).
 */
export async function resolveFirebaseUserId(input: {
  customData?: Record<string, unknown> | null;
  email?: string | null;
  paddleCustomerId?: string | null;
}): Promise<string | null> {
  const db = adminDb();
  const fromCustom = readCustomFirebaseUid(input.customData ?? null);
  if (fromCustom) {
    const snap = await db.doc(`users/${fromCustom}`).get();
    if (snap.exists) return fromCustom;
    logger.warn("paddle webhook: customData firebaseUid not found", {
      firebaseUid: fromCustom,
    });
  }

  const customerId = input.paddleCustomerId?.trim();
  if (customerId) {
    const byCustomer = await db
      .collection("users")
      .where("subscription.paddleCustomerId", "==", customerId)
      .limit(1)
      .get();
    if (!byCustomer.empty) return byCustomer.docs[0].id;
  }

  const email = input.email?.trim().toLowerCase();
  if (email) {
    const byEmail = await db
      .collection("users")
      .where("email", "==", email)
      .limit(1)
      .get();
    if (!byEmail.empty) return byEmail.docs[0].id;

    // Profiles may store mixed-case email from Auth.
    const byEmailExact = await db
      .collection("users")
      .where("email", "==", input.email!.trim())
      .limit(1)
      .get();
    if (!byEmailExact.empty) return byEmailExact.docs[0].id;
  }

  return null;
}

export async function wasEventProcessed(eventId: string): Promise<boolean> {
  const snap = await adminDb()
    .collection(PADDLE_WEBHOOK_EVENTS_COLLECTION)
    .doc(eventId)
    .get();
  return snap.exists;
}

export async function markEventProcessed(input: {
  eventId: string;
  eventType: string;
  userId?: string | null;
}): Promise<void> {
  await adminDb()
    .collection(PADDLE_WEBHOOK_EVENTS_COLLECTION)
    .doc(input.eventId)
    .set({
      eventId: input.eventId,
      eventType: input.eventType,
      userId: input.userId ?? null,
      processedAt: FieldValue.serverTimestamp(),
    });
}

export async function writeUserSubscription(
  userId: string,
  subscription: Omit<SubscriptionWrite, "updatedAt">
): Promise<void> {
  const payload: SubscriptionWrite = {
    ...subscription,
    updatedAt: FieldValue.serverTimestamp(),
  };

  // Nested dotted paths so we do not wipe sibling subscription fields
  // (currentPeriodEnd, planCreditGrantKey, etc.).
  const nested: Record<string, unknown> = {
    "subscription.plan": payload.plan,
    "subscription.status": payload.status,
    "subscription.updatedAt": payload.updatedAt,
  };
  if (payload.paddleCustomerId) {
    nested["subscription.paddleCustomerId"] = payload.paddleCustomerId;
  }
  if (payload.paddleSubscriptionId) {
    nested["subscription.paddleSubscriptionId"] = payload.paddleSubscriptionId;
  }
  if (payload.paddleEnvironment) {
    nested["subscription.paddleEnvironment"] = payload.paddleEnvironment;
  }
  if (payload.productId) nested["subscription.productId"] = payload.productId;
  if (payload.priceId) nested["subscription.priceId"] = payload.priceId;
  if (payload.currentPeriodEnd !== undefined) {
    nested["subscription.currentPeriodEnd"] = payload.currentPeriodEnd;
  }
  if (payload.cancelAtPeriodEnd !== undefined) {
    nested["subscription.cancelAtPeriodEnd"] = payload.cancelAtPeriodEnd;
  }
  if (payload.cancelEffectiveAt !== undefined) {
    nested["subscription.cancelEffectiveAt"] = payload.cancelEffectiveAt;
  }
  if (payload.planCreditGrantKey !== undefined) {
    nested["subscription.planCreditGrantKey"] = payload.planCreditGrantKey;
  }
  if (payload.planCreditGrantPlan !== undefined) {
    nested["subscription.planCreditGrantPlan"] = payload.planCreditGrantPlan;
  }

  await adminDb().doc(`users/${userId}`).update({
    ...nested,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Add the paid plan's AI credits to users/{uid}.aiCreditsBalance.
 * Idempotent on planCreditGrantKey (subscription id + period end).
 */
export async function grantPlanAiCreditsIfNeeded(input: {
  userId: string;
  plan: AppPlan;
  paddleSubscriptionId?: string | null;
  currentPeriodEnd?: string | null;
  priceId?: string | null;
}): Promise<number> {
  const billingPeriod = resolveBillingPeriodFromPriceId(input.priceId);
  const nextAmount = planCreditGrantAmount({
    plan: input.plan,
    billingPeriod,
  });
  if (nextAmount <= 0) return 0;

  const ref = adminDb().doc(`users/${input.userId}`);

  const result = await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new Error(
        `User profile missing for plan credit grant: ${input.userId}`
      );
    }

    const data = snap.data();
    const prev = data?.subscription as
      | (StoredSubscription & {
          paddleSubscriptionId?: string;
          currentPeriodEnd?: unknown;
        })
      | undefined;

    const grantKey = planCreditGrantKey({
      paddleSubscriptionId:
        input.paddleSubscriptionId ?? prev?.paddleSubscriptionId,
      currentPeriodEnd:
        input.currentPeriodEnd ?? storedPeriodEndIso(prev?.currentPeriodEnd),
    });
    if (!grantKey) {
      return { granted: 0, grantKey: null as string | null };
    }

    const prevKey = prev?.planCreditGrantKey ?? null;
    const alreadyGrantedPlan: AppPlan =
      prev?.planCreditGrantPlan === "pro" || prev?.planCreditGrantPlan === "plus"
        ? prev.planCreditGrantPlan
        : "free";

    let amount = 0;
    if (prevKey !== grantKey) {
      amount = nextAmount;
    } else {
      const alreadyGranted = planCreditGrantAmount({
        plan: alreadyGrantedPlan,
        billingPeriod,
      });
      amount = Math.max(0, nextAmount - alreadyGranted);
    }

    if (amount <= 0) {
      return { granted: 0, grantKey };
    }

    const grantPlan =
      input.plan === "pro" || input.plan === "plus" ? input.plan : null;
    const nextBalance = readBalance(data) + amount;
    tx.update(ref, {
      aiCreditsBalance: nextBalance,
      "subscription.planCreditGrantKey": grantKey,
      "subscription.planCreditGrantPlan": grantPlan,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { granted: amount, grantKey };
  });

  if (!result.grantKey) {
    logger.warn("paddle plan credits skipped: missing subscription period", {
      userId: input.userId,
      plan: input.plan,
      paddleSubscriptionId: input.paddleSubscriptionId ?? null,
    });
    return 0;
  }

  if (result.granted > 0) {
    logger.info("paddle plan AI credits granted", {
      userId: input.userId,
      plan: input.plan,
      amount: result.granted,
      grantKey: result.grantKey,
      billingPeriod: billingPeriod ?? "month",
    });
  }

  return result.granted;
}

export function periodEndTimestamp(
  endsAt: string | null | undefined
): Timestamp | null {
  if (!endsAt) return null;
  const ms = Date.parse(endsAt);
  if (!Number.isFinite(ms)) return null;
  return Timestamp.fromMillis(ms);
}

export async function syncSubscriptionFromPaddle(input: {
  userId: string;
  paddleStatus: string;
  paddleCustomerId: string;
  paddleSubscriptionId: string;
  paddleEnvironment: "sandbox" | "production";
  priceId?: string | null;
  productId?: string | null;
  currentPeriodEnd?: string | null;
  scheduledChangeAction?: string | null;
  scheduledChangeEffectiveAt?: string | null;
}): Promise<void> {
  const { plan, status } = resolveEntitledPlan({
    paddleStatus: input.paddleStatus,
    priceId: input.priceId,
    productId: input.productId,
  });

  const cancelAtPeriodEnd =
    status !== "canceled" &&
    (input.scheduledChangeAction ?? "").toLowerCase() === "cancel";

  await writeUserSubscription(input.userId, {
    plan,
    status,
    paddleCustomerId: input.paddleCustomerId,
    paddleSubscriptionId: input.paddleSubscriptionId,
    paddleEnvironment: input.paddleEnvironment,
    productId: input.productId ?? undefined,
    priceId: input.priceId ?? undefined,
    currentPeriodEnd: periodEndTimestamp(input.currentPeriodEnd),
    cancelAtPeriodEnd,
    cancelEffectiveAt: cancelAtPeriodEnd
      ? periodEndTimestamp(input.scheduledChangeEffectiveAt)
      : null,
  });

  if (plan === "plus" || plan === "pro") {
    await grantPlanAiCreditsIfNeeded({
      userId: input.userId,
      plan,
      paddleSubscriptionId: input.paddleSubscriptionId,
      currentPeriodEnd: input.currentPeriodEnd,
      priceId: input.priceId,
    });
  }

  logger.info("paddle subscription synced", {
    userId: input.userId,
    plan,
    status,
    paddleEnvironment: input.paddleEnvironment,
    paddleSubscriptionId: input.paddleSubscriptionId,
    priceId: input.priceId ?? null,
  });
}

export function creditPackAmountFromItems(
  items: Array<{ priceId?: string | null; quantity?: number | null }>
): number {
  let total = 0;
  for (const item of items) {
    const unit = creditPackGrantAmount(item.priceId);
    if (unit <= 0) continue;
    const qty =
      typeof item.quantity === "number" && Number.isFinite(item.quantity)
        ? Math.max(1, Math.floor(item.quantity))
        : 1;
    total += unit * qty;
  }
  return total;
}

/**
 * Add one-time credit-pack AI credits. Idempotent on transactions/{txnId}.aiCreditsGranted.
 */
export async function grantCreditPacksIfNeeded(input: {
  userId: string;
  transactionId: string;
  items: Array<{ priceId?: string | null; quantity?: number | null }>;
}): Promise<number> {
  const amount = creditPackAmountFromItems(input.items);
  if (amount <= 0) return 0;

  const transactionId = input.transactionId.trim();
  if (!transactionId) {
    throw new Error("Missing Paddle transaction id for credit pack grant");
  }

  const userRef = adminDb().doc(`users/${input.userId}`);
  const txnRef = adminDb().doc(`transactions/${transactionId}`);

  const granted = await adminDb().runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const txnSnap = await tx.get(txnRef);

    if (!userSnap.exists) {
      throw new Error(
        `User profile missing for credit pack grant: ${input.userId}`
      );
    }

    const already = txnSnap.data()?.aiCreditsGranted;
    if (typeof already === "number" && already > 0) {
      return 0;
    }

    const nextBalance = readBalance(userSnap.data()) + amount;
    tx.update(userRef, {
      aiCreditsBalance: nextBalance,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(
      txnRef,
      {
        aiCreditsGranted: amount,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return amount;
  });

  if (granted > 0) {
    logger.info("paddle credit pack AI credits granted", {
      userId: input.userId,
      transactionId,
      amount: granted,
    });
  }

  return granted;
}
