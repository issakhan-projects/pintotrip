"use client";

/**
 * Per-device enable/disable for FCM web push, with iOS Home Screen guidance.
 */

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui";
import { useI18n } from "@/i18n";
import {
  disableWebPush,
  enableWebPush,
  isDevicePushEnabled,
} from "@/services/fcmTokens";
import { getWebPushSupport } from "@/lib/push/support";
import { hasFirebaseVapidConfigured } from "@/lib/env";
import { devLog } from "@/lib/devLog";

interface PushNotificationsToggleProps {
  userId: string;
}

export function PushNotificationsToggle({
  userId,
}: PushNotificationsToggleProps) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [support, setSupport] = useState(() =>
    typeof window === "undefined" ? null : getWebPushSupport()
  );

  useEffect(() => {
    setSupport(getWebPushSupport());
    setEnabled(isDevicePushEnabled());
  }, []);

  const hint = (() => {
    if (!hasFirebaseVapidConfigured()) {
      return t("profile.settings.pushUnavailable");
    }
    if (!support) return t("profile.settings.pushHint");
    switch (support.blockReason) {
      case "ios_not_installed":
        return t("profile.settings.pushIosInstall");
      case "ios_version":
        return t("profile.settings.pushIosVersion");
      case "permission_denied":
        return t("profile.settings.pushPermissionDenied");
      case "unsupported_browser":
      case "insecure_context":
        return t("profile.settings.pushUnavailable");
      case "missing_vapid":
        return t("profile.settings.pushUnavailable");
      default:
        return t("profile.settings.pushHint");
    }
  })();

  // Allow turning off anytime we think this device is enabled; only allow on
  // when the environment can actually register for push.
  const canToggle = enabled
    ? !busy
    : Boolean(support?.canAttempt) && !busy;

  async function handleChange(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (next) {
        const ok = await enableWebPush(userId);
        setSupport(getWebPushSupport());
        if (!ok) {
          const latest = getWebPushSupport();
          if (latest.blockReason === "permission_denied") {
            setError(t("profile.settings.pushPermissionDenied"));
          } else if (latest.blockReason === "ios_not_installed") {
            setError(t("profile.settings.pushIosInstall"));
          } else {
            setError(t("profile.settings.pushEnableError"));
          }
          setEnabled(false);
          return;
        }
        setEnabled(true);
      } else {
        await disableWebPush(userId);
        setEnabled(false);
        setSupport(getWebPushSupport());
      }
    } catch (err) {
      devLog.warn("[FCM] toggle failed", err);
      setError(t("profile.settings.pushEnableError"));
      setEnabled(isDevicePushEnabled());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-3">
        <div>
          <p className="text-sm font-medium text-text">
            {t("profile.settings.pushNotifications")}
          </p>
          <p className="mt-0.5 text-xs text-text-secondary">{hint}</p>
        </div>
        <Switch
          checked={enabled}
          onChange={(checked) => void handleChange(checked)}
          disabled={busy || !canToggle}
          aria-label={t("profile.settings.pushNotifications")}
        />
      </div>
      {error ? <p className="text-sm text-error">{error}</p> : null}
    </div>
  );
}
