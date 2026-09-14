"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  markNotificationRead,
  subscribeUnreadNotifications,
  type SavedNotification,
} from "@/services/notifications";

interface NotificationBannerProps {
  userId: string;
  onOpenProfile: () => void;
}

/**
 * Shows the newest unread inbox notification (e.g. referral reward).
 */
export function NotificationBanner({
  userId,
  onOpenProfile,
}: NotificationBannerProps) {
  const [latest, setLatest] = useState<SavedNotification | null>(null);

  useEffect(() => {
    return subscribeUnreadNotifications(
      userId,
      (items) => setLatest(items[0] ?? null),
      (err) => {
        console.error("[NotificationBanner]", err);
        setLatest(null);
      }
    );
  }, [userId]);

  if (!latest) return null;

  async function dismiss() {
    const id = latest!.id;
    setLatest(null);
    try {
      await markNotificationRead(userId, id);
    } catch (err) {
      console.error("[NotificationBanner] mark read failed", err);
    }
  }

  function handleOpen() {
    void dismiss();
    if (latest?.link?.includes("profile") || latest?.type === "referral_reward") {
      onOpenProfile();
    }
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 top-14 z-30 flex justify-center px-4 md:top-16">
      <div
        role="status"
        className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-border bg-surface-elevated p-3.5 shadow-lg"
      >
        <button
          type="button"
          onClick={handleOpen}
          className="min-w-0 flex-1 text-left"
        >
          <p className="text-sm font-semibold text-text">{latest.title}</p>
          <p className="mt-0.5 text-xs leading-snug text-text-secondary">
            {latest.body}
          </p>
        </button>
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={() => void dismiss()}
          className="shrink-0 rounded-lg p-1 text-text-muted hover:bg-surface hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
