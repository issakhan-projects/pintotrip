import { onCall, HttpsError } from "firebase-functions/https";
import { logger } from "firebase-functions";
import { requireAuth } from "../shared/auth";
import {
  DEFAULT_FUNCTIONS_REGION,
  paddleSecrets,
} from "../shared/config";
import { adminDb, initAdmin } from "../shared/admin";
import {
  getPaddleServer,
  type PaddleBillingEnvironment,
} from "./paddleClient";

export type CreatePaddlePortalSessionResult = {
  url: string;
  /** Deep link to cancel this subscription in the portal, when available. */
  cancelUrl: string | null;
};

type StoredSubscription = {
  plan?: string;
  paddleCustomerId?: string;
  paddleSubscriptionId?: string;
  paddleEnvironment?: PaddleBillingEnvironment;
};

export async function mintPortalUrls(userId: string): Promise<{
  url: string;
  cancelUrl: string | null;
  environment: PaddleBillingEnvironment;
  customerId: string;
  subscriptionId: string | null;
}> {
  const userSnap = await adminDb().doc(`users/${userId}`).get();
  if (!userSnap.exists) {
    throw new HttpsError("failed-precondition", "User profile is missing.");
  }

  const subscription = userSnap.data()?.subscription as
    | StoredSubscription
    | undefined;

  const plan = subscription?.plan ?? "free";
  if (plan === "free") {
    throw new HttpsError(
      "failed-precondition",
      "No paid subscription to manage."
    );
  }

  const customerId = subscription?.paddleCustomerId?.trim();
  if (!customerId) {
    throw new HttpsError(
      "failed-precondition",
      "Paddle customer is not linked yet. Complete a checkout first."
    );
  }

  const environment: PaddleBillingEnvironment =
    subscription?.paddleEnvironment === "production"
      ? "production"
      : "sandbox";

  const subscriptionId = subscription?.paddleSubscriptionId?.trim() || null;
  const subscriptionIds = subscriptionId ? [subscriptionId] : [];

  const session = await getPaddleServer(
    environment
  ).customerPortalSessions.create(customerId, subscriptionIds);

  const url = session.urls.general.overview;
  if (!url) {
    throw new Error("Portal session missing overview URL");
  }

  const subLinks = session.urls.subscriptions ?? [];
  const match =
    (subscriptionId
      ? subLinks.find((row) => row.id === subscriptionId)
      : null) ?? subLinks[0];
  const cancelUrl = match?.cancelSubscription?.trim() || null;

  return { url, cancelUrl, environment, customerId, subscriptionId };
}

/**
 * Mint a one-time Paddle Customer Portal URL for the signed-in user.
 * Uses sandbox or live API key based on subscription.paddleEnvironment.
 */
export const createPaddlePortalSession = onCall(
  {
    region: DEFAULT_FUNCTIONS_REGION,
    secrets: [...paddleSecrets],
    invoker: "public",
    cors: true,
  },
  async (request): Promise<CreatePaddlePortalSessionResult> => {
    initAdmin();
    const userId = requireAuth(request);

    try {
      const minted = await mintPortalUrls(userId);
      return { url: minted.url, cancelUrl: minted.cancelUrl };
    } catch (err) {
      logger.error("createPaddlePortalSession failed", {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(
        "internal",
        "Could not open Paddle customer portal."
      );
    }
  }
);
