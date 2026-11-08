"use client";

/**
 * Mobile-only soft install prompt: Instagram-style banner above BottomNav.
 * Tap "Use the app" → native install dialog when available; iOS gets Add to
 * Home Screen steps (Safari has no programmatic install API).
 */

import { useEffect, useId, useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { useI18n } from "@/i18n";
import {
  canOfferPwaInstall,
  clearInstallDismissed,
  getDeferredInstallPrompt,
  isInstalledPwa,
  isIosDevice,
  isMobileViewport,
  promptPwaInstall,
  startInstallPromptCapture,
  subscribeDeferredInstallPrompt,
  writeInstallDismissed,
} from "@/lib/pwa/installPrompt";

const SHOW_DELAY_MS = 1_200;

export function PwaInstallPrompt() {
  const { t } = useI18n();
  const titleId = useId();
  const [visible, setVisible] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hasDeferred, setHasDeferred] = useState(false);
  const [ios, setIos] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    startInstallPromptCapture();
    if (!canOfferPwaInstall()) return;

    setIos(isIosDevice());
    setHasDeferred(Boolean(getDeferredInstallPrompt()));

    const unsubscribe = subscribeDeferredInstallPrompt((event) => {
      setHasDeferred(Boolean(event));
    });

    const onInstalled = () => {
      setVisible(false);
      setSheetOpen(false);
      clearInstallDismissed();
    };
    window.addEventListener("appinstalled", onInstalled);

    const delayId = window.setTimeout(() => {
      if (!isInstalledPwa() && isMobileViewport() && canOfferPwaInstall()) {
        setVisible(true);
      }
    }, SHOW_DELAY_MS);

    const mq = window.matchMedia("(max-width: 639px)");
    const onViewport = () => {
      if (!mq.matches || isInstalledPwa()) {
        setVisible(false);
        setSheetOpen(false);
      } else if (canOfferPwaInstall()) {
        setVisible(true);
      }
    };
    mq.addEventListener("change", onViewport);

    return () => {
      window.clearTimeout(delayId);
      unsubscribe();
      window.removeEventListener("appinstalled", onInstalled);
      mq.removeEventListener("change", onViewport);
    };
  }, []);

  function dismiss() {
    writeInstallDismissed();
    setVisible(false);
    setSheetOpen(false);
  }

  async function handleUseApp() {
    if (installing) return;

    // Prefer the native install dialog on every non-iOS tap.
    if (!ios || hasDeferred) {
      setInstalling(true);
      try {
        const outcome = await promptPwaInstall();
        if (outcome === "accepted") {
          setVisible(false);
          setSheetOpen(false);
          return;
        }
        // User closed the dialog — leave the banner; don't open a sheet.
        if (outcome === "dismissed") return;
      } finally {
        setInstalling(false);
      }
    }

    // iOS, or Chromium without a deferred prompt yet → manual install steps.
    setSheetOpen(true);
  }

  if (!visible) return null;

  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 z-[29] px-3 sm:hidden"
        style={{
          bottom:
            "calc(4.75rem + max(0.75rem, env(safe-area-inset-bottom)) + 0.35rem)",
        }}
      >
        <div
          role="region"
          aria-labelledby={titleId}
          className="pointer-events-auto relative mx-auto flex w-full max-w-md items-center justify-center rounded-2xl border border-border/70 bg-white/95 px-10 py-2.5 shadow-[0_8px_28px_rgba(66,0,94,0.12)] backdrop-blur-xl"
        >
          <button
            type="button"
            id={titleId}
            disabled={installing}
            onClick={() => void handleUseApp()}
            className="text-sm font-semibold text-primary transition-opacity hover:opacity-80 active:opacity-70 disabled:opacity-60"
          >
            {installing ? t("app.pwa.install") : t("app.pwa.useApp")}
          </button>
          <button
            type="button"
            aria-label={t("common.dismiss")}
            onClick={dismiss}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={t("app.pwa.title")}
        description={t("app.pwa.subtitle")}
        leading={
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-tint text-primary">
            <Download className="h-5 w-5" strokeWidth={2} aria-hidden />
          </span>
        }
        size="sm"
        showClose
      >
        {ios ? (
          <ol className="space-y-3 text-sm text-text-secondary">
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
                <Share className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
              </span>
              <p>
                <span className="font-medium text-text">
                  {t("app.pwa.iosStep1Title")}
                </span>
                <span className="mt-0.5 block">{t("app.pwa.iosStep1Body")}</span>
              </p>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
                <SquarePlus
                  className="h-3.5 w-3.5"
                  strokeWidth={2.5}
                  aria-hidden
                />
              </span>
              <p>
                <span className="font-medium text-text">
                  {t("app.pwa.iosStep2Title")}
                </span>
                <span className="mt-0.5 block">{t("app.pwa.iosStep2Body")}</span>
              </p>
            </li>
          </ol>
        ) : (
          <p className="text-sm leading-relaxed text-text-secondary">
            {t("app.pwa.androidFallbackBody")}
          </p>
        )}
      </Sheet>
    </>
  );
}
