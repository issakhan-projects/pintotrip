"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { ArrowLeft, Check, Minus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useAnalytics } from "@/hooks/useAnalytics";
import { AnalyticsEvents } from "@/types/analytics";
import { AI_CREDIT_COSTS } from "@/types/credits";
import {
  PLAN_COMPARISON_ROWS,
  PLAN_DEFINITIONS,
  PLAN_ORDER,
  getEffectiveMonthlyPrice,
  getPlanDefinition,
  getPlanPrice,
  getYearlySavingsPercent,
  type BillingInterval,
  type PlanDefinition,
} from "@/features/profile/plans";
import {
  CheckoutConfirmModal,
  formatCheckoutAmount,
  resolveCheckoutCurrency,
  type CheckoutCurrency,
} from "@/features/pricing";
import type { SubscriptionPlan } from "@/types/user";
import { cx } from "@/lib/utils";

export default function PricingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { profile } = useUserProfile(user);
  const { trackEvent } = useAnalytics();
  const [billingInterval, setBillingInterval] =
    useState<BillingInterval>("month");
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan>("plus");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [displayCurrency, setDisplayCurrency] =
    useState<CheckoutCurrency>("USD");

  const currentPlan: SubscriptionPlan =
    profile?.subscription?.plan ?? "free";
  const selectedDefinition = getPlanDefinition(selectedPlan);

  useEffect(() => {
    setDisplayCurrency(
      resolveCheckoutCurrency(profile?.currency, profile?.country)
    );
  }, [profile?.currency, profile?.country]);

  useEffect(() => {
    trackEvent(AnalyticsEvents.PRICING_PAGE_VIEWED, {
      plan: currentPlan,
      authenticated: Boolean(user),
    });
    // Intentionally once on mount; plan may load shortly after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSelectPlan(plan: SubscriptionPlan) {
    setSelectedPlan(plan);
    trackEvent(AnalyticsEvents.PRICING_PLAN_CLICKED, {
      plan,
      interval: billingInterval,
    });
  }

  function handlePlanCta(plan: SubscriptionPlan) {
    const definition = getPlanDefinition(plan);
    const charge = getPlanPrice(definition, billingInterval);
    const isCurrent = Boolean(user) && currentPlan === plan;

    setSelectedPlan(plan);

    if (plan === "free" || isCurrent || charge <= 0) {
      return;
    }

    trackEvent(AnalyticsEvents.UPGRADE_CLICKED, {
      plan,
      source: "pricing_page",
      interval: billingInterval,
    });
    setConfirmOpen(true);
  }

  return (
    <main className="min-h-screen bg-background" data-theme="light">
      <div className="mx-auto w-full max-w-5xl px-4 pb-20 pt-6 sm:px-6">
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-8 inline-flex items-center gap-2 rounded-full px-2 py-1.5 text-sm text-text-secondary transition-colors hover:bg-surface hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back
        </button>

        <header className="mx-auto max-w-2xl text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            Choose the plan that fits your travel discovery.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary sm:text-base">
            Save the places you discover and use AI to turn travel inspiration
            into real locations.
          </p>
        </header>

        <BillingIntervalToggle
          value={billingInterval}
          onChange={setBillingInterval}
        />

        {/* {!authLoading && user ? (
          <div className="mx-auto mt-8 grid max-w-2xl gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-surface px-4 py-4 text-left">
              <p className="text-xs font-medium uppercase tracking-wide text-primary">
                Current plan
              </p>
              {profileLoading ? (
                <div className="mt-2 h-12 animate-pulse rounded-lg bg-border/60" />
              ) : (
                <>
                  <p className="mt-1 text-lg font-semibold text-text">
                    {currentDefinition.name}
                  </p>
                  <p className="mt-0.5 text-sm text-text-secondary">
                    {formatPlanPrice(currentDefinition, "month")}
                  </p>
                  <p className="mt-2 text-sm text-text-secondary">
                    {currentDefinition.aiCreditsMonthly} AI credits / month
                  </p>
                </>
              )}
            </div>
            <div className="rounded-2xl border border-border bg-surface px-4 py-4 text-left">
              <p className="text-xs font-medium uppercase tracking-wide text-primary">
                Your AI Credits
              </p>
              {profileLoading || balance === undefined ? (
                <div className="mt-2 h-12 animate-pulse rounded-lg bg-border/60" />
              ) : (
                <p className="mt-2 text-lg font-semibold tabular-nums text-text">
                  {balance}{" "}
                  <span className="text-sm font-normal text-text-secondary">
                    credits remaining
                  </span>
                </p>
              )}
            </div>
          </div>
        ) : null} */}

        <section
          aria-labelledby="pricing-plans-heading"
          className="mt-10"
        >
          <h2 id="pricing-plans-heading" className="sr-only">
            Pricing plans
          </h2>
          <div className="grid gap-4 md:grid-cols-3 md:items-stretch">
            {PLAN_ORDER.map((id) => (
              <PlanCard
                key={id}
                plan={PLAN_DEFINITIONS[id]}
                interval={billingInterval}
                currency={displayCurrency}
                isSelected={selectedPlan === id}
                isCurrent={Boolean(user) && currentPlan === id}
                onSelect={() => handleSelectPlan(id)}
                onCta={() => handlePlanCta(id)}
              />
            ))}
          </div>
        </section>

        <ComparisonTable currentPlan={user ? currentPlan : null} />

        <HowCreditsWork />

        <FaqSection />
      </div>

      {selectedPlan !== "free" ? (
        <CheckoutConfirmModal
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          plan={selectedDefinition}
          interval={billingInterval}
          currency={displayCurrency}
          onPay={async () => {
            // UI-only: payment gateway not wired yet.
            await new Promise((r) => setTimeout(r, 1200));
          }}
        />
      ) : null}
    </main>
  );
}

function BillingIntervalToggle({
  value,
  onChange,
}: {
  value: BillingInterval;
  onChange: (next: BillingInterval) => void;
}) {
  return (
    <div className="mt-8 flex flex-col items-center gap-2">
      <div
        role="group"
        aria-label="Billing period"
        className="inline-flex rounded-full border border-border bg-surface p-1"
      >
        <button
          type="button"
          aria-pressed={value === "month"}
          onClick={() => onChange("month")}
          className={cx(
            "rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            value === "month"
              ? "bg-white text-text shadow-sm"
              : "text-text-secondary hover:text-text"
          )}
        >
          Monthly
        </button>
        <button
          type="button"
          aria-pressed={value === "year"}
          onClick={() => onChange("year")}
          className={cx(
            "rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            value === "year"
              ? "bg-white text-text shadow-sm"
              : "text-text-secondary hover:text-text"
          )}
        >
          Yearly
        </button>
      </div>
      {value === "year" ? (
        <p className="text-xs font-medium text-primary">Save ~17% with yearly</p>
      ) : null}
    </div>
  );
}

function PlanCard({
  plan,
  interval,
  currency,
  isSelected,
  isCurrent,
  onSelect,
  onCta,
}: {
  plan: PlanDefinition;
  interval: BillingInterval;
  currency: CheckoutCurrency;
  isSelected: boolean;
  isCurrent: boolean;
  onSelect: () => void;
  onCta: () => void;
}) {
  const recommended = Boolean(plan.recommended);
  const isPro = plan.id === "pro";
  const isFree = plan.priceMonthly === 0;
  const charge = getPlanPrice(plan, interval);
  const displayPrice =
    interval === "year" ? plan.priceYearly : plan.priceMonthly;
  const periodLabel = interval === "year" ? "/ year" : "/ month";
  const effectiveMonthly =
    interval === "year" ? getEffectiveMonthlyPrice(plan) : null;
  const savings = interval === "year" ? getYearlySavingsPercent(plan) : 0;
  const ctaDisabled = isCurrent || (!isFree && charge <= 0);
  const ctaLabel = isCurrent ? "Current plan" : plan.ctaLabel;
  const priceLabel = formatCheckoutAmount(displayPrice, currency);
  const effectiveMonthlyLabel =
    effectiveMonthly !== null
      ? formatCheckoutAmount(effectiveMonthly, currency)
      : null;

  return (
    <article
      aria-current={isSelected ? "true" : undefined}
      onClick={onSelect}
      className={cx(
        "relative flex flex-col rounded-2xl border px-5 py-6 text-left transition-shadow cursor-pointer",
        isSelected && !recommended
          ? "border-primary/50 ring-1 ring-primary/15 shadow-sm"
          : null,
        recommended
          ? "border-primary bg-primary-tint/40 shadow-md ring-1 ring-primary/20"
          : isPro
            ? "border-primary/30 bg-surface"
            : "border-border bg-surface-elevated"
      )}
    >
      {recommended ? (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
          Most Popular
        </span>
      ) : null}

      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold text-text">{plan.name}</h3>
        {isCurrent ? (
          <span className="rounded-full bg-success-background px-2.5 py-0.5 text-[11px] font-medium text-success">
            Current
          </span>
        ) : null}
      </div>

      <p className="mt-3 text-3xl font-semibold tracking-tight text-text">
        {priceLabel}
        <span className="text-base font-normal text-text-secondary">
          {" "}
          {periodLabel}
        </span>
      </p>

      {!isFree && effectiveMonthlyLabel !== null ? (
        <p className="mt-1 text-xs text-text-secondary">
          {effectiveMonthlyLabel} / month billed yearly
          {savings > 0 ? (
            <span className="ml-1 font-medium text-primary">
              · Save {savings}%
            </span>
          ) : null}
        </p>
      ) : (
        <p className="mt-1 text-xs text-transparent select-none" aria-hidden>
          placeholder
        </p>
      )}

      <p className="mt-2 text-sm text-text-secondary">{plan.description}</p>

      <ul className="mt-5 flex-1 space-y-2.5">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-text">
            <Check
              className="mt-0.5 h-4 w-4 shrink-0 text-primary"
              aria-hidden
            />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {isFree && !isCurrent ? (
        <Link
          href="/login"
          onClick={(event) => event.stopPropagation()}
          aria-label={plan.ctaLabel}
          className={cx(
            "mt-6 inline-flex h-10 w-full items-center justify-center rounded-xl border px-4 text-sm font-medium transition-all duration-200",
            "border-border bg-surface-elevated text-text shadow-sm hover:bg-primary-tint",
            "focus:outline-none focus:ring-2 focus:ring-primary/30"
          )}
        >
          {plan.ctaLabel}
        </Link>
      ) : (
        <Button
          disabled={ctaDisabled}
          onClick={(event) => {
            event.stopPropagation();
            onCta();
          }}
          aria-label={
            isCurrent ? `${plan.name} — current plan` : plan.ctaLabel
          }
          className={cx(
            "mt-6 w-full !border-primary focus-visible:!ring-2 focus-visible:!ring-primary focus-visible:!ring-offset-2",
            isCurrent || charge <= 0
              ? "!bg-surface !text-text-secondary !border-border cursor-not-allowed"
              : recommended || isPro
                ? "!bg-primary hover:!bg-primary-hover !text-white"
                : "!bg-surface-elevated !text-text hover:!bg-primary-tint"
          )}
        >
          {ctaLabel}
        </Button>
      )}
    </article>
  );
}

function ComparisonTable({
  currentPlan,
}: {
  currentPlan: SubscriptionPlan | null;
}) {
  return (
    <section aria-labelledby="comparison-heading" className="mt-16">
      <h2
        id="comparison-heading"
        className="text-center text-xl font-semibold text-text"
      >
        Compare plans
      </h2>
      <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th scope="col" className="px-4 py-3 font-medium text-text">
                Feature
              </th>
              {PLAN_ORDER.map((id) => (
                <th
                  key={id}
                  scope="col"
                  className={cx(
                    "px-4 py-3 text-center font-medium",
                    currentPlan === id ? "text-primary" : "text-text"
                  )}
                >
                  {PLAN_DEFINITIONS[id].name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PLAN_COMPARISON_ROWS.map((row) => (
              <tr
                key={row.feature}
                className="border-b border-divider last:border-0"
              >
                <th
                  scope="row"
                  className="px-4 py-3 font-normal text-text-secondary"
                >
                  {row.feature}
                </th>
                {PLAN_ORDER.map((id) => (
                  <td key={id} className="px-4 py-3 text-center text-text">
                    <ComparisonCell value={row[id]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ComparisonCell({
  value,
}: {
  value: boolean | number | string;
}) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="mx-auto h-4 w-4 text-success" aria-label="Included" />
    ) : (
      <Minus className="mx-auto h-4 w-4 text-text-muted" aria-label="Not included" />
    );
  }
  return <span className="tabular-nums">{value}</span>;
}

function HowCreditsWork() {
  return (
    <section
      aria-labelledby="credits-heading"
      className="mx-auto mt-16 max-w-2xl"
    >
      <h2
        id="credits-heading"
        className="text-center text-xl font-semibold text-text"
      >
        How AI Credits Work
      </h2>
      <p className="mt-3 text-center text-sm text-text-secondary">
        AI credits are used when you use AI-powered features. Credits are
        included with your monthly plan.
      </p>
      <ul className="mt-6 space-y-3 rounded-2xl border border-border bg-surface px-4 py-4">
        <CreditRow label="Find a Place" credits={AI_CREDIT_COSTS.findPlace} />
        <CreditRow
          label="City Intelligence"
          credits={AI_CREDIT_COSTS.getCityIntelligence}
        />
        <CreditRow label="Plan my trip" credits={AI_CREDIT_COSTS.planTrip} />
        <CreditRow
          label="Recreate trip plan"
          credits={AI_CREDIT_COSTS.planTripRegenerate}
        />
        <CreditRow label="Regenerate" credits={AI_CREDIT_COSTS.regenerate} />
      </ul>
    </section>
  );
}

function CreditRow({ label, credits }: { label: string; credits: number }) {
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="text-text">{label}</span>
      <span className="font-medium tabular-nums text-text-secondary">
        {credits} credits
      </span>
    </li>
  );
}

function FaqSection() {
  const faqs = [
    {
      q: "What are AI credits?",
      a: "AI credits are units used when PinToTrip runs AI features like finding a place from a photo or generating city intelligence.",
    },
    {
      q: "How are AI credits used?",
      a: "Each AI action has a fixed cost — for example, Find a Place uses 10 credits and City Intelligence uses 5.",
    },
    {
      q: "When do my AI credits reset?",
      a: "Each plan includes a monthly AI credit allowance. Automatic monthly reset and billing are not available in the app yet.",
    },
    {
      q: "Can I change my plan?",
      a: "You can review Free, Plus, and Pro here — billed monthly or yearly. Choose a paid plan to confirm checkout when you're ready to upgrade.",
    },
    {
      q: "What happens if I run out of AI credits?",
      a: "AI features that require credits will be unavailable until you have more credits. Saving places and browsing your map still work.",
    },
  ];

  return (
    <section aria-labelledby="faq-heading" className="mx-auto mt-16 max-w-2xl">
      <h2
        id="faq-heading"
        className="text-center text-xl font-semibold text-text"
      >
        FAQ
      </h2>
      <div className="mt-6 space-y-3">
        {faqs.map((item) => (
          <details
            key={item.q}
            className="group rounded-2xl border border-border bg-surface-elevated px-4 py-3"
          >
            <summary className="cursor-pointer list-none text-sm font-medium text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
              <span className="flex items-center justify-between gap-3">
                {item.q}
                <span className="text-text-muted transition-transform group-open:rotate-45">
                  +
                </span>
              </span>
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
