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
import { devLog } from "@/lib/devLog";
import { getPaddlePublicEnv } from "./env";

let paddlePromise: Promise<Paddle> | null = null;
let paddlePromiseKey: string | null = null;

const checkoutCompletedListeners = new Set<
  (event: PaddleEventData) => void
>();

function logPaddleEvent(event: PaddleEventData) {
  const name = event.name ?? event.type;
  if (name === "checkout.error" || name === "checkout.warning") {
    devLog.error("[Paddle]", name, event);
  }
  if (name === "checkout.completed") {
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
