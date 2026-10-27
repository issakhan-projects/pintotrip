"use client";

import { ChevronRight } from "lucide-react";
import { useI18n } from "@/i18n";
import { cx } from "@/lib/utils";
import { BadgeIcon } from "@/features/badges/badgeIcons";
import type { BadgeProgress } from "@/features/badges/evaluate";
import { countEarned } from "@/features/badges/evaluate";

interface BadgesPreviewProps {
  progress: BadgeProgress[];
  onOpen: () => void;
}

export function BadgesPreview({ progress, onOpen }: BadgesPreviewProps) {
  const { t } = useI18n();
  const earned = progress.filter((p) => p.earned);
  const earnedCount = countEarned(progress);
  const preview = (earned.length > 0 ? earned : progress).slice(0, 5);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-border bg-surface-elevated px-4 py-3.5 text-left transition-colors hover:bg-surface"
    >
      <div className="flex -space-x-2">
        {preview.map((item, index) => (
          <span
            key={item.definition.id}
            className={cx(
              "inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-surface-elevated",
              item.earned
                ? "bg-primary-tint text-primary"
                : "bg-surface text-text-muted opacity-70"
            )}
            style={{ zIndex: preview.length - index }}
            aria-hidden
          >
            <BadgeIcon
              name={item.definition.icon}
              className="h-4 w-4"
              strokeWidth={2}
            />
          </span>
        ))}
      </div>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-text">
          {t("badges.title")}
        </span>
        <span className="mt-0.5 block text-xs text-text-secondary">
          {t("badges.progress", {
            earned: earnedCount,
            total: progress.length,
          })}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
    </button>
  );
}
