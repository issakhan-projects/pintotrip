import {
  EventName,
  type EventEntity,
  type SubscriptionCanceledEvent,
  type SubscriptionCreatedEvent,
  type SubscriptionUpdatedEvent,
  type TransactionCompletedEvent,
  type TransactionNotification,
  type TransactionPaymentFailedEvent,
} from "@paddle/paddle-node-sdk";
import { logger } from "firebase-functions";
import { adminDb } from "../shared/admin";
import {
  getPaddleServer,
  type PaddleBillingEnvironment,
} from "./paddleClient";
import {
  markEventProcessed,
  resolveFirebaseUserId,
  syncSubscriptionFromPaddle,
  wasEventProcessed,
  writeUserSubscription,
} from "./syncSubscription";
import { savePaddleTransaction } from "./saveTransaction";
import type { AppPlan, AppSubscriptionStatus } from "./planMapping";

type SubscriptionEvent =
  | SubscriptionCreatedEvent
  | SubscriptionUpdatedEvent
  | SubscriptionCanceledEvent;

function asCustomData(
  value: unknown
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function primaryItemIds(sub: {
  items?: Array<{
    price?: { id?: string; productId?: string } | null;
    product?: { id?: string } | null;
  }>;
}): {
  priceId: string | null;
  productId: string | null;
} {
  const item = sub.items?.[0];
  const priceId = item?.price?.id?.trim() || null;
  const productId =
    item?.product?.id?.trim() ||
    item?.price?.productId?.trim() ||
    null;
  return { priceId, productId };
}

async function resolveUserForTransaction(
  tx: TransactionNotification,
  environment: PaddleBillingEnvironment,
  eventId: string,
  eventType: string
): Promise<string | null> {
  const customData = asCustomData(tx.customData);
  const customerId = tx.customerId?.trim() || null;

  let email: string | null = null;
  if (customerId) {
    try {
      const customer = await getPaddleServer(environment).customers.get(
        customerId
      );
      email = customer.email?.trim() || null;
    } catch (err) {
      logger.warn("paddle transaction: customer lookup failed", {
        customerId,
        environment,
        eventType,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const userId = await resolveFirebaseUserId({
    customData,
    email,
    paddleCustomerId: customerId,
  });

  if (!userId) {
    logger.warn("paddle transaction: no matching Firebase user", {
      eventId,
      eventType,
      environment,
      customerId,
      email,
      transactionId: tx.id,
    });
  }

  return userId;
}

async function handleSubscriptionEvent(
  event: SubscriptionEvent,
  environment: PaddleBillingEnvironment
): Promise<string | null> {
  const sub = event.data;
  const { priceId, productId } = primaryItemIds(sub);
  const customData = asCustomData(sub.customData);

  const userId = await resolveFirebaseUserId({
    customData,
    paddleCustomerId: sub.customerId,
  });

  if (!userId) {
    logger.warn("paddle subscription event: no matching Firebase user", {
      eventId: event.eventId,
      eventType: event.eventType,
      environment,
      customerId: sub.customerId,
      subscriptionId: sub.id,
    });
    return null;
  }

  await syncSubscriptionFromPaddle({
    userId,
    paddleStatus: String(sub.status),
    paddleCustomerId: sub.customerId,
    paddleSubscriptionId: sub.id,
    paddleEnvironment: environment,
    priceId,
    productId,
    currentPeriodEnd: sub.currentBillingPeriod?.endsAt ?? null,
  });

  return userId;
}

/**
 * transaction.completed — link customer + persist transactions/{txnId}.
 * Plan entitlement is driven by subscription.* events (source of truth).
 */
async function handleTransactionCompleted(
  event: TransactionCompletedEvent,
  environment: PaddleBillingEnvironment
): Promise<string | null> {
  const tx = event.data;
  const userId = await resolveUserForTransaction(
    tx,
    environment,
    event.eventId,
    event.eventType
  );

  if (!userId) return null;

  const customerId = tx.customerId?.trim() || null;

  const existing = (
    await adminDb().doc(`users/${userId}`).get()
  ).data()?.subscription as
    | {
        plan?: AppPlan;
        status?: AppSubscriptionStatus;
        paddleSubscriptionId?: string;
      }
    | undefined;

  await writeUserSubscription(userId, {
    plan: existing?.plan ?? "free",
    status: existing?.status ?? "active",
    paddleCustomerId: customerId ?? undefined,
    paddleSubscriptionId: existing?.paddleSubscriptionId,
    paddleEnvironment: environment,
  });

  await savePaddleTransaction({
    userId,
    status: "success",
    transaction: tx,
    environment,
  });

  logger.info("paddle transaction.completed: linked customer", {
    userId,
    customerId,
    environment,
    transactionId: tx.id,
  });

  return userId;
}

/**
 * transaction.payment_failed — persist failed attempt when user is known.
 */
async function handleTransactionPaymentFailed(
  event: TransactionPaymentFailedEvent,
  environment: PaddleBillingEnvironment
): Promise<string | null> {
  const tx = event.data;
  const userId = await resolveUserForTransaction(
    tx,
    environment,
    event.eventId,
    event.eventType
  );

  if (!userId) return null;

  await savePaddleTransaction({
    userId,
    status: "failed",
    transaction: tx,
    environment,
  });

  return userId;
}

/**
 * Process a verified Paddle event. Idempotent on event.eventId.
 * Unknown users are acknowledged (no throw) so Paddle does not retry forever.
 */
export async function processPaddleEvent(
  event: EventEntity,
  environment: PaddleBillingEnvironment
): Promise<void> {
  const eventId = event.eventId;
  if (!eventId) {
    throw new Error("Paddle event missing eventId");
  }

  if (await wasEventProcessed(eventId)) {
    logger.info("paddle webhook duplicate ignored", {
      eventId,
      eventType: event.eventType,
      environment,
    });
    return;
  }

  let userId: string | null = null;

  switch (event.eventType) {
    case EventName.TransactionCompleted:
      userId = await handleTransactionCompleted(event, environment);
      break;
    case EventName.TransactionPaymentFailed:
      userId = await handleTransactionPaymentFailed(event, environment);
      break;
    case EventName.SubscriptionCreated:
    case EventName.SubscriptionUpdated:
    case EventName.SubscriptionCanceled:
    case EventName.SubscriptionPastDue:
    case EventName.SubscriptionPaused:
    case EventName.SubscriptionResumed:
    case EventName.SubscriptionActivated:
    case EventName.SubscriptionTrialing:
      userId = await handleSubscriptionEvent(
        event as SubscriptionEvent,
        environment
      );
      break;
    default:
      logger.info("paddle webhook ignored event type", {
        eventId,
        eventType: event.eventType,
        environment,
      });
      break;
  }

  await markEventProcessed({
    eventId,
    eventType: event.eventType,
    userId,
  });
}
