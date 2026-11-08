"use client";

/**
 * Soft enable-push sheet when the user opens the installed PWA.
 * Explains usefulness (trip ready, referrals) and requests permission.
 */

import { useEffect, useState } from "react";
import { Bell, Check, Gift, Map } from "lucide-react";
import { Button } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { useI18n } from "@/i18n";
import { enableWebPush } from "@/services/fcmTokens";
import {
  canOfferPwaPushPrompt,
  clearPushPromptDismissed,
  writePushPromptDismissed,
} from "@/lib/pwa/pushPrompt";
import { getWebPushSupport } from "@/lib/push/support";
import { devLog } from "@/lib/devLog";

const SHOW_DELAY_MS = 1_800;

interface PwaPushPromptProps {
  userId: string;
}

export function PwaPushPrompt({ userId }: PwaPushPromptProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;

    const delayId = window.setTimeout(() => {
      if (canOfferPwaPushPrompt()) setOpen(true);
    }, SHOW_DELAY_MS);

    return () => window.clearTimeout(delayId);
  }, [userId]);

  function dismiss() {
    writePushPromptDismissed();
    setOpen(false);
    setError(null);
  }

  async function handleEnable() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await enableWebPush(userId);
      if (!ok) {
        const latest = getWebPushSupport();
        if (latest.blockReason === "permission_denied") {
          setError(t("profile.settings.pushPermissionDenied"));
        } else {
          setError(t("app.pwa.push.enableError"));
        }
        return;
      }
      clearPushPromptDismissed();
      setOpen(false);
    } catch (err) {
      devLog.warn("[FCM] PWA push prompt enable failed", err);
      setError(t("app.pwa.push.enableError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={dismiss}
      title={t("app.pwa.push.title")}
      description={t("app.pwa.push.subtitle")}
      leading={
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-tint text-primary">
          <Bell className="h-5 w-5" strokeWidth={2} aria-hidden />
        </span>
      }
      size="md"
      showClose
    >
      <div className="flex min-h-0 flex-col gap-4">
        <p className="text-sm leading-relaxed text-text-secondary">
          {t("app.pwa.push.body")}
        </p>

        <ul className="space-y-2.5">
          <li className="flex gap-3 text-sm text-text-secondary">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
              <Map className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
            </span>
            <span className="pt-1">{t("app.pwa.push.benefitPlan")}</span>
          </li>
          <li className="flex gap-3 text-sm text-text-secondary">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
              <Gift className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
            </span>
            <span className="pt-1">{t("app.pwa.push.benefitReferral")}</span>
          </li>
          <li className="flex gap-3 text-sm text-text-secondary">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
            </span>
            <span className="pt-1">{t("app.pwa.push.benefitUpdates")}</span>
          </li>
        </ul>

        {error ? <p className="text-sm text-error">{error}</p> : null}

        <div className="mt-1 flex shrink-0 flex-col gap-2 pb-1 sm:flex-row-reverse">
          <Button
            type="button"
            variant="primary"
            fullWidth
            loading={busy}
            icon={Bell}
            onClick={() => void handleEnable()}
          >
            {t("app.pwa.push.enable")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            color="neutral"
            fullWidth
            disabled={busy}
            onClick={dismiss}
          >
            {t("app.pwa.push.notNow")}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
