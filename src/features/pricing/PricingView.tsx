"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Gift, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useAnalytics } from "@/hooks/useAnalytics";
import { AnalyticsEvents } from "@/types/analytics";
import { AI_CREDIT_COSTS } from "@/types/credits";
import type { SubscriptionPlan } from "@/types/user";
import { isSubscriptionEntitled } from "@/features/profile/plans";
import { openCheckout, previewPrices } from "@/lib/paddle/client";
import { hasPaddlePublicEnvConfigured } from "@/lib/paddle/env";
import { cx } from "@/lib/utils";
import {
  TIERS,
  getTierPriceId,
  isPaidTier,
  listConfiguredPriceIds,
  peekTierPriceId,
  tiersHavePriceIds,
  type BillingInterval,
  type Tier,
  type TierName,
} from "./tiers";

export interface PricingViewProps {
  /**
   * ISO country from request headers (e.g. x-vercel-ip-country).
   * Omit / undefined → Paddle PricePreview auto-detects from visitor IP.
   */
  countryCode?: string;
}

type PriceMap = Record<string, string>;

export function PricingView({ countryCode }: PricingViewProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { profile } = useUserProfile(user);
  const { trackEvent } = useAnalytics();
  const [billingInterval, setBillingInterval] =
    useState<BillingInterval>("month");
  const [pricesById, setPricesById] = useState<PriceMap>({});
  const [pricesLoading, setPricesLoading] = useState(true);
  const [pricesError, setPricesError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [openingTier, setOpeningTier] = useState<TierName | null>(null);

  const configured = hasPaddlePublicEnvConfigured() && tiersHavePriceIds();
  const currentPlan: SubscriptionPlan | null = user
    ? ((profile?.subscription?.plan ?? "free") as SubscriptionPlan)
    : null;
  const subscriptionStatus = (
    profile?.subscription?.status ?? "active"
  ).toLowerCase();
  const paidEntitled = isSubscriptionEntitled(profile?.subscription);

  useEffect(() => {
    trackEvent(AnalyticsEvents.PRICING_PAGE_VIEWED, {
      authenticated: Boolean(user),
      countryCode: countryCode ?? null,
    });
    // Intentionally once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPrices() {
      if (!hasPaddlePublicEnvConfigured()) {
        setPricesLoading(false);
        setPricesError(
          "Paddle is not configured. Set NEXT_PUBLIC_PADDLE_CLIENT_TOKEN_SANDBOX and NEXT_PUBLIC_PADDLE_CLIENT_TOKEN_LIVE."
        );
        return;
      }

      const priceIds = listConfiguredPriceIds();
      if (priceIds.length === 0) {
        setPricesLoading(false);
        setPricesError(
          "Add Paddle price IDs for Plus and Pro in src/features/pricing/tiers.ts."
        );
        return;
      }

      setPricesLoading(true);
      setPricesError(null);

      try {
        const request = {
          items: priceIds.map((priceId) => ({ priceId, quantity: 1 })),
          ...(countryCode
            ? { address: { countryCode } }
            : {}),
        };

        const result = await previewPrices(request);
        if (cancelled) return;

        const next: PriceMap = {};
        for (const item of result.data.details.lineItems) {
          // Display Paddle's formatted string only — no frontend price math / re-format.
          next[item.price.id] = item.formattedTotals.total;
        }
        setPricesById(next);
      } catch (error) {
        if (cancelled) return;
        console.error("Paddle PricePreview failed", error);
        setPricesError(
          error instanceof Error
            ? error.message
            : "Could not load localized prices from Paddle."
        );
      } finally {
        if (!cancelled) setPricesLoading(false);
      }
    }

    void loadPrices();
    return () => {
      cancelled = true;
    };
  }, [countryCode]);

  async function handleSubscribe(tier: Tier) {
    if (!isPaidTier(tier)) return;

    if (!user?.uid) {
      setCheckoutError("Sign in to subscribe so we can link your purchase.");
      router.push("/login");
      return;
    }

    if (currentPlan === tier.name && (paidEntitled || tier.name === "free")) {
      return;
    }

    setCheckoutError(null);
    setOpeningTier(tier.name);
    trackEvent(AnalyticsEvents.UPGRADE_CLICKED, {
      plan: tier.name,
      source: "pricing_page",
      interval: billingInterval,
    });

    try {
      const priceId = getTierPriceId(tier, billingInterval);
      const successUrl = `${window.location.origin}/welcome`;
      const email = user.email?.trim();

      await openCheckout({
        items: [{ priceId, quantity: 1 }],
        settings: {
          displayMode: "overlay",
          variant: "one-page",
          successUrl,
          theme: "light",
        },
        customData: {
          firebaseUid: user.uid,
        },
        ...(email ? { customer: { email } } : {}),
      });
    } catch (error) {
      console.error("Paddle Checkout.open failed", error);
      setCheckoutError(
        error instanceof Error
          ? error.message
          : "Could not open Paddle Checkout."
      );
    } finally {
      setOpeningTier(null);
    }
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
            Country-localized prices from Paddle. Subscribe securely with
            overlay checkout.
          </p>
        </header>

        <BillingIntervalToggle
          value={billingInterval}
          onChange={setBillingInterval}
        />

        {pricesError ? (
          <p
            role="alert"
            className="mx-auto mt-6 max-w-xl rounded-2xl border border-error/30 bg-error-background px-4 py-3 text-center text-sm text-error"
          >
            {pricesError}
          </p>
        ) : null}

        {checkoutError ? (
          <p
            role="alert"
            className="mx-auto mt-4 max-w-xl rounded-2xl border border-error/30 bg-error-background px-4 py-3 text-center text-sm text-error"
          >
            {checkoutError}
          </p>
        ) : null}

        <section aria-labelledby="pricing-plans-heading" className="mt-10">
          <h2 id="pricing-plans-heading" className="sr-only">
            Pricing plans
          </h2>
          <div className="grid gap-4 md:grid-cols-3 md:items-stretch">
            {TIERS.map((tier) => {
              const paid = isPaidTier(tier);
              const priceId = peekTierPriceId(tier, billingInterval);
              const priceLabel = paid
                ? priceId
                  ? (pricesById[priceId] ?? null)
                  : null
                : "Free";
              const isCurrent = currentPlan === tier.name;
              const isActive =
                isCurrent &&
                (tier.name === "free"
                  ? subscriptionStatus === "active" ||
                    subscriptionStatus === "inactive"
                  : paidEntitled &&
                    (subscriptionStatus === "active" ||
                      subscriptionStatus === "past_due"));

              return (
                <TierCard
                  key={tier.name}
                  tier={tier}
                  interval={billingInterval}
                  priceLabel={priceLabel}
                  pricesLoading={paid && pricesLoading}
                  isCurrent={isCurrent}
                  isActive={isActive}
                  statusLabel={
                    isActive
                      ? "Active"
                      : isCurrent
                        ? formatStatusLabel(subscriptionStatus)
                        : null
                  }
                  subscribeDisabled={
                    isActive ||
                    (paid && (!configured || pricesLoading || !priceLabel))
                  }
                  opening={openingTier === tier.name}
                  signedIn={Boolean(user)}
                  onSubscribe={() => void handleSubscribe(tier)}
                />
              );
            })}
          </div>
        </section>

        <HowCreditsWork />
        <FaqSection />
      </div>
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
            "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            value === "year"
              ? "bg-white text-text shadow-sm"
              : "text-text-secondary hover:text-text"
          )}
        >
          Yearly
          <span
            className={cx(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              value === "year"
                ? "bg-primary-tint text-primary"
                : "bg-primary/10 text-primary"
            )}
          >
            <Gift className="h-3 w-3" aria-hidden />
            2 mo free
          </span>
        </button>
      </div>
    </div>
  );
}

function formatStatusLabel(status: string): string {
  switch (status) {
    case "past_due":
      return "Past due";
    case "paused":
      return "Paused";
    case "canceled":
      return "Canceled";
    case "active":
      return "Active";
    default:
      return status;
  }
}

function TierCard({
  tier,
  interval,
  priceLabel,
  pricesLoading,
  isCurrent,
  isActive,
  statusLabel,
  subscribeDisabled,
  opening,
  signedIn,
  onSubscribe,
}: {
  tier: Tier;
  interval: BillingInterval;
  priceLabel: string | null;
  pricesLoading: boolean;
  isCurrent: boolean;
  isActive: boolean;
  statusLabel: string | null;
  subscribeDisabled: boolean;
  opening: boolean;
  signedIn: boolean;
  onSubscribe: () => void;
}) {
  const recommended = Boolean(tier.recommended) && !isCurrent;
  const paid = isPaidTier(tier);
  const periodLabel = interval === "year" ? "/ year" : "/ month";

  return (
    <article
      className={cx(
        "relative flex flex-col rounded-2xl border px-5 py-6 text-left",
        isCurrent
          ? "border-primary bg-primary-tint/40 shadow-md ring-1 ring-primary/20"
          : recommended
            ? "border-primary bg-primary-tint/40 shadow-md ring-1 ring-primary/20"
            : "border-border bg-surface-elevated"
      )}
    >
      {statusLabel ? (
        <span
          className={cx(
            "absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
            isActive
              ? "bg-success text-white"
              : "bg-warning text-white"
          )}
        >
          {statusLabel}
        </span>
      ) : recommended ? (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
          Most Popular
        </span>
      ) : null}

      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold text-text">{tier.label}</h3>
        {isCurrent ? (
          <span className="rounded-full bg-success-background px-2.5 py-0.5 text-[11px] font-medium text-success">
            Your plan
          </span>
        ) : null}
      </div>

      <div className="mt-3 min-h-[2.5rem]">
        {!paid ? (
          <p className="text-3xl font-semibold tracking-tight text-text">
            Free
            <span className="text-base font-normal text-text-secondary">
              {" "}
              forever
            </span>
          </p>
        ) : pricesLoading ? (
          <span className="inline-flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading price…
          </span>
        ) : priceLabel ? (
          <p className="text-3xl font-semibold tracking-tight text-text">
            {priceLabel}
            <span className="text-base font-normal text-text-secondary">
              {" "}
              {periodLabel}
            </span>
          </p>
        ) : (
          <p className="text-sm text-text-secondary">Price unavailable</p>
        )}
      </div>

      <p className="mt-2 text-sm text-text-secondary">{tier.description}</p>

      <ul className="mt-5 flex-1 space-y-2.5">
        {tier.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-text">
            <Check
              className="mt-0.5 h-4 w-4 shrink-0 text-primary"
              aria-hidden
            />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {isActive ? (
        <Button
          disabled
          aria-label={`${tier.label} — current active plan`}
          className="mt-6 w-full !cursor-not-allowed !border-border !bg-surface !text-text-secondary"
        >
          Active
        </Button>
      ) : !paid ? (
        signedIn ? (
          <Button
            disabled
            className="mt-6 w-full !cursor-not-allowed !border-border !bg-surface !text-text-secondary"
          >
            Included
          </Button>
        ) : (
          <Link
            href="/login"
            aria-label={tier.ctaLabel ?? "Get Started"}
            className={cx(
              "mt-6 inline-flex h-10 w-full items-center justify-center rounded-xl border px-4 text-sm font-medium transition-all duration-200",
              "border-border bg-surface-elevated text-text shadow-sm hover:bg-primary-tint",
              "focus:outline-none focus:ring-2 focus:ring-primary/30"
            )}
          >
            {tier.ctaLabel ?? "Get Started"}
          </Link>
        )
      ) : (
        <Button
          disabled={subscribeDisabled || opening}
          loading={opening}
          onClick={onSubscribe}
          aria-label={`Subscribe to ${tier.label}`}
          className={cx(
            "mt-6 w-full !border-primary focus-visible:!ring-2 focus-visible:!ring-primary focus-visible:!ring-offset-2",
            recommended || isCurrent
              ? "!bg-primary hover:!bg-primary-hover !text-white"
              : "!bg-surface-elevated !text-text hover:!bg-primary-tint"
          )}
        >
          {tier.ctaLabel ?? "Subscribe"}
        </Button>
      )}
    </article>
  );
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
        <CreditRow
          label="Recreate trip plan (ordinary)"
          credits={AI_CREDIT_COSTS.planTripRegenerate}
        />
        <CreditRow
          label="Recreate trip plan (advanced)"
          credits={AI_CREDIT_COSTS.planTripRegenerateAdvanced}
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
      q: "What currency will I be charged in?",
      a: "Paddle shows localized prices for your country, including estimated tax where applicable. The amount on the card matches what Checkout collects.",
    },
    {
      q: "Can I switch between monthly and yearly?",
      a: "Yes — use the billing toggle, then Subscribe. Yearly and monthly are separate Paddle prices.",
    },
    {
      q: "What happens after I pay?",
      a: "You’ll be redirected to a welcome page. Access is provisioned once Paddle confirms the payment (webhooks).",
    },
    {
      q: "What are AI credits?",
      a: "AI credits are units used when PinToTrip runs AI features like finding a place from a photo or generating city intelligence.",
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
