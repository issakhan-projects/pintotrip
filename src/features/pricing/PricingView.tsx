"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Coins, Gift, Loader2 } from "lucide-react";
import { Button, ConfirmModal } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useI18n, type TranslateFn } from "@/i18n";
import { AnalyticsEvents } from "@/types/analytics";
import { AI_CREDIT_COSTS } from "@/types/credits";
import type { SubscriptionPlan } from "@/types/user";
import { isSubscriptionEntitled } from "@/features/profile/plans";
import { cancelPaddleSubscription } from "@/services/functions";
import {
  onCheckoutCompleted,
  openCheckout,
  previewPrices,
  readCheckoutCreditPackId,
} from "@/lib/paddle/client";
import { hasPaddlePublicEnvConfigured } from "@/lib/paddle/env";
import { devLog } from "@/lib/devLog";
import { cx } from "@/lib/utils";
import { formatYearlyCompareAt } from "./paddleMoney";
import {
  CREDIT_PACKS,
  getCreditPack,
  getCreditPackPriceId,
  peekCreditPackPriceId,
  type CreditPack,
  type CreditPackId,
} from "./creditPacks";
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

type PriceEntry = {
  formatted: string;
  /** Lowest-unit total string from Paddle (for compare-at math). */
  total: string;
  currencyCode: string;
};

type PriceMap = Record<string, PriceEntry>;

const TIER_FEATURE_KEYS: Record<TierName, readonly string[]> = {
  free: ["credits", "savePlaces", "viewPlaces", "mapList", "basicInfo"],
  plus: ["credits", "aiIdentify", "cityIntel", "savePlaces", "mapList", "stats"],
  pro: [
    "credits",
    "aiIdentify",
    "cityIntel",
    "highlightedMaps",
    "tripPlanner",
    "searchByName",
    "moreAi",
    "unlimited",
    "stats",
    "priority",
  ],
};

function intlLocale(locale: string): string {
  return locale === "kz" ? "kk" : locale;
}

export function PricingView({ countryCode }: PricingViewProps) {
  const { t, locale } = useI18n();
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
  const [openingPack, setOpeningPack] = useState<CreditPackId | null>(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [cancelWaiting, setCancelWaiting] = useState(false);
  const [cancelDone, setCancelDone] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [fulfillingCredits, setFulfillingCredits] = useState(false);
  const [creditSuccess, setCreditSuccess] = useState<{
    credits: number;
    balance: number;
  } | null>(null);
  const balanceBeforePackRef = useRef(0);
  const pendingPackCreditsRef = useRef(0);

  const configured = hasPaddlePublicEnvConfigured() && tiersHavePriceIds();
  const currentPlan: SubscriptionPlan | null = user
    ? ((profile?.subscription?.plan ?? "free") as SubscriptionPlan)
    : null;
  const subscriptionStatus = (
    profile?.subscription?.status ?? "active"
  ).toLowerCase();
  const paidEntitled = isSubscriptionEntitled(profile?.subscription);
  const cancelAtPeriodEnd = Boolean(
    profile?.subscription?.cancelAtPeriodEnd
  );
  const cancelEffectiveAt = profile?.subscription?.cancelEffectiveAt;

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
        setPricesError(t("pricing.error.paddleNotConfigured"));
        return;
      }

      const priceIds = listConfiguredPriceIds();
      if (priceIds.length === 0) {
        setPricesLoading(false);
        setPricesError(t("pricing.error.missingPriceIds"));
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

        const currencyCode = result.data.currencyCode;
        const next: PriceMap = {};
        for (const item of result.data.details.lineItems) {
          next[item.price.id] = {
            formatted: item.formattedTotals.total,
            total: item.totals.total,
            currencyCode,
          };
        }
        setPricesById(next);
      } catch (error) {
        if (cancelled) return;
        devLog.error("Paddle PricePreview failed", error);
        setPricesError(
          error instanceof Error
            ? error.message
            : t("pricing.error.loadPrices")
        );
      } finally {
        if (!cancelled) setPricesLoading(false);
      }
    }

    void loadPrices();
    return () => {
      cancelled = true;
    };
  }, [countryCode, t]);

  useEffect(() => {
    return onCheckoutCompleted((event) => {
      const packId = readCheckoutCreditPackId(event);
      if (!packId) return;
      try {
        pendingPackCreditsRef.current = getCreditPack(
          packId as CreditPackId
        ).credits;
      } catch {
        pendingPackCreditsRef.current = 0;
      }
      setFulfillingCredits(true);
      setCheckoutError(null);
    });
  }, []);

  const liveBalance = profile?.aiCreditsBalance ?? 0;

  useEffect(() => {
    if (!fulfillingCredits) return;
    const expected = pendingPackCreditsRef.current;
    const previous = balanceBeforePackRef.current;
    if (liveBalance >= previous + Math.max(1, expected)) {
      setCreditSuccess({
        credits: expected || liveBalance - previous,
        balance: liveBalance,
      });
      setFulfillingCredits(false);
      pendingPackCreditsRef.current = 0;
    }
  }, [fulfillingCredits, liveBalance]);

  useEffect(() => {
    if (!fulfillingCredits) return;
    const timeout = window.setTimeout(() => {
      setFulfillingCredits(false);
      setCheckoutError(t("pricing.packs.fulfillError"));
    }, 45_000);
    return () => window.clearTimeout(timeout);
  }, [fulfillingCredits, t]);

  useEffect(() => {
    if (!cancelWaiting) return;
    const canceledOnWebhook =
      cancelAtPeriodEnd ||
      subscriptionStatus === "canceled" ||
      subscriptionStatus === "cancelled";
    if (!canceledOnWebhook) return;
    setCancelWaiting(false);
    setCancelModalOpen(false);
    setCancelDone(true);
  }, [cancelWaiting, cancelAtPeriodEnd, subscriptionStatus]);

  useEffect(() => {
    if (!cancelWaiting) return;
    const timeout = window.setTimeout(() => {
      setCancelWaiting(false);
      setCancelError(t("pricing.cancel.error"));
      setCancelModalOpen(true);
    }, 45_000);
    return () => window.clearTimeout(timeout);
  }, [cancelWaiting, t]);

  async function handleSubscribe(tier: Tier) {
    if (!isPaidTier(tier)) return;

    if (!user?.uid) {
      setCheckoutError(t("pricing.error.signIn"));
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
      devLog.error("Paddle Checkout.open failed", error);
      setCheckoutError(
        error instanceof Error
          ? error.message
          : t("pricing.error.openCheckout")
      );
    } finally {
      setOpeningTier(null);
    }
  }

  async function handleBuyCreditPack(pack: CreditPack) {
    if (!user?.uid) {
      setCheckoutError(t("pricing.error.signInCredits"));
      router.push("/login");
      return;
    }

    setCheckoutError(null);
    setOpeningPack(pack.id);
    balanceBeforePackRef.current = profile?.aiCreditsBalance ?? 0;
    pendingPackCreditsRef.current = pack.credits;
    trackEvent(AnalyticsEvents.UPGRADE_CLICKED, {
      plan: pack.id,
      source: "pricing_credit_pack",
      credits: pack.credits,
    });

    try {
      const priceId = getCreditPackPriceId(pack);
      const email = user.email?.trim();

      await openCheckout({
        items: [{ priceId, quantity: 1 }],
        settings: {
          displayMode: "overlay",
          variant: "one-page",
          theme: "light",
        },
        customData: {
          firebaseUid: user.uid,
          creditPackId: pack.id,
        },
        ...(email ? { customer: { email } } : {}),
      });
    } catch (error) {
      devLog.error("Paddle Checkout.open failed (credit pack)", error);
      setCheckoutError(
        error instanceof Error
          ? error.message
          : t("pricing.error.openCheckout")
      );
    } finally {
      setOpeningPack(null);
    }
  }

  async function handleConfirmCancelSubscription() {
    setCancelError(null);
    setCanceling(true);
    try {
      await cancelPaddleSubscription();
      setCancelWaiting(true);
    } catch (error) {
      devLog.error("Paddle subscription cancel failed", error);
      setCancelError(
        error instanceof Error
          ? error.message
          : t("pricing.cancel.error")
      );
    } finally {
      setCanceling(false);
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
          {t("common.back")}
        </button>

        <header className="mx-auto max-w-2xl text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            {t("pricing.headline")}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary sm:text-base">
            {t("pricing.subhead")}
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
            {t("pricing.plansSr")}
          </h2>
          <div className="grid gap-4 md:grid-cols-3 md:items-stretch">
            {TIERS.map((tier) => {
              const paid = isPaidTier(tier);
              const priceId = peekTierPriceId(tier, billingInterval);
              const priceEntry = paid && priceId ? pricesById[priceId] : null;
              const priceLabel = paid
                ? (priceEntry?.formatted ?? null)
                : t("common.free");
              const monthlyPriceId = peekTierPriceId(tier, "month");
              const monthlyEntry =
                paid && monthlyPriceId ? pricesById[monthlyPriceId] : null;
              const compareAtLabel =
                billingInterval === "year" && monthlyEntry
                  ? formatYearlyCompareAt(
                      monthlyEntry.total,
                      monthlyEntry.currencyCode
                    )
                  : null;
              const isCurrent = currentPlan === tier.name;
              const isActive =
                isCurrent &&
                (tier.name === "free"
                  ? subscriptionStatus === "active" ||
                    subscriptionStatus === "inactive"
                  : paidEntitled &&
                    (subscriptionStatus === "active" ||
                      subscriptionStatus === "past_due"));

              const canCancelCurrent =
                isActive &&
                paid &&
                Boolean(user) &&
                !cancelAtPeriodEnd &&
                subscriptionStatus !== "canceled";

              return (
                <TierCard
                  key={tier.name}
                  tier={tier}
                  interval={billingInterval}
                  priceLabel={priceLabel}
                  compareAtLabel={compareAtLabel}
                  pricesLoading={paid && pricesLoading}
                  isCurrent={isCurrent}
                  isActive={isActive}
                  canCancel={canCancelCurrent}
                  statusLabel={
                    isActive
                      ? t("pricing.active")
                      : isCurrent
                        ? formatStatusLabel(t, subscriptionStatus)
                        : null
                  }
                  subscribeDisabled={
                    isActive ||
                    (paid && (!configured || pricesLoading || !priceLabel))
                  }
                  opening={openingTier === tier.name}
                  signedIn={Boolean(user)}
                  onSubscribe={() => void handleSubscribe(tier)}
                  onCancelSubscription={() => {
                    setCancelError(null);
                    setCancelModalOpen(true);
                  }}
                />
              );
            })}
          </div>
        </section>

        <CreditPacksSection
          pricesById={pricesById}
          pricesLoading={pricesLoading}
          configured={configured}
          signedIn={Boolean(user)}
          openingPack={openingPack}
          onBuy={(pack) => void handleBuyCreditPack(pack)}
        />

        <HowCreditsWork />
        <FaqSection />
      </div>
      <ConfirmModal
        open={cancelModalOpen}
        title={t("pricing.cancel.title")}
        description={
          <div className="space-y-2">
            <p>
              {formatCancelDescription(
                t,
                locale,
                profile?.subscription?.currentPeriodEnd
              )}
            </p>
            {cancelError ? (
              <p role="alert" className="text-error">
                {cancelError}
              </p>
            ) : null}
          </div>
        }
        confirmLabel={t("pricing.cancel.confirm")}
        cancelLabel={t("pricing.cancel.keep")}
        tone="danger"
        loading={canceling || cancelWaiting}
        onCancel={() => {
          if (!canceling && !cancelWaiting) setCancelModalOpen(false);
        }}
        onConfirm={() => void handleConfirmCancelSubscription()}
      />
      <ConfirmModal
        open={cancelDone}
        title={t("pricing.cancel.doneTitle")}
        description={formatCancelDoneDescription(t, locale, cancelEffectiveAt)}
        confirmLabel={t("pricing.cancel.done")}
        showCancel={false}
        onConfirm={() => setCancelDone(false)}
        onCancel={() => setCancelDone(false)}
      />
      <ConfirmModal
        open={fulfillingCredits}
        title={t("pricing.packs.fulfillTitle")}
        description={t("pricing.packs.fulfillWait")}
        confirmLabel={t("pricing.packs.successDone")}
        showCancel={false}
        loading
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
      <ConfirmModal
        open={Boolean(creditSuccess) && !fulfillingCredits}
        title={t("pricing.packs.successTitle")}
        description={
          creditSuccess
            ? t("pricing.packs.successBody", {
                n: creditSuccess.credits.toLocaleString(intlLocale(locale)),
                balance: creditSuccess.balance.toLocaleString(
                  intlLocale(locale)
                ),
              })
            : undefined
        }
        confirmLabel={t("pricing.packs.successDone")}
        showCancel={false}
        onConfirm={() => setCreditSuccess(null)}
        onCancel={() => setCreditSuccess(null)}
      />
    </main>
  );
}

function CreditPacksSection({
  pricesById,
  pricesLoading,
  configured,
  signedIn,
  openingPack,
  onBuy,
}: {
  pricesById: PriceMap;
  pricesLoading: boolean;
  configured: boolean;
  signedIn: boolean;
  openingPack: CreditPackId | null;
  onBuy: (pack: CreditPack) => void;
}) {
  const { t, locale } = useI18n();
  const numberLocale = intlLocale(locale);

  return (
    <section
      id="credit-packs"
      aria-labelledby="credit-packs-heading"
      className="mt-16"
    >
      <header className="mx-auto max-w-2xl text-center">
        <h2
          id="credit-packs-heading"
          className="text-xl font-semibold text-text sm:text-2xl"
        >
          {t("pricing.packs.heading")}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-text-secondary sm:text-base">
          {t("pricing.packs.intro")}
        </p>
      </header>

      <div className="mx-auto mt-8 grid max-w-3xl gap-4 sm:grid-cols-2 sm:items-stretch">
        {CREDIT_PACKS.map((pack) => {
          const priceId = peekCreditPackPriceId(pack);
          const priceEntry = priceId ? pricesById[priceId] : null;
          const priceLabel = priceEntry?.formatted ?? pack.fallbackUsd;
          const previewReady = Boolean(priceId && priceEntry);
          const buyDisabled =
            !configured ||
            !priceId ||
            pricesLoading ||
            openingPack !== null;

          return (
            <article
              key={pack.id}
              className="flex flex-col rounded-2xl border border-border bg-surface-elevated px-5 py-6 text-left"
            >
              <div className="flex items-center gap-2">
                <Coins
                  className="h-5 w-5 text-primary"
                  strokeWidth={2}
                  aria-hidden
                />
                <h3 className="text-lg font-semibold text-text">
                  {t("pricing.packs.creditsLabel", {
                    n: pack.credits.toLocaleString(numberLocale),
                  })}
                </h3>
              </div>

              <div className="mt-3 min-h-[2.5rem]">
                {priceId && pricesLoading ? (
                  <span className="inline-flex items-center gap-2 text-sm text-text-secondary">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    {t("pricing.loadingPrice")}
                  </span>
                ) : (
                  <p className="text-3xl font-semibold tracking-tight text-text">
                    {priceLabel}
                    <span className="text-base font-normal text-text-secondary">
                      {" "}
                      {t("pricing.packs.oneTime")}
                    </span>
                  </p>
                )}
              </div>

              <p className="mt-2 text-sm text-text-secondary">
                {t("pricing.packs.cardIntro")}
              </p>

              <ul className="mt-5 flex-1 space-y-2.5">
                <li className="flex items-start gap-2 text-sm text-text">
                  <Check
                    className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                    aria-hidden
                  />
                  <span>
                    {t("pricing.packs.featureAdded", {
                      n: pack.credits.toLocaleString(numberLocale),
                    })}
                  </span>
                </li>
                <li className="flex items-start gap-2 text-sm text-text">
                  <Check
                    className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                    aria-hidden
                  />
                  <span>{t("pricing.packs.featureKeepPlan")}</span>
                </li>
              </ul>

              {!signedIn ? (
                <Link
                  href="/login"
                  aria-label={t("pricing.packs.buyAria", {
                    n: pack.credits.toLocaleString(numberLocale),
                  })}
                  className={cx(
                    "mt-6 inline-flex h-10 w-full items-center justify-center rounded-xl border px-4 text-sm font-medium transition-all duration-200",
                    "border-primary bg-primary text-white shadow-sm hover:bg-primary-hover",
                    "focus:outline-none focus:ring-2 focus:ring-primary/30"
                  )}
                >
                  {t("pricing.packs.buy")}
                </Link>
              ) : (
                <Button
                  disabled={buyDisabled || openingPack === pack.id}
                  loading={openingPack === pack.id}
                  onClick={() => onBuy(pack)}
                  aria-label={t("pricing.packs.buyAria", {
                    n: pack.credits.toLocaleString(numberLocale),
                  })}
                  className="mt-6 w-full !border-primary !bg-primary !text-white hover:!bg-primary-hover focus-visible:!ring-2 focus-visible:!ring-primary focus-visible:!ring-offset-2"
                >
                  {t("pricing.packs.buy")}
                </Button>
              )}
              {!previewReady && !pricesLoading && priceId ? (
                <p className="mt-2 text-center text-xs text-text-muted">
                  {t("pricing.packs.fallbackPrice")}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function BillingIntervalToggle({
  value,
  onChange,
}: {
  value: BillingInterval;
  onChange: (next: BillingInterval) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="mt-8 flex flex-col items-center gap-2">
      <div
        role="group"
        aria-label={t("pricing.billingPeriodAria")}
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
          {t("common.monthly")}
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
          {t("common.yearly")}
          <span
            className={cx(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              value === "year"
                ? "bg-primary-tint text-primary"
                : "bg-primary/10 text-primary"
            )}
          >
            <Gift className="h-3 w-3" aria-hidden />
            {t("pricing.twoMonthsFree")}
          </span>
        </button>
      </div>
    </div>
  );
}

function formatStatusLabel(t: TranslateFn, status: string): string {
  switch (status) {
    case "past_due":
      return t("pricing.pastDue");
    case "paused":
      return t("pricing.paused");
    case "canceled":
    case "cancelled":
      return t("pricing.canceled");
    case "active":
      return t("pricing.active");
    default:
      return status;
  }
}

function formatPeriodEnd(
  value: { toDate?: () => Date } | Date | null | undefined,
  locale: string
): string | null {
  let date: Date | null = null;
  if (value instanceof Date) {
    date = value;
  } else if (value && typeof value.toDate === "function") {
    try {
      date = value.toDate();
    } catch {
      date = null;
    }
  }
  if (!date || !Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
  }).format(date);
}

function formatCancelDescription(
  t: TranslateFn,
  locale: string,
  periodEnd?: { toDate?: () => Date } | Date | null
): string {
  const date = formatPeriodEnd(periodEnd, locale);
  if (date) return t("pricing.cancel.bodyUntil", { date });
  return t("pricing.cancel.body");
}

function formatCancelDoneDescription(
  t: TranslateFn,
  locale: string,
  periodEnd?: { toDate?: () => Date } | Date | null
): string {
  const date = formatPeriodEnd(periodEnd, locale);
  if (date) return t("pricing.cancel.doneBodyUntil", { date });
  return t("pricing.cancel.doneBody");
}

function TierCard({
  tier,
  interval,
  priceLabel,
  compareAtLabel,
  pricesLoading,
  isCurrent,
  isActive,
  canCancel,
  statusLabel,
  subscribeDisabled,
  opening,
  signedIn,
  onSubscribe,
  onCancelSubscription,
}: {
  tier: Tier;
  interval: BillingInterval;
  priceLabel: string | null;
  compareAtLabel: string | null;
  pricesLoading: boolean;
  isCurrent: boolean;
  isActive: boolean;
  canCancel: boolean;
  statusLabel: string | null;
  subscribeDisabled: boolean;
  opening: boolean;
  signedIn: boolean;
  onSubscribe: () => void;
  onCancelSubscription: () => void;
}) {
  const { t } = useI18n();
  const recommended = Boolean(tier.recommended) && !isCurrent;
  const paid = isPaidTier(tier);
  const periodLabel =
    interval === "year" ? t("pricing.perYear") : t("pricing.perMonth");
  const showCompareAt =
    interval === "year" &&
    Boolean(compareAtLabel) &&
    compareAtLabel !== priceLabel;
  const tierLabel = t(`pricing.tiers.${tier.name}.label`);
  const tierCta = t(`pricing.tiers.${tier.name}.cta`);
  const features = TIER_FEATURE_KEYS[tier.name].map((key) => ({
    key,
    label: t(`pricing.tiers.${tier.name}.features.${key}`),
  }));

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
          {t("common.mostPopular")}
        </span>
      ) : null}

      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold text-text">{tierLabel}</h3>
        {isCurrent ? (
          <span className="rounded-full bg-success-background px-2.5 py-0.5 text-[11px] font-medium text-success">
            {t("common.yourPlan")}
          </span>
        ) : null}
      </div>

      <div className="mt-3 min-h-[2.5rem]">
        {!paid ? (
          <p className="text-3xl font-semibold tracking-tight text-text">
            {t("common.free")}
            <span className="text-base font-normal text-text-secondary">
              {" "}
              {t("pricing.forever")}
            </span>
          </p>
        ) : pricesLoading ? (
          <span className="inline-flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("pricing.loadingPrice")}
          </span>
        ) : priceLabel ? (
          <div>
            <p className="text-3xl font-semibold tracking-tight text-text">
              {priceLabel}
              <span className="text-base font-normal text-text-secondary">
                {" "}
                {periodLabel}
              </span>
            </p>
            {showCompareAt ? (
              <p className="mt-1 text-sm text-text-muted line-through">
                {compareAtLabel}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-text-secondary">
            {t("pricing.priceUnavailable")}
          </p>
        )}
      </div>

      <p className="mt-2 text-sm text-text-secondary">
        {t(`pricing.tiers.${tier.name}.description`)}
      </p>

      <ul className="mt-5 flex-1 space-y-2.5">
        {features.map((feature) => (
          <li
            key={feature.key}
            className="flex items-start gap-2 text-sm text-text"
          >
            <Check
              className="mt-0.5 h-4 w-4 shrink-0 text-primary"
              aria-hidden
            />
            <span>{feature.label}</span>
          </li>
        ))}
      </ul>

      {isActive ? (
        <div className="mt-6">
          <Button
            disabled
            aria-label={t("pricing.currentPlanAria", { label: tierLabel })}
            className="w-full !cursor-not-allowed !border-border !bg-surface !text-text-secondary"
          >
            {t("pricing.currentPlan")}
          </Button>
          {canCancel ? (
            <button
              type="button"
              onClick={onCancelSubscription}
              className="mt-2 w-full text-center text-sm text-text-muted underline-offset-2 transition-colors hover:text-text-secondary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t("pricing.cancel.link")}
            </button>
          ) : null}
        </div>
      ) : !paid ? (
        signedIn ? (
          <Button
            disabled
            className="mt-6 w-full !cursor-not-allowed !border-border !bg-surface !text-text-secondary"
          >
            {t("pricing.included")}
          </Button>
        ) : (
          <Link
            href="/login"
            aria-label={tierCta}
            className={cx(
              "mt-6 inline-flex h-10 w-full items-center justify-center rounded-xl border px-4 text-sm font-medium transition-all duration-200",
              "border-border bg-surface-elevated text-text shadow-sm hover:bg-primary-tint",
              "focus:outline-none focus:ring-2 focus:ring-primary/30"
            )}
          >
            {tierCta}
          </Link>
        )
      ) : (
        <Button
          disabled={subscribeDisabled || opening}
          loading={opening}
          onClick={onSubscribe}
          aria-label={t("pricing.subscribeAria", { label: tierLabel })}
          className={cx(
            "mt-6 w-full !border-primary focus-visible:!ring-2 focus-visible:!ring-primary focus-visible:!ring-offset-2",
            recommended || isCurrent
              ? "!bg-primary hover:!bg-primary-hover !text-white"
              : "!bg-surface-elevated !text-text hover:!bg-primary-tint"
          )}
        >
          {tierCta}
        </Button>
      )}
    </article>
  );
}

function HowCreditsWork() {
  const { t } = useI18n();

  return (
    <section
      aria-labelledby="credits-heading"
      className="mx-auto mt-16 max-w-2xl"
    >
      <h2
        id="credits-heading"
        className="text-center text-xl font-semibold text-text"
      >
        {t("pricing.creditsHeading")}
      </h2>
      <p className="mt-3 text-center text-sm text-text-secondary">
        {t("pricing.creditsIntro")}
      </p>
      <ul className="mt-6 space-y-3 rounded-2xl border border-border bg-surface px-4 py-4">
        <CreditRow
          label={t("pricing.creditRow.findPlace")}
          credits={AI_CREDIT_COSTS.findPlace}
        />
        <CreditRow
          label={t("pricing.creditRow.searchPlaces")}
          credits={AI_CREDIT_COSTS.searchPlaces}
        />
        <CreditRow
          label={t("pricing.creditRow.cityIntelligence")}
          credits={AI_CREDIT_COSTS.getCityIntelligence}
        />
        <CreditRow
          label={t("pricing.creditRow.aroundMe")}
          credits={AI_CREDIT_COSTS.findAroundMe}
        />
        <CreditRow
          label={t("pricing.creditRow.planOrdinary")}
          credits={AI_CREDIT_COSTS.planTrip}
        />
        <CreditRow
          label={t("pricing.creditRow.planAdvanced")}
          credits={AI_CREDIT_COSTS.planTripAdvanced}
        />
        <CreditRow
          label={t("pricing.creditRow.recreateOrdinary")}
          credits={AI_CREDIT_COSTS.planTripRegenerate}
        />
        <CreditRow
          label={t("pricing.creditRow.recreateAdvanced")}
          credits={AI_CREDIT_COSTS.planTripRegenerateAdvanced}
        />
        <CreditRow
          label={t("pricing.creditRow.regenerate")}
          credits={AI_CREDIT_COSTS.regenerate}
        />
        <CreditRow
          label={t("pricing.creditRow.resolveAirports")}
          credits={AI_CREDIT_COSTS.resolveCityAirports}
        />
        <CreditRow
          label={t("pricing.creditRow.shareTripStory")}
          credits={AI_CREDIT_COSTS.shareTripStory}
        />
      </ul>
    </section>
  );
}

function CreditRow({ label, credits }: { label: string; credits: number }) {
  const { t } = useI18n();

  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="text-text">{label}</span>
      <span className="font-medium tabular-nums text-text-secondary">
        {t("pricing.creditsUnit", { n: credits })}
      </span>
    </li>
  );
}

function FaqSection() {
  const { t } = useI18n();
  const faqs = [
    {
      q: t("pricing.faq.currency.q"),
      a: t("pricing.faq.currency.a"),
    },
    {
      q: t("pricing.faq.switchBilling.q"),
      a: t("pricing.faq.switchBilling.a"),
    },
    {
      q: t("pricing.faq.afterPay.q"),
      a: t("pricing.faq.afterPay.a"),
    },
    {
      q: t("pricing.faq.whatAreCredits.q"),
      a: t("pricing.faq.whatAreCredits.a"),
    },
    {
      q: t("pricing.faq.buyCredits.q"),
      a: t("pricing.faq.buyCredits.a"),
    },
  ];

  return (
    <section aria-labelledby="faq-heading" className="mx-auto mt-16 max-w-2xl">
      <h2
        id="faq-heading"
        className="text-center text-xl font-semibold text-text"
      >
        {t("pricing.faq.title")}
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
