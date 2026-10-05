"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, CheckCheck, X } from "lucide-react";
import { lockBodyScroll } from "@/lib/bodyScrollLock";
import { devLog } from "@/lib/devLog";
import { useI18n } from "@/i18n";
import { cx } from "@/lib/utils";
import {
  markNotificationRead,
  subscribeNotifications,
  type SavedNotification,
} from "@/services/notifications";

function formatNotificationTime(
  createdAt: SavedNotification["createdAt"],
  locale: string
): string {
  const ms =
    typeof createdAt === "number"
      ? createdAt
      : createdAt && typeof createdAt === "object" && "toMillis" in createdAt
        ? createdAt.toMillis()
        : 0;
  if (!ms) return "";
  return new Intl.DateTimeFormat(locale || "en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ms));
}

export function NotificationsModal({
  open,
  userId,
  onClose,
  onOpenLink,
}: {
  open: boolean;
  userId: string;
  onClose: () => void;
  /** Handle in-app deep links (e.g. open profile). */
  onOpenLink?: (link: string | null, type: string) => void;
}) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const [backdropArmed, setBackdropArmed] = useState(false);
  const [items, setItems] = useState<SavedNotification[]>([]);
  const [markingId, setMarkingId] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    return subscribeNotifications(
      userId,
      setItems,
      (err) => {
        devLog.error("[NotificationsModal]", err);
        setItems([]);
      }
    );
  }, [open, userId]);

  useEffect(() => {
    if (!open) {
      setBackdropArmed(false);
      return;
    }
    const armId = window.setTimeout(() => setBackdropArmed(true), 120);
    const unlock = lockBodyScroll();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(armId);
      unlock();
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  async function markRead(id: string) {
    setMarkingId(id);
    try {
      await markNotificationRead(userId, id);
    } catch (err) {
      devLog.error("[NotificationsModal] mark read failed", err);
    } finally {
      setMarkingId(null);
    }
  }

  async function handleItemClick(item: SavedNotification) {
    if (!item.read) {
      await markRead(item.id);
    }
    onOpenLink?.(item.link, item.type);
    onClose();
  }

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label={t("common.close")}
        className="absolute inset-0 bg-text/40"
        onClick={() => {
          if (backdropArmed) onClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className={cx(
          "relative z-10 flex max-h-[min(85vh,36rem)] w-full flex-col overflow-hidden",
          "rounded-t-2xl border border-border bg-surface-elevated shadow-xl sm:max-w-md sm:rounded-2xl"
        )}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3.5">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-base font-semibold tracking-tight text-text"
            >
              {t("app.notifications.title")}
            </h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              {t("app.notifications.subtitle")}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-text-muted hover:bg-surface hover:text-text"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-text-muted">
                <Bell className="h-5 w-5" aria-hidden />
              </span>
              <p className="mt-3 text-sm font-medium text-text">
                {t("app.notifications.emptyTitle")}
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                {t("app.notifications.emptyBody")}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item) => {
                const unread = !item.read;
                const busy = markingId === item.id;
                const timeLabel = formatNotificationTime(
                  item.createdAt,
                  locale
                );
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleItemClick(item)}
                      className={cx(
                        "flex w-full gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface",
                        unread && "bg-primary-tint/40",
                        busy && "opacity-60"
                      )}
                    >
                      <span
                        className={cx(
                          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                          unread ? "bg-primary" : "bg-transparent"
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span
                            className={cx(
                              "text-sm text-text",
                              unread ? "font-semibold" : "font-medium"
                            )}
                          >
                            {item.title}
                          </span>
                          {timeLabel ? (
                            <span className="shrink-0 text-[11px] text-text-muted">
                              {timeLabel}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-text-secondary">
                          {item.body}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {items.some((item) => !item.read) ? (
          <footer className="shrink-0 border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={() => {
                void Promise.all(
                  items
                    .filter((item) => !item.read)
                    .map((item) => markNotificationRead(userId, item.id))
                ).catch((err) => {
                  devLog.error("[NotificationsModal] mark all failed", err);
                });
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface hover:text-text"
            >
              <CheckCheck className="h-4 w-4" aria-hidden />
              {t("app.notifications.markAllRead")}
            </button>
          </footer>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
