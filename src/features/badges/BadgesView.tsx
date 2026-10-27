"use client";

import { useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { useI18n } from "@/i18n";
import { cx } from "@/lib/utils";
import { BadgeIcon } from "@/features/badges/badgeIcons";
import type { BadgeProgress } from "@/features/badges/evaluate";
import { countEarned } from "@/features/badges/evaluate";
import type { BadgeTier } from "@/types/badge";

const TIER_RING: Record<BadgeTier, string> = {
  bronze: "ring-[#C48A4A]/30 bg-[#FBF3EA] text-[#8B5A2B]",
  silver: "ring-border bg-surface text-text-secondary",
  gold: "ring-[#E8C547]/40 bg-[#FFF8E1] text-[#8A6D1A]",
};

const TIER_RING_EARNED: Record<BadgeTier, string> = {
  bronze: "ring-[#C48A4A]/50 bg-[#F3E0C8] text-[#6B3F16]",
  silver: "ring-primary/25 bg-primary-tint text-primary",
  gold: "ring-[#D4AF37]/60 bg-[#FFE9A8] text-[#6B5310]",
};

type Filter = "all" | "earned" | "locked";

interface BadgesViewProps {
  progress: BadgeProgress[];
}

export function BadgesView({ progress }: BadgesViewProps) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const earnedCount = countEarned(progress);
  const total = progress.length;

  const filtered = useMemo(() => {
    if (filter === "earned") return progress.filter((p) => p.earned);
    if (filter === "locked") return progress.filter((p) => !p.earned);
    return progress;
  }, [filter, progress]);

  const selected = progress.find((p) => p.definition.id === selectedId) ?? null;

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-border bg-surface-elevated px-4 py-4">
        <p className="text-sm text-text-secondary">{t("badges.subtitle")}</p>
        <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-text">
          {t("badges.progress", { earned: earnedCount, total })}
        </p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{
              width: `${total === 0 ? 0 : Math.round((earnedCount / total) * 100)}%`,
            }}
          />
        </div>
      </header>

      <div className="flex gap-2">
        {(
          [
            ["all", t("badges.filter.all")],
            ["earned", t("badges.filter.earned")],
            ["locked", t("badges.filter.locked")],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={cx(
              "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
              filter === id
                ? "bg-primary text-white"
                : "bg-surface text-text-secondary hover:bg-surface-elevated hover:text-text"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-secondary">
          {filter === "earned"
            ? t("badges.emptyEarned")
            : t("badges.emptyLocked")}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {filtered.map((item) => {
            const { definition, earned, ratio, current, target } = item;
            const title = t(`badges.items.${definition.id}.title`);
            return (
              <li key={definition.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(definition.id)}
                  className={cx(
                    "flex h-full w-full flex-col items-center gap-2.5 rounded-2xl border px-3 py-4 text-center transition-colors",
                    earned
                      ? "border-border bg-surface-elevated hover:bg-surface"
                      : "border-dashed border-border bg-surface/60 hover:bg-surface"
                  )}
                >
                  <span
                    className={cx(
                      "relative inline-flex h-14 w-14 items-center justify-center rounded-full ring-2",
                      earned
                        ? TIER_RING_EARNED[definition.tier]
                        : TIER_RING[definition.tier],
                      !earned && "opacity-55 grayscale"
                    )}
                    aria-hidden
                  >
                    <BadgeIcon
                      name={definition.icon}
                      className="h-6 w-6"
                      strokeWidth={2}
                    />
                    {!earned ? (
                      <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-surface-elevated text-text-muted shadow-sm ring-1 ring-border">
                        <Lock className="h-3 w-3" strokeWidth={2.5} />
                      </span>
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cx(
                        "block text-sm font-semibold leading-snug",
                        earned ? "text-text" : "text-text-secondary"
                      )}
                    >
                      {title}
                    </span>
                    <span className="mt-1 block text-[11px] tabular-nums text-text-muted">
                      {earned
                        ? t("badges.unlocked")
                        : t("badges.progressShort", {
                            current,
                            target,
                          })}
                    </span>
                  </span>
                  {!earned ? (
                    <span className="mt-auto h-1 w-full overflow-hidden rounded-full bg-divider">
                      <span
                        className="block h-full rounded-full bg-primary/50"
                        style={{ width: `${Math.round(ratio * 100)}%` }}
                      />
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal
          aria-labelledby="badge-detail-title"
          onClick={() => setSelectedId(null)}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-border bg-surface-elevated p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center">
              <span
                className={cx(
                  "inline-flex h-16 w-16 items-center justify-center rounded-full ring-2",
                  selected.earned
                    ? TIER_RING_EARNED[selected.definition.tier]
                    : TIER_RING[selected.definition.tier],
                  !selected.earned && "opacity-60 grayscale"
                )}
              >
                <BadgeIcon
                  name={selected.definition.icon}
                  className="h-7 w-7"
                />
              </span>
              <h3
                id="badge-detail-title"
                className="mt-3 text-lg font-bold text-text"
              >
                {t(`badges.items.${selected.definition.id}.title`)}
              </h3>
              <p className="mt-1.5 text-sm text-text-secondary">
                {t(`badges.items.${selected.definition.id}.description`)}
              </p>
              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-text-muted">
                {t(`badges.tier.${selected.definition.tier}`)}
              </p>
              <p className="mt-3 text-sm tabular-nums text-text">
                {selected.earned
                  ? t("badges.unlocked")
                  : t("badges.progressDetail", {
                      current: selected.current,
                      target: selected.target,
                    })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="mt-5 w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
            >
              {t("badges.close")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
