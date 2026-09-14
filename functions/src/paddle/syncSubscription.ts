import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { adminDb } from "../shared/admin";
import {
  resolveEntitledPlan,
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
  updatedAt: FirebaseFirestore.FieldValue;
};

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

  // Drop undefined optional fields so Firestore merge stays clean.
  const subscriptionDoc: Record<string, unknown> = {
    plan: payload.plan,
    status: payload.status,
    updatedAt: payload.updatedAt,
  };
  if (payload.paddleCustomerId) {
    subscriptionDoc.paddleCustomerId = payload.paddleCustomerId;
  }
  if (payload.paddleSubscriptionId) {
    subscriptionDoc.paddleSubscriptionId = payload.paddleSubscriptionId;
  }
  if (payload.paddleEnvironment) {
    subscriptionDoc.paddleEnvironment = payload.paddleEnvironment;
  }
  if (payload.productId) subscriptionDoc.productId = payload.productId;
  if (payload.priceId) subscriptionDoc.priceId = payload.priceId;
  if (payload.currentPeriodEnd !== undefined) {
    subscriptionDoc.currentPeriodEnd = payload.currentPeriodEnd;
  }

  await adminDb().doc(`users/${userId}`).set(
    {
      subscription: subscriptionDoc,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
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
}): Promise<void> {
  const { plan, status } = resolveEntitledPlan({
    paddleStatus: input.paddleStatus,
    priceId: input.priceId,
    productId: input.productId,
  });

  await writeUserSubscription(input.userId, {
    plan,
    status,
    paddleCustomerId: input.paddleCustomerId,
    paddleSubscriptionId: input.paddleSubscriptionId,
    paddleEnvironment: input.paddleEnvironment,
    productId: input.productId ?? undefined,
    priceId: input.priceId ?? undefined,
    currentPeriodEnd: periodEndTimestamp(input.currentPeriodEnd),
  });

  logger.info("paddle subscription synced", {
    userId: input.userId,
    plan,
    status,
    paddleEnvironment: input.paddleEnvironment,
    paddleSubscriptionId: input.paddleSubscriptionId,
    priceId: input.priceId ?? null,
  });
}
