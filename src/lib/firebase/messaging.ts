/**
 * Firebase Cloud Messaging (web push) — permission, token, foreground handler.
 */

import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type Messaging,
  type MessagePayload,
} from "firebase/messaging";
import { getFirebaseApp } from "./client";
import { getFirebasePublicEnv } from "@/lib/env";
import { emitForegroundPush } from "@/lib/push/events";
import { getWebPushSupport } from "@/lib/push/support";
import { devLog } from "@/lib/devLog";

let messaging: Messaging | undefined;

function vapidKey(): string | undefined {
  return process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY?.trim() || undefined;
}

export async function getFirebaseMessaging(): Promise<Messaging | null> {
  if (typeof window === "undefined") return null;
  if (!(await isSupported())) return null;
  if (!messaging) {
    messaging = getMessaging(getFirebaseApp());
  }
  return messaging;
}

/**
 * Ensure the app service worker is registered (PWA + FCM share /sw.js).
 */
export async function getAppServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    const existing = await navigator.serviceWorker.getRegistration("/");
    if (existing) return existing;
    return await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
  } catch (err) {
    devLog.warn("[FCM] service worker register failed", err);
    return null;
  }
}

function parsePayload(payload: MessagePayload): {
  title: string;
  body: string;
  link: string | null;
  type: string;
  tag: string | null;
} {
  const title =
    payload.notification?.title ||
    payload.data?.title ||
    "PinToTrip";
  const body =
    payload.notification?.body || payload.data?.body || "";
  const link = payload.data?.link || null;
  const type = payload.data?.type || "general";
  const tag = payload.data?.tag || payload.data?.notificationId || null;
  return { title, body, link, type, tag };
}

/**
 * Request notification permission (if needed) and return an FCM token.
 * Returns null when unsupported, denied, or misconfigured.
 */
export async function obtainFcmToken(): Promise<string | null> {
  const support = getWebPushSupport();
  // Allow permission prompt when status is still "default".
  if (
    support.blockReason &&
    support.blockReason !== "permission_denied" &&
    support.permission !== "default"
  ) {
    devLog.warn("[FCM] web push blocked", support.blockReason);
    return null;
  }
  if (
    support.blockReason === "ios_not_installed" ||
    support.blockReason === "ios_version" ||
    support.blockReason === "unsupported_browser" ||
    support.blockReason === "insecure_context" ||
    support.blockReason === "missing_vapid"
  ) {
    devLog.warn("[FCM] web push blocked", support.blockReason);
    return null;
  }

  const key = vapidKey();
  if (!key) {
    devLog.warn(
      "[FCM] NEXT_PUBLIC_FIREBASE_VAPID_KEY missing — web push disabled"
    );
    return null;
  }

  // Touch config so we fail early if Firebase public env is incomplete.
  try {
    getFirebasePublicEnv();
  } catch (err) {
    devLog.warn("[FCM] Firebase public env incomplete", err);
    return null;
  }

  if (!("Notification" in window)) return null;

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") return null;

  const registration = await getAppServiceWorkerRegistration();
  if (!registration) return null;

  const msg = await getFirebaseMessaging();
  if (!msg) return null;

  try {
    const token = await getToken(msg, {
      vapidKey: key,
      serviceWorkerRegistration: registration,
    });
    return token || null;
  } catch (err) {
    devLog.warn("[FCM] getToken failed", err);
    return null;
  }
}

/**
 * Revoke the current FCM registration for this browser (best-effort).
 */
export async function revokeFcmToken(): Promise<boolean> {
  try {
    const msg = await getFirebaseMessaging();
    if (!msg) return false;
    await deleteToken(msg);
    return true;
  } catch (err) {
    devLog.warn("[FCM] deleteToken failed", err);
    return false;
  }
}

/**
 * Show in-app UI while the tab is focused (FCM does not auto-show then).
 * Uses the shared foreground event bus so banners match existing design.
 * Skips OS Notification to avoid duplicates with the in-app banner / inbox.
 */
export async function subscribeForegroundPush(
  onPayload?: (title: string, body: string, link: string | null) => void
): Promise<() => void> {
  const msg = await getFirebaseMessaging();
  if (!msg) return () => {};

  return onMessage(msg, (payload) => {
    const parsed = parsePayload(payload);
    onPayload?.(parsed.title, parsed.body, parsed.link);

    // Inbox-backed notifies already appear via NotificationBanner — skip duplicate UI.
    const hasInbox = payload.data?.hasInbox === "1";
    if (hasInbox) return;

    emitForegroundPush({
      id: parsed.tag ?? undefined,
      title: parsed.title,
      body: parsed.body,
      link: parsed.link,
      type: parsed.type,
    });
  });
}
