/**
 * PWA install prompt helpers — early Chromium event capture + dismissal.
 *
 * `beforeinstallprompt` can fire before React mounts the banner, so we stash
 * it at module scope as soon as this file is imported on the client.
 */

import { isInstalledPwa, isIosDevice } from "@/lib/push/support";

export const PWA_INSTALL_DISMISS_KEY = "pintotrip.pwaInstall.dismissed";

/** Re-show the banner after this many days if the user dismissed it. */
export const PWA_INSTALL_DISMISS_DAYS = 14;

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type InstallListener = (event: BeforeInstallPromptEvent | null) => void;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let captureStarted = false;
const listeners = new Set<InstallListener>();

function notify(): void {
  for (const listener of listeners) listener(deferredPrompt);
}

function onBeforeInstallPrompt(event: Event): void {
  event.preventDefault();
  deferredPrompt = event as BeforeInstallPromptEvent;
  notify();
}

function onAppInstalled(): void {
  deferredPrompt = null;
  notify();
}

/** Start listening for Chromium's install event (idempotent). Call ASAP. */
export function startInstallPromptCapture(): void {
  if (typeof window === "undefined" || captureStarted) return;
  captureStarted = true;
  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onAppInstalled);
}

export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

export function subscribeDeferredInstallPrompt(
  listener: InstallListener
): () => void {
  startInstallPromptCapture();
  listeners.add(listener);
  listener(deferredPrompt);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Opens the native browser install dialog (must run from a user gesture).
 * Returns the user's choice, or null if no deferred prompt is available.
 */
export async function promptPwaInstall(): Promise<"accepted" | "dismissed" | null> {
  startInstallPromptCapture();
  const event = deferredPrompt;
  if (!event) return null;

  deferredPrompt = null;
  notify();

  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome;
  } catch {
    return null;
  }
}

export function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 639px)").matches;
}

export function readInstallDismissed(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(PWA_INSTALL_DISMISS_KEY);
    if (!raw) return false;
    const dismissedAt = Number(raw);
    if (!Number.isFinite(dismissedAt)) return true;
    const ttlMs = PWA_INSTALL_DISMISS_DAYS * 24 * 60 * 60 * 1000;
    return Date.now() - dismissedAt < ttlMs;
  } catch {
    return false;
  }
}

export function writeInstallDismissed(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PWA_INSTALL_DISMISS_KEY, String(Date.now()));
  } catch {
    // Ignore quota / private mode failures.
  }
}

export function clearInstallDismissed(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PWA_INSTALL_DISMISS_KEY);
  } catch {
    // ignore
  }
}

/** Whether the soft install banner is allowed to appear on this device/session. */
export function canOfferPwaInstall(): boolean {
  if (typeof window === "undefined") return false;
  if (!isMobileViewport()) return false;
  if (isInstalledPwa()) return false;
  if (readInstallDismissed()) return false;
  return true;
}

export { isIosDevice, isInstalledPwa };
