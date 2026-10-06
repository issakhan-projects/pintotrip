import { onCall, HttpsError } from "firebase-functions/https";
import { logger } from "firebase-functions";
import { requireAuth } from "../shared/auth";
import { DEFAULT_FUNCTIONS_REGION, paddleSecrets } from "../shared/config";
import { adminDb, initAdmin } from "../shared/admin";
import {
  getPaddleServer,
  type PaddleBillingEnvironment,
} from "./paddleClient";

export type CancelPaddleSubscriptionResult = {
  scheduledChangeEffectiveAt: string | null;
};

function paddleErrorMessage(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const obj = err as {
    message?: string;
    detail?: string;
    error?: { detail?: string; code?: string };
  };
  return (
    obj.error?.detail?.trim() ||
    obj.detail?.trim() ||
    obj.message?.trim() ||
    String(err)
  );
}

/**
 * Schedule cancellation at period end via Paddle API.
 * Firestore is updated by paddleWebhook (subscription.updated / canceled).
 */
export const cancelPaddleSubscription = onCall(
  {
    region: DEFAULT_FUNCTIONS_REGION,
    secrets: [...paddleSecrets],
    invoker: "public",
    cors: true,
  },
  async (request): Promise<CancelPaddleSubscriptionResult> => {
    initAdmin();
    const userId = requireAuth(request);
    const db = adminDb();

    const userSnap = await db.doc(`users/${userId}`).get();
    if (!userSnap.exists) {
      throw new HttpsError("failed-precondition", "User profile is missing.");
    }

    const subscription = userSnap.data()?.subscription as
      | {
          plan?: string;
          paddleCustomerId?: string;
          paddleSubscriptionId?: string;
          paddleEnvironment?: PaddleBillingEnvironment;
        }
      | undefined;

    const plan = subscription?.plan ?? "free";
    if (plan === "free") {
      throw new HttpsError(
        "failed-precondition",
        "No paid subscription to cancel."
      );
    }

    const customerId = subscription?.paddleCustomerId?.trim();
    const subscriptionId = subscription?.paddleSubscriptionId?.trim();
    if (!customerId || !subscriptionId) {
      throw new HttpsError(
        "failed-precondition",
        "Paddle subscription is not linked yet."
      );
    }

    const environment: PaddleBillingEnvironment =
      subscription?.paddleEnvironment === "production"
        ? "production"
        : "sandbox";

    try {
      const paddle = getPaddleServer(environment);
      const current = await paddle.subscriptions.get(subscriptionId);
      if (current.customerId !== customerId) {
        throw new HttpsError("permission-denied", "Forbidden.");
      }

      const alreadyCancel =
        String(current.scheduledChange?.action ?? "").toLowerCase() ===
          "cancel" ||
        String(current.status).toLowerCase() === "canceled" ||
        String(current.status).toLowerCase() === "cancelled";

      const updated = alreadyCancel
        ? current
        : await paddle.subscriptions.cancel(subscriptionId, {
            effectiveFrom: "next_billing_period",
          });

      const scheduledAt =
        updated.scheduledChange?.effectiveAt?.trim() ||
        current.currentBillingPeriod?.endsAt?.trim() ||
        null;

      logger.info("paddle subscription cancel requested", {
        userId,
        subscriptionId,
        environment,
        status: updated.status,
        scheduledAt,
        alreadyCancel,
      });

      return { scheduledChangeEffectiveAt: scheduledAt };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error("cancelPaddleSubscription failed", {
        userId,
        subscriptionId,
        environment,
        error: paddleErrorMessage(err),
      });
      throw new HttpsError("internal", paddleErrorMessage(err));
    }
  }
);
