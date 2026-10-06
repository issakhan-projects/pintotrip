"use client";

import { useEffect, useMemo } from "react";
import { AlertTriangle, Clock, Coins, Crown } from "lucide-react";
import type { Timestamp } from "firebase/firestore";
import { AnalyticsEvents } from "@/types/analytics";
import { useAnalytics } from "@/hooks/useAnalytics";
import { getPlanDefinition } from "@/features/profile/plans";
import type { SubscriptionPlan } from "@/types/user";

interface AiCreditsCardProps {
  balance: number;
  plan: SubscriptionPlan;
  onUpgrade: () => void;
  /** Billing / allowance period end (Paddle). Falls back to end of calendar month. */
  resetsAt?: Timestamp | Date | null;
}

/** Show the low-credits warning at or below this remaining fraction of the monthly allowance. */
const LOW_CREDITS_RATIO = 0.4;
const WARN_CREDITS_RATIO = 0.7;

type CreditsTone = {
  icon: string;
  bar: string;
  value: string;
};

function creditsTone(ratio: number): CreditsTone {
  if (ratio <= LOW_CREDITS_RATIO) {
    return {
      icon: "text-red-600",
      bar: "bg-red-500",
      value: "text-red-700",
    };
  }
  if (ratio <= WARN_CREDITS_RATIO) {
    return {
      icon: "text-amber-500",
      bar: "bg-amber-400",
      value: "text-amber-700",
    };
  }
  return {
    icon: "text-emerald-600",
    bar: "bg-emerald-500",
    value: "text-text",
  };
}

function daysUntilReset(resetsAt?: Timestamp | Date | null): number {
  let end: Date;
  if (resetsAt && typeof (resetsAt as Timestamp).toDate === "function") {
    end = (resetsAt as Timestamp).toDate();
  } else if (resetsAt instanceof Date) {
    end = resetsAt;
  } else {
    const now = new Date();
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }
  const ms = end.getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/**
 * AI credits card — progress, low-balance warning, and reset / upgrade row.
 */
export function AiCreditsCard({
  balance,
  plan,
  onUpgrade,
  resetsAt,
}: AiCreditsCardProps) {
  const { trackEvent } = useAnalytics();
  const definition = getPlanDefinition(plan);
  const allowance = definition.aiCreditsMonthly;
  const safeBalance = Math.max(0, balance);
  const progressPct =
    allowance > 0
      ? Math.min(100, Math.round((safeBalance / allowance) * 1000) / 10)
      : 0;
  const remainingRatio = allowance > 0 ? safeBalance / allowance : 0;
  const isLow = remainingRatio <= LOW_CREDITS_RATIO;
  const tone = creditsTone(remainingRatio);
  const resetDays = useMemo(() => daysUntilReset(resetsAt), [resetsAt]);
  const resetLabel =
    resetDays === 0
      ? "Resets soon"
      : `Resets in ${resetDays} day${resetDays === 1 ? "" : "s"}`;

  useEffect(() => {
    trackEvent(AnalyticsEvents.AI_CREDITS_VIEWED, {
      plan: definition.id,
    });
    // Track once when the card mounts on the profile home.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-2xl border border-border bg-surface-elevated px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Coins
            className={`h-4 w-4 shrink-0 ${tone.icon}`}
            strokeWidth={2}
            aria-hidden
          />
          <p className="text-sm font-medium text-text">Credits</p>
        </div>
        <span className="inline-flex shrink-0 items-center rounded-lg bg-surface px-2.5 py-1 text-sm tabular-nums">
          <span className={`font-semibold ${tone.value}`}>{safeBalance}</span>
          <span className="font-medium text-text-muted">/{allowance}</span>
        </span>
      </div>

      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-surface"
        role="progressbar"
        aria-valuenow={Math.round(progressPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`AI credits ${safeBalance} of ${allowance}`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${tone.bar}`}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {isLow ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-text-secondary">
          <AlertTriangle
            className="h-4 w-4 shrink-0 text-error"
            strokeWidth={2}
            aria-hidden
          />
          Your credits are running low.
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="inline-flex min-w-0 items-center gap-1.5 text-sm text-text-secondary">
          <Clock
            className="h-3.5 w-3.5 shrink-0 text-text-muted"
            strokeWidth={2}
            aria-hidden
          />
          <span className="truncate">{resetLabel}</span>
        </p>
        <button
          type="button"
          onClick={onUpgrade}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
        >
          <Crown className="h-3 w-3" strokeWidth={2.5} aria-hidden />
          Upgrade Plan
        </button>
      </div>
    </div>
  );
}
