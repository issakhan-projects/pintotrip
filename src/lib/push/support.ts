/**
 * Web Push / FCM capability checks, including iOS PWA constraints.
 * iOS Safari only supports Web Push from 16.4+ and only when installed to Home Screen.
 */

import { hasFirebaseVapidConfigured } from "@/lib/env";

export type WebPushBlockReason =
  | "unsupported_browser"
  | "insecure_context"
  | "missing_vapid"
  | "ios_version"
  | "ios_not_installed"
  | "permission_denied";

export type WebPushSupport = {
  /** Browser APIs + VAPID + secure context allow attempting push. */
  canAttempt: boolean;
  /** True when running as an installed PWA (standalone / fullscreen). */
  isInstalledPwa: boolean;
  isIos: boolean;
  iosVersion: number | null;
  permission: NotificationPermission | "unsupported";
  blockReason: WebPushBlockReason | null;
};

function parseIosVersion(ua: string): number | null {
  const match = ua.match(/OS (\d+)[._](\d+)/i);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
  return major + minor / 100;
}

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ may report as Mac; touch points distinguish it.
  const iPadOsDesktopUa =
    /Macintosh/i.test(ua) &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/i.test(ua) || iPadOsDesktopUa;
}

export function isInstalledPwa(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia?.("(display-mode: standalone)");
  if (mq?.matches) return true;
  // iOS Safari legacy
  const nav = navigator as Navigator & { standalone?: boolean };
  return Boolean(nav.standalone);
}

export function getWebPushSupport(): WebPushSupport {
  if (typeof window === "undefined") {
    return {
      canAttempt: false,
      isInstalledPwa: false,
      isIos: false,
      iosVersion: null,
      permission: "unsupported",
      blockReason: "unsupported_browser",
    };
  }

  const isIos = isIosDevice();
  const iosVersion = isIos ? parseIosVersion(navigator.userAgent) : null;
  const installed = isInstalledPwa();
  const permission =
    typeof Notification === "undefined"
      ? ("unsupported" as const)
      : Notification.permission;

  if (!("serviceWorker" in navigator) || typeof Notification === "undefined") {
    return {
      canAttempt: false,
      isInstalledPwa: installed,
      isIos,
      iosVersion,
      permission,
      blockReason: "unsupported_browser",
    };
  }

  if (!window.isSecureContext) {
    return {
      canAttempt: false,
      isInstalledPwa: installed,
      isIos,
      iosVersion,
      permission,
      blockReason: "insecure_context",
    };
  }

  if (!hasFirebaseVapidConfigured()) {
    return {
      canAttempt: false,
      isInstalledPwa: installed,
      isIos,
      iosVersion,
      permission,
      blockReason: "missing_vapid",
    };
  }

  if (isIos) {
    if (iosVersion != null && iosVersion < 16.04) {
      return {
        canAttempt: false,
        isInstalledPwa: installed,
        isIos,
        iosVersion,
        permission,
        blockReason: "ios_version",
      };
    }
    if (!installed) {
      return {
        canAttempt: false,
        isInstalledPwa: installed,
        isIos,
        iosVersion,
        permission,
        blockReason: "ios_not_installed",
      };
    }
  }

  if (permission === "denied") {
    return {
      canAttempt: false,
      isInstalledPwa: installed,
      isIos,
      iosVersion,
      permission,
      blockReason: "permission_denied",
    };
  }

  return {
    canAttempt: true,
    isInstalledPwa: installed,
    isIos,
    iosVersion,
    permission,
    blockReason: null,
  };
}
