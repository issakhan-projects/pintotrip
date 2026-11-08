"use client";

/**
 * In-app banner for FCM messages received while the app is focused.
 * Matches NotificationBanner styling so foreground push uses existing UI.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import {
  subscribeForegroundPushEvents,
  type ForegroundPushEvent,
} from "@/lib/push/events";
import { useI18n } from "@/i18n";

const AUTO_DISMISS_MS = 8_000;

export function ForegroundPushBanner() {
  const { t } = useI18n();
  const router = useRouter();
  const [current, setCurrent] = useState<ForegroundPushEvent | null>(null);

  useEffect(() => {
    return subscribeForegroundPushEvents((event) => {
      setCurrent(event);
    });
  }, []);

  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => {
      setCurrent((prev) => (prev?.id === current.id ? null : prev));
    }, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [current]);

  if (!current) return null;

  function dismiss() {
    setCurrent(null);
  }

  function handleOpen() {
    const link = current?.link;
    dismiss();
    if (!link) return;
    if (/^https?:\/\//i.test(link)) {
      window.location.assign(link);
      return;
    }
    router.push(link.startsWith("/") ? link : `/${link}`);
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-[60] flex justify-center px-4 md:top-16">
      <div
        role="status"
        className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-border bg-surface-elevated p-3.5 shadow-lg"
      >
        <button
          type="button"
          onClick={handleOpen}
          className="min-w-0 flex-1 text-left"
        >
          <p className="text-sm font-semibold text-text">{current.title}</p>
          {current.body ? (
            <p className="mt-0.5 text-xs leading-snug text-text-secondary">
              {current.body}
            </p>
          ) : null}
        </button>
        <button
          type="button"
          aria-label={t("common.dismiss")}
          onClick={dismiss}
          className="shrink-0 rounded-lg p-1 text-text-muted hover:bg-surface hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
