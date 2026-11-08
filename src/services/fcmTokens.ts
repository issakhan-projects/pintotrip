/**
 * Persist FCM web push tokens under users/{uid}/fcmTokens/{tokenId}.
 * Supports multiple devices per user; each browser upserts its own token doc.
 */

import {
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { getFirestoreDb, FirestorePaths } from "@/lib/firebase/firestore";
import {
  obtainFcmToken,
  revokeFcmToken,
} from "@/lib/firebase/messaging";
import {
  getDevicePushPreference,
  setDevicePushPreference,
} from "@/lib/push/devicePreference";
import { getWebPushSupport } from "@/lib/push/support";
import { devLog } from "@/lib/devLog";

const LAST_TOKEN_KEY = "pintototrip.push.lastToken";

function tokenDocId(token: string): string {
  // Firestore-safe id from the token (tokens are URL-safe-ish but may include `:`)
  if (typeof btoa === "function") {
    return btoa(token)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "")
      .slice(0, 700);
  }
  return token.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 700);
}

function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) {
      window.localStorage.setItem(LAST_TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(LAST_TOKEN_KEY);
    }
  } catch {
    // ignore
  }
}

function detectPlatform(): "web" | "ios-pwa" | "android-pwa" {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent;
  const support = getWebPushSupport();
  if (support.isIos && support.isInstalledPwa) return "ios-pwa";
  if (/Android/i.test(ua) && support.isInstalledPwa) return "android-pwa";
  return "web";
}

/**
 * Ask for permission (if needed), get an FCM token, and save it for the user.
 * Safe to call repeatedly — upserts the same token doc. Handles token refresh
 * by deleting the previous token doc when the FCM token string changes.
 */
export async function enableWebPush(userId: string): Promise<boolean> {
  try {
    const token = await obtainFcmToken();
    if (!token) return false;

    const previous = readStoredToken();
    const id = tokenDocId(token);
    const payload: Record<string, unknown> = {
      token,
      platform: detectPlatform(),
      userAgent:
        typeof navigator !== "undefined"
          ? navigator.userAgent.slice(0, 300)
          : "",
      updatedAt: serverTimestamp(),
    };
    if (!previous || previous !== token) {
      payload.createdAt = serverTimestamp();
    }
    await setDoc(
      doc(getFirestoreDb(), FirestorePaths.fcmToken(userId, id)),
      payload,
      { merge: true }
    );

    // Token rotated — drop the old Firestore doc so stale devices don't linger.
    if (previous && previous !== token) {
      try {
        await deleteDoc(
          doc(
            getFirestoreDb(),
            FirestorePaths.fcmToken(userId, tokenDocId(previous))
          )
        );
      } catch (err) {
        devLog.warn("[FCM] failed to remove rotated token doc", err);
      }
    }

    writeStoredToken(token);
    setDevicePushPreference(true);
    return true;
  } catch (err) {
    devLog.warn("[FCM] enableWebPush failed", err);
    return false;
  }
}

/**
 * Opt this device out: revoke FCM token and delete the Firestore doc.
 */
export async function disableWebPush(userId: string): Promise<void> {
  const token = readStoredToken();
  setDevicePushPreference(false);

  try {
    await revokeFcmToken();
  } catch (err) {
    devLog.warn("[FCM] revoke during disable failed", err);
  }

  if (token) {
    try {
      await removeWebPushToken(userId, token);
    } catch (err) {
      devLog.warn("[FCM] remove token doc during disable failed", err);
    }
  }

  writeStoredToken(null);
}

export async function removeWebPushToken(
  userId: string,
  token: string
): Promise<void> {
  const id = tokenDocId(token);
  await deleteDoc(
    doc(getFirestoreDb(), FirestorePaths.fcmToken(userId, id))
  );
}

/**
 * Whether this device should auto-register push (permission already granted
 * and user has not explicitly opted out on this device).
 */
export function shouldAutoRegisterPush(): boolean {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window)) return false;
  if (Notification.permission !== "granted") return false;
  if (getDevicePushPreference() === false) return false;
  const support = getWebPushSupport();
  return support.canAttempt;
}

export function isDevicePushEnabled(): boolean {
  if (getDevicePushPreference() === false) return false;
  if (typeof Notification === "undefined") return false;
  return Notification.permission === "granted" && Boolean(readStoredToken());
}
