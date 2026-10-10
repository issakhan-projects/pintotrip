/**
 * Firebase Cloud Messaging (web push) — permission, token, foreground handler.
 */

import {
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type Messaging,
} from "firebase/messaging";
import { getFirebaseApp } from "./client";
import { getFirebasePublicEnv } from "@/lib/env";
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

/**
 * Request notification permission (if needed) and return an FCM token.
 * Returns null when unsupported, denied, or misconfigured.
 */
export async function obtainFcmToken(): Promise<string | null> {
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
 * Show OS notifications while the tab is focused (FCM does not auto-show then).
 */
export async function subscribeForegroundPush(
  onPayload?: (title: string, body: string, link: string | null) => void
): Promise<() => void> {
  const msg = await getFirebaseMessaging();
  if (!msg) return () => {};

  return onMessage(msg, (payload) => {
    const title =
      payload.notification?.title ||
      payload.data?.title ||
      "PinToTrip";
    const body =
      payload.notification?.body || payload.data?.body || "";
    const link = payload.data?.link || null;

    onPayload?.(title, body, link);

    if (Notification.permission === "granted") {
      try {
        const n = new Notification(title, {
          body,
          icon: "/icon-192.png",
          data: { link },
        });
        n.onclick = () => {
          window.focus();
          if (link) {
            window.location.assign(link);
          }
          n.close();
        };
      } catch (err) {
        // Safari / restricted contexts may throw.
        devLog.warn("[FCM] foreground Notification failed", err);
      }
    }
  });
}
