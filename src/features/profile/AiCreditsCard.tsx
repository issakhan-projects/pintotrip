"use client";

import { useEffect } from "react";
import { Sparkles } from "lucide-react";
import { AnalyticsEvents } from "@/types/analytics";
import { useAnalytics } from "@/hooks/useAnalytics";
import { getPlanDefinition } from "@/features/profile/plans";
import type { SubscriptionPlan } from "@/types/user";

interface AiCreditsCardProps {
  balance: number;
  plan: SubscriptionPlan;
  onUpgrade: () => void;
}

/**
 * Compact AI credits strip — matches profile hero card.
 */
export function AiCreditsCard({ balance, plan, onUpgrade }: AiCreditsCardProps) {
  const { trackEvent } = useAnalytics();
  const definition = getPlanDefinition(plan);
  const allowance = definition.aiCreditsMonthly;

  useEffect(() => {
    trackEvent(AnalyticsEvents.AI_CREDITS_VIEWED, {
      plan: definition.id,
    });
    // Track once when the card mounts on the profile home.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-primary-tint px-3.5 py-3">
      <Sparkles
        className="h-4 w-4 shrink-0 text-primary"
        strokeWidth={2}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium leading-none text-text-secondary">
          AI Credits
        </p>
        <p className="mt-1 text-sm font-semibold tabular-nums text-text">
          {balance}
          <span className="font-medium text-text-secondary">
            {" "}
            / {allowance}
          </span>
        </p>
      </div>
      <button
        type="button"
        onClick={onUpgrade}
        className="shrink-0 rounded-full bg-primary-light/35 px-3.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary-light/50"
      >
        Buy More
      </button>
    </div>
  );
}
