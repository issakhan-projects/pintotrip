"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Timestamp } from "firebase/firestore";
import { Button } from "@/components/ui";
import { AnalyticsEvents } from "@/types/analytics";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useI18n } from "@/i18n";
import {
  formatPlanPrice,
  getPlanDefinition,
  isSubscriptionEntitled,
} from "@/features/profile/plans";
import { formatMoney } from "@/features/pricing/paddleMoney";
import { subscribeUserTransactions } from "@/services/transactions";
import type { SubscriptionPlan, UserProfile } from "@/types/user";
import type { SavedBillingTransaction } from "@/types/transaction";
import {
  Calendar,
  Coins,
  CreditCard,
  Crown,
  Receipt,
  Sparkles,
} from "lucide-react";

interface SubscriptionViewProps {
  userId: string;
  profile: UserProfile;
}

function toDate(value?: Timestamp | null): Date | null {
  if (!value || typeof value.toDate !== "function") return null;
  return value.toDate();
}

function formatDate(
  value: Timestamp | Date | null | undefined,
  locale: string
): string | null {
  const date =
    value instanceof Date
      ? value
      : value && typeof value.toDate === "function"
        ? value.toDate()
        : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const bcp47 = locale === "kz" ? "kk" : locale;
  return date.toLocaleDateString(bcp47, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusChip(status: string | undefined): string {
  const s = (status ?? "inactive").toLowerCase();
  if (s === "active") return "bg-success-background text-success";
  if (s === "past_due") return "bg-warning-background text-warning";
  if (s === "canceled" || s === "cancelled") {
    return "bg-error-background text-error";
  }
  return "bg-surface text-text-secondary ring-1 ring-border";
}

function statusKey(status: string | undefined): string {
  const s = (status ?? "inactive").toLowerCase();
  if (s === "active") return "profile.subscription.statusActive";
  if (s === "past_due") return "profile.subscription.statusPastDue";
  if (s === "canceled" || s === "cancelled") {
    return "profile.subscription.statusCanceled";
  }
  if (s === "paused") return "profile.subscription.statusPaused";
  return "profile.subscription.statusInactive";
}

function txnStatusKey(status: SavedBillingTransaction["status"]): string {
  return status === "failed"
    ? "profile.subscription.txnFailed"
    : "profile.subscription.txnSuccess";
}

function periodKey(
  period: SavedBillingTransaction["billingPeriod"]
): string {
  return period === "year"
    ? "profile.subscription.periodYearly"
    : "profile.subscription.periodMonthly";
}

export function SubscriptionView({ userId, profile }: SubscriptionViewProps) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const { trackEvent } = useAnalytics();
  const sub = profile.subscription;
  const plan = (sub?.plan ?? "free") as SubscriptionPlan;
  const current = getPlanDefinition(plan);
  const planName = t(`profile.plans.${plan}.name`);
  const balance = profile.aiCreditsBalance ?? 0;
  const entitled = isSubscriptionEntitled(sub);
  const canManage = plan !== "free" && entitled;
  const [transactions, setTransactions] = useState<SavedBillingTransaction[]>(
    []
  );
  const [transactionsLoading, setTransactionsLoading] = useState(true);
  const [transactionsError, setTransactionsError] = useState<string | null>(
    null
  );

  const periodEnd = formatDate(sub?.currentPeriodEnd, locale);
  const cancelEffective = formatDate(sub?.cancelEffectiveAt, locale);
  const memberSince =
    transactions.length > 0
      ? formatDate(transactions[transactions.length - 1]?.createdAt, locale)
      : null;
  const periodEndDate = toDate(sub?.currentPeriodEnd ?? null);
  const periodEndIsPast =
    periodEndDate != null && periodEndDate.getTime() < Date.now();
  const renewLabel =
    sub?.cancelAtPeriodEnd || periodEndIsPast
      ? t("profile.subscription.accessEnds")
      : t("profile.subscription.renews");

  useEffect(() => {
    setTransactionsLoading(true);
    setTransactionsError(null);
    return subscribeUserTransactions(
      userId,
      (items) => {
        setTransactions(items);
        setTransactionsLoading(false);
      },
      (err) => {
        setTransactionsError(
          err instanceof Error
            ? err.message
            : t("profile.subscription.loadHistoryError")
        );
        setTransactionsLoading(false);
      }
    );
  }, [userId, t]);

  function goPricing() {
    trackEvent(AnalyticsEvents.UPGRADE_CLICKED, {
      plan,
      source: "subscription",
    });
    router.push("/pricing");
  }

  const metaRows: Array<{ label: string; value: string }> = [];
  if (memberSince) {
    metaRows.push({
      label: t("profile.subscription.memberSince"),
      value: memberSince,
    });
  }
  if (periodEnd) {
    metaRows.push({ label: renewLabel, value: periodEnd });
  }
  if (sub?.cancelAtPeriodEnd && cancelEffective) {
    metaRows.push({
      label: t("profile.subscription.cancelsOn"),
      value: cancelEffective,
    });
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-sm">
        <div className="relative bg-gradient-to-br from-primary via-primary to-primary-hover px-5 pb-5 pt-5 text-white">
          <div
            className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-white/10"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -bottom-12 right-8 h-28 w-28 rounded-full bg-primary-light/30"
            aria-hidden
          />

          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
                <Sparkles className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                {t("profile.subscription.currentPlan")}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-semibold tracking-tight">
                  {planName}
                </h2>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusChip(sub?.status)}`}
                >
                  {t(statusKey(sub?.status))}
                </span>
              </div>
              <p className="mt-1 text-sm text-white/75">
                {formatPlanPrice(current)}
              </p>
            </div>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
              <Crown className="h-5 w-5 text-white" strokeWidth={2} aria-hidden />
            </div>
          </div>

          <div className="relative mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-white/10 backdrop-blur-[2px]">
              <p className="flex items-center gap-1 text-[11px] font-medium text-white/65">
                <Coins className="h-3 w-3" strokeWidth={2} aria-hidden />
                {t("profile.subscription.balance")}
              </p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums">
                {balance}
                <span className="ml-1 text-xs font-medium text-white/60">
                  / {current.aiCreditsMonthly}
                </span>
              </p>
            </div>
            <div className="rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-white/10 backdrop-blur-[2px]">
              <p className="flex items-center gap-1 text-[11px] font-medium text-white/65">
                <Calendar className="h-3 w-3" strokeWidth={2} aria-hidden />
                {periodEnd ? renewLabel : t("profile.subscription.billing")}
              </p>
              <p className="mt-0.5 truncate text-lg font-semibold">
                {periodEnd ?? "—"}
              </p>
            </div>
          </div>
        </div>

        {metaRows.length > 0 || sub?.cancelAtPeriodEnd ? (
          <div className="space-y-2 border-b border-border px-5 py-3.5">
            {sub?.cancelAtPeriodEnd ? (
              <p className="rounded-xl bg-warning-background px-3 py-2 text-xs font-medium text-warning">
                {t("profile.subscription.cancelNotice")}
              </p>
            ) : null}
            {metaRows.length > 0 ? (
              <dl className="grid gap-2 sm:grid-cols-2">
                {metaRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2 text-sm"
                  >
                    <dt className="text-text-secondary">{row.label}</dt>
                    <dd className="font-medium text-text">{row.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        ) : null}

        <div className="px-5 py-4">
          {canManage ? (
            <Button
              color="primary"
              icon={CreditCard}
              onClick={goPricing}
              className="w-full !bg-primary hover:!bg-primary-hover !border-primary !text-white"
            >
              {t("profile.subscription.manage")}
            </Button>
          ) : (
            <Button
              color="primary"
              icon={Crown}
              onClick={goPricing}
              className="w-full !bg-primary hover:!bg-primary-hover !border-primary !text-white"
            >
              {t("profile.subscription.upgradePlan")}
            </Button>
          )}
        </div>
      </section>

      {(transactionsLoading ||
        transactions.length > 0 ||
        transactionsError) && (
        <section className="rounded-2xl border border-border bg-surface-elevated px-5 py-4 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-tint text-primary">
              <Receipt className="h-4 w-4" strokeWidth={2} aria-hidden />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text">
                {t("profile.subscription.billingHistory")}
              </h3>
              <p className="text-xs text-text-secondary">
                {transactionsLoading
                  ? t("profile.subscription.loadingPayments")
                  : t(
                      transactions.length === 1
                        ? "profile.subscription.paymentCount_one"
                        : "profile.subscription.paymentCount_other",
                      { count: transactions.length }
                    )}
              </p>
            </div>
          </div>

          {transactionsError ? (
            <p role="alert" className="mt-3 text-sm text-error">
              {transactionsError}
            </p>
          ) : transactionsLoading ? (
            <div className="mt-4 space-y-2">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-xl bg-surface"
                />
              ))}
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {transactions.map((txn) => {
                const date = formatDate(txn.createdAt, locale);
                const amount = formatMoney(txn.amount, txn.currency || "USD");
                const failed = txn.status === "failed";
                const fallbackTitle = `${t(`profile.plans.${txn.planId}.name`)} · ${t(periodKey(txn.billingPeriod))}`;
                return (
                  <li
                    key={txn.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3.5 py-3 transition-colors hover:bg-primary-tint/50"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={
                          failed
                            ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-error-background text-error"
                            : "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success-background text-success"
                        }
                      >
                        <CreditCard
                          className="h-4 w-4"
                          strokeWidth={2}
                          aria-hidden
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-text">
                          {txn.description || fallbackTitle}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-text-secondary">
                          {[
                            date,
                            t(txnStatusKey(txn.status)),
                            t(periodKey(txn.billingPeriod)),
                            txn.promoCode ? txn.promoCode : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                    </div>
                    <p
                      className={
                        failed
                          ? "shrink-0 text-sm font-semibold tabular-nums text-error"
                          : "shrink-0 text-sm font-semibold tabular-nums text-text"
                      }
                    >
                      {amount}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
