/**
 * Soft prompt to enable FCM web push after the user opens the installed PWA.
 */

import { getDevicePushPreference } from "@/lib/push/devicePreference";
import { getWebPushSupport, isInstalledPwa } from "@/lib/push/support";

export const PWA_PUSH_PROMPT_DISMISS_KEY = "pintotrip.pwaPush.dismissed";

/** Re-show the prompt after this many days if the user dismissed it. */
export const PWA_PUSH_PROMPT_DISMISS_DAYS = 14;

export function readPushPromptDismissed(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(PWA_PUSH_PROMPT_DISMISS_KEY);
    if (!raw) return false;
    const dismissedAt = Number(raw);
    if (!Number.isFinite(dismissedAt)) return true;
    const ttlMs = PWA_PUSH_PROMPT_DISMISS_DAYS * 24 * 60 * 60 * 1000;
    return Date.now() - dismissedAt < ttlMs;
  } catch {
    return false;
  }
}

export function writePushPromptDismissed(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PWA_PUSH_PROMPT_DISMISS_KEY, String(Date.now()));
  } catch {
    // Ignore quota / private mode failures.
  }
}

export function clearPushPromptDismissed(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PWA_PUSH_PROMPT_DISMISS_KEY);
  } catch {
    // ignore
  }
}

/**
 * Whether the installed-PWA push enable sheet may appear.
 * Requires a signed-in user at the call site (token save needs uid).
 */
export function canOfferPwaPushPrompt(): boolean {
  if (typeof window === "undefined") return false;
  if (!isInstalledPwa()) return false;
  if (readPushPromptDismissed()) return false;
  // User explicitly turned push off in Settings on this device.
  if (getDevicePushPreference() === false) return false;

  const support = getWebPushSupport();
  if (!support.canAttempt) return false;
  if (support.permission === "granted") {
    // Already permitted — PushNotifications will auto-register; no soft ask.
    return false;
  }
  if (support.permission === "denied") return false;
  return true;
}
