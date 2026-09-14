"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { AnalyticsEvents } from "@/types/analytics";
import { useAnalytics } from "@/hooks/useAnalytics";
import {
  PLAN_DEFINITIONS,
  formatPlanPrice,
  getPlanDefinition,
  isSubscriptionEntitled,
} from "@/features/profile/plans";
import { createPaddlePortalSession } from "@/services/functions";
import type { SubscriptionPlan, UserProfile } from "@/types/user";
import { CreditCard } from "lucide-react";

interface SubscriptionViewProps {
  profile: UserProfile;
}

export function SubscriptionView({ profile }: SubscriptionViewProps) {
  const router = useRouter();
  const { trackEvent } = useAnalytics();
  const plan = (profile.subscription?.plan ?? "free") as SubscriptionPlan;
  const current = getPlanDefinition(plan);
  const balance = profile.aiCreditsBalance ?? 0;
  const entitled = isSubscriptionEntitled(profile.subscription);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  function goUpgrade() {
    trackEvent(AnalyticsEvents.UPGRADE_CLICKED, { plan, source: "subscription" });
    router.push("/pricing");
  }

  async function manageSubscription() {
    setPortalError(null);
    setPortalLoading(true);
    try {
      const { url } = await createPaddlePortalSession();
      window.location.assign(url);
    } catch (err) {
      setPortalError(
        err instanceof Error
          ? err.message
          : "Could not open billing portal."
      );
    } finally {
      setPortalLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-surface px-4 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-primary">
          Current plan
        </p>
        <p className="mt-1 text-xl font-semibold text-text">{current.name}</p>
        <p className="mt-1 text-sm text-text-secondary">
          {formatPlanPrice(current)}
        </p>
        {profile.subscription?.status && plan !== "free" ? (
          <p className="mt-1 text-sm text-text-secondary">
            Status:{" "}
            <span className="font-medium text-text">
              {profile.subscription.status}
            </span>
          </p>
        ) : null}
        <p className="mt-3 text-sm text-text-secondary">
          AI credit allowance:{" "}
          <span className="font-medium text-text">
            {current.aiCreditsMonthly}/month
          </span>
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          Current balance:{" "}
          <span className="font-medium tabular-nums text-text">{balance}</span>
        </p>
      </div>

      <div className="space-y-3">
        {(Object.keys(PLAN_DEFINITIONS) as SubscriptionPlan[]).map((id) => {
          const def = PLAN_DEFINITIONS[id];
          const isCurrent = id === plan;
          return (
            <div
              key={id}
              className={
                isCurrent
                  ? "rounded-2xl border border-primary bg-primary-tint/60 px-4 py-4"
                  : "rounded-2xl border border-border bg-surface px-4 py-4"
              }
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold text-text">{def.name}</p>
                <p className="text-sm text-text-secondary">
                  {formatPlanPrice(def)}
                </p>
              </div>
              <p className="mt-1 text-sm text-text-secondary">
                {def.aiCreditsMonthly} AI credits/month
              </p>
              {isCurrent ? (
                <p className="mt-2 text-xs font-medium text-primary">
                  Your plan
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {portalError ? (
        <p role="alert" className="text-sm text-error">
          {portalError}
        </p>
      ) : null}

      {plan === "free" || !entitled ? (
        <Button
          color="primary"
          icon={CreditCard}
          onClick={goUpgrade}
          className="w-full !bg-primary hover:!bg-primary-hover !border-primary !text-white"
        >
          Upgrade to Plus
        </Button>
      ) : (
        <Button
          color="primary"
          icon={CreditCard}
          onClick={() => void manageSubscription()}
          loading={portalLoading}
          disabled={portalLoading}
          className="w-full !bg-primary hover:!bg-primary-hover !border-primary !text-white"
        >
          Manage subscription
        </Button>
      )}
    </div>
  );
}
