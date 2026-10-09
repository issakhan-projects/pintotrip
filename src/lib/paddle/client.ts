"use client";

import {
  initializePaddle,
  type CheckoutOpenOptions,
  type Environments,
  type Paddle,
  type PaddleEventData,
  type PricePreviewParams,
  type PricePreviewResponse,
} from "@paddle/paddle-js";
import { setRealtimeSyncEnabled } from "@/lib/firebase";
import { getUserProfile } from "@/services/users";
import { getFirebaseAuth } from "@/lib/firebase/auth";
import { devLog } from "@/lib/devLog";
import { getPaddlePublicEnv } from "./env";

let paddlePromise: Promise<Paddle> | null = null;
let paddlePromiseKey: string | null = null;
let postCheckoutSyncTimer: ReturnType<typeof setTimeout> | null = null;
let postCheckoutPollTimer: ReturnType<typeof setInterval> | null = null;

const checkoutCompletedListeners = new Set<
  (event: PaddleEventData) => void
>();

/** Free users normally have no onSnapshot — open a short live window after pay. */
function beginPostCheckoutProfileSync() {
  setRealtimeSyncEnabled(true);

  if (postCheckoutSyncTimer) clearTimeout(postCheckoutSyncTimer);
  if (postCheckoutPollTimer) clearInterval(postCheckoutPollTimer);

  const uid = getFirebaseAuth().currentUser?.uid;
  if (uid) {
    void getUserProfile(uid, { hard: true });
    postCheckoutPollTimer = setInterval(() => {
      void getUserProfile(uid, { hard: true });
    }, 2_000);
  }

  postCheckoutSyncTimer = setTimeout(() => {
    if (postCheckoutPollTimer) {
      clearInterval(postCheckoutPollTimer);
      postCheckoutPollTimer = null;
    }
    setRealtimeSyncEnabled(null);
    postCheckoutSyncTimer = null;
  }, 60_000);
}

/**
 * Keep applied Paddle discount code on transaction.customData so the webhook
 * can write promoCode even if discounts.get fails server-side.
 * updateCheckout replaces customData — always merge with existing keys.
 */
function syncPromoCodeIntoCustomData(
  paddle: Paddle,
  event: PaddleEventData
): void {
  const data = event.data as Record<string, unknown> | undefined;
  if (!data) return;

  const existingRaw = data.custom_data ?? data.customData;
  const existing =
    existingRaw && typeof existingRaw === "object" && !Array.isArray(existingRaw)
      ? { ...(existingRaw as Record<string, unknown>) }
      : {};

  const discount = data.discount as
    | { id?: string; code?: string | null }
    | null
    | undefined;
  const code =
    typeof discount?.code === "string" && discount.code.trim()
      ? discount.code.trim().toUpperCase()
      : null;

  const prev =
    typeof existing.promoCode === "string"
      ? existing.promoCode.trim().toUpperCase()
      : null;

  if (code) {
    if (prev === code) return;
    existing.promoCode = code;
  } else if (prev) {
    delete existing.promoCode;
  } else {
    return;
  }

  if (Object.keys(existing).length === 0) return;

  try {
    paddle.Checkout.updateCheckout({ customData: existing });
  } catch (error) {
    devLog.error("[Paddle] failed to sync promoCode customData", error);
  }
}

function logPaddleEvent(event: PaddleEventData) {
  const name = event.name ?? event.type;
  if (name === "checkout.error" || name === "checkout.warning") {
    devLog.error("[Paddle]", name, event);
  }
  if (
    name === "checkout.discount.applied" ||
    name === "checkout.discount.removed"
  ) {
    void getPaddle()
      .then((paddle) => syncPromoCodeIntoCustomData(paddle, event))
      .catch((error) => {
        devLog.error("[Paddle] promo sync skipped", error);
      });
  }
  if (name === "checkout.completed") {
    beginPostCheckoutProfileSync();
    for (const listener of checkoutCompletedListeners) {
      try {
        listener(event);
      } catch (error) {
        devLog.error("[Paddle] checkout.completed listener failed", error);
      }
    }
  }
}

function cacheKey(environment: Environments, token: string): string {
  return `${environment}:${token.slice(0, 12)}`;
}

/**
 * Lazily initialize a singleton Paddle.js instance for the browser.
 * Uses NEXT_PUBLIC_PADDLE_* — never touches the server API key.
 * Re-inits if hostname flips sandbox ↔ live.
 */
export function getPaddle(): Promise<Paddle> {
  const { environment, clientToken } = getPaddlePublicEnv();
  const key = cacheKey(environment, clientToken);

  if (!paddlePromise || paddlePromiseKey !== key) {
    paddlePromiseKey = key;
    paddlePromise = (async () => {
      const paddle = await initializePaddle({
        environment,
        token: clientToken,
        eventCallback: logPaddleEvent,
      });
      if (!paddle) {
        throw new Error("Failed to initialize Paddle.js");
      }
      return paddle;
    })();
  }
  return paddlePromise;
}

export async function previewPrices(
  params: PricePreviewParams
): Promise<PricePreviewResponse> {
  const paddle = await getPaddle();
  return paddle.PricePreview(params);
}

export async function openCheckout(options: CheckoutOpenOptions): Promise<void> {
  const paddle = await getPaddle();
  paddle.Checkout.open(options);
}

/** UI-only: overlay checkout finished (credits are granted by paddleWebhook). */
export function onCheckoutCompleted(
  listener: (event: PaddleEventData) => void
): () => void {
  checkoutCompletedListeners.add(listener);
  return () => {
    checkoutCompletedListeners.delete(listener);
  };
}

export function readCheckoutCreditPackId(
  event: PaddleEventData
): string | null {
  const data = event.data as Record<string, unknown> | undefined;
  if (!data) return null;
  const custom = data.custom_data ?? data.customData;
  if (!custom || typeof custom !== "object") return null;
  const packId = (custom as { creditPackId?: unknown }).creditPackId;
  return typeof packId === "string" && packId.trim() ? packId.trim() : null;
}

/** Drop the cached instance after env changes (e.g. hot reload). */
export function resetPaddleClient(): void {
  paddlePromise = null;
  paddlePromiseKey = null;
}
