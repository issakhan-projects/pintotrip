"use client";

import {
  useCallback,
  useEffect,
  useId,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  Brain,
  ChevronDown,
  Crown,
  Lock,
  RefreshCw,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { Button, TextInput } from "@/components/ui";
import type { BillingInterval, PlanDefinition } from "@/features/profile/plans";
import { validatePromoCodeOnServer } from "@/services/promo-codes";
import {
  PROMO_ERROR_MESSAGES,
  normalizePromoCode,
  type AppliedPromo,
} from "@/types/promo-code";
import type { SubscriptionPlan } from "@/types/user";
import { cx } from "@/lib/utils";
import {
  addBillingPeriod,
  computeCheckoutTotals,
  formatCheckoutAmount,
  formatCheckoutDate,
  type CheckoutCurrency,
} from "./checkoutTotals";

const PLAN_ICON: Record<
  SubscriptionPlan,
  { Icon: typeof Sparkles; tint: string; iconClass: string }
> = {
  free: {
    Icon: Sparkles,
    tint: "bg-surface",
    iconClass: "text-text-secondary",
  },
  plus: {
    Icon: Zap,
    tint: "bg-primary-tint",
    iconClass: "text-primary",
  },
  pro: {
    Icon: Crown,
    tint: "bg-amber-50",
    iconClass: "text-amber-600",
  },
};

export interface CheckoutConfirmModalProps {
  open: boolean;
  onClose: () => void;
  plan: PlanDefinition;
  interval: BillingInterval;
  currency: CheckoutCurrency;
  /** UI-only pay handler; no payment gateway. */
  onPay?: (payload: {
    planId: SubscriptionPlan;
    interval: BillingInterval;
    total: number;
    promo: AppliedPromo | null;
  }) => void | Promise<void>;
}

export function CheckoutConfirmModal({
  open,
  onClose,
  plan,
  interval,
  currency,
  onPay,
}: CheckoutConfirmModalProps) {
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const [backdropArmed, setBackdropArmed] = useState(false);
  const [paying, setPaying] = useState(false);

  const [promoExpanded, setPromoExpanded] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  const [promoChecking, setPromoChecking] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null);

  const totals = computeCheckoutTotals(plan, interval, appliedPromo);
  const canClose = !paying;
  const canPay = totals.total > 0 && !paying;

  const starts = new Date();
  const ends = addBillingPeriod(starts, interval);
  const billingLabel = interval === "year" ? "Yearly" : "Monthly";
  const { Icon: PlanIcon, tint, iconClass } = PLAN_ICON[plan.id];

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setBackdropArmed(false);
      setPaying(false);
      setPromoExpanded(false);
      setPromoInput("");
      setPromoChecking(false);
      setPromoError(null);
      setAppliedPromo(null);
      return;
    }

    const armId = window.setTimeout(() => setBackdropArmed(true), 120);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.clearTimeout(armId);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const requestClose = useCallback(() => {
    if (!canClose) return;
    onClose();
  }, [canClose, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, requestClose]);

  async function handleApplyPromo() {
    if (appliedPromo || promoChecking) return;
    const code = normalizePromoCode(promoInput);
    if (!code) return;

    setPromoChecking(true);
    setPromoError(null);
    try {
      const result = await validatePromoCodeOnServer(code);
      if (result.ok) {
        setAppliedPromo(result.promo);
        setPromoInput(result.promo.code);
        setPromoExpanded(true);
        setPromoError(null);
      } else {
        setPromoError(PROMO_ERROR_MESSAGES[result.error]);
      }
    } catch {
      setPromoError(PROMO_ERROR_MESSAGES.generic);
    } finally {
      setPromoChecking(false);
    }
  }

  function handleRemovePromo() {
    setAppliedPromo(null);
    setPromoInput("");
    setPromoError(null);
  }

  function handlePromoKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!appliedPromo && promoInput.trim()) {
      void handleApplyPromo();
    }
  }

  async function handlePay(event: FormEvent) {
    event.preventDefault();
    if (!canPay) return;
    setPaying(true);
    try {
      await onPay?.({
        planId: plan.id,
        interval,
        total: totals.total,
        promo: appliedPromo,
      });
    } finally {
      setPaying(false);
    }
  }

  function togglePromoSection() {
    if (appliedPromo) return;
    setPromoExpanded((v) => !v);
  }

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center"
      data-theme="light"
    >
      <button
        type="button"
        aria-label="Dismiss"
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={() => {
          if (backdropArmed) requestClose();
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className={cx(
          "relative z-10 flex w-full flex-col overflow-hidden",
          "rounded-t-2xl border border-border bg-white text-text shadow-xl",
          "max-h-[min(85dvh,640px)] sm:mx-4 sm:max-w-md sm:rounded-2xl"
        )}
      >
        <div
          className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border sm:hidden"
          aria-hidden
        />

        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-divider px-4 py-3">
          <h2 id={titleId} className="text-base font-semibold text-text">
            Confirm your plan
          </h2>
          <button
            type="button"
            aria-label="Close"
            disabled={!canClose}
            onClick={requestClose}
            className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-surface hover:text-text disabled:pointer-events-none disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={handlePay}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {/* Plan summary */}
            <div className="rounded-2xl border border-border bg-surface px-4 py-4">
              <div className="flex items-start gap-3">
                <span
                  className={cx(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                    tint
                  )}
                >
                  <PlanIcon className={cx("h-5 w-5", iconClass)} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-semibold text-text">
                      {plan.name}
                    </p>
                    <span className="rounded-full bg-primary-tint px-2.5 py-0.5 text-[11px] font-medium text-primary">
                      {billingLabel}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-text-secondary">
                    <div>
                      <dt className="font-medium text-text-muted">Starts</dt>
                      <dd className="mt-0.5 text-text">
                        {formatCheckoutDate(starts)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-text-muted">Ends</dt>
                      <dd className="mt-0.5 text-text">
                        {formatCheckoutDate(ends)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              {plan.aiCreditsMonthly > 0 ? (
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-border/80 bg-white px-3 py-2.5">
                  <Brain
                    className="h-4 w-4 shrink-0 text-primary"
                    aria-hidden
                  />
                  <p className="text-sm text-text">
                    <span className="font-semibold tabular-nums">
                      {plan.aiCreditsMonthly}
                    </span>{" "}
                    <span className="text-text-secondary">
                      AI Credits / month
                    </span>
                  </p>
                </div>
              ) : null}
            </div>

            {/* Order summary */}
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-text">Order summary</h3>
              <ul className="mt-3 divide-y divide-divider rounded-2xl border border-border bg-white">
                <SummaryRow
                  label="Subtotal"
                  value={formatCheckoutAmount(totals.subtotal, currency)}
                />

                {interval === "year" && totals.yearlyDiscountAmount > 0 ? (
                  <SummaryRow
                    label={`${totals.yearlyDiscountPercent}% yearly discount`}
                    value={`−${formatCheckoutAmount(totals.yearlyDiscountAmount, currency)}`}
                    valueClassName="text-success"
                  />
                ) : null}

                {appliedPromo && totals.promoDiscountAmount > 0 ? (
                  <SummaryRow
                    label={`Discount · ${appliedPromo.code}`}
                    value={`−${formatCheckoutAmount(totals.promoDiscountAmount, currency)}`}
                    valueClassName="text-success"
                  />
                ) : null}

                {/* Promo collapsible */}
                <li className="px-4 py-3">
                  <button
                    type="button"
                    onClick={togglePromoSection}
                    aria-expanded={promoExpanded || Boolean(appliedPromo)}
                    className={cx(
                      "flex w-full items-center justify-between gap-2 text-left text-sm font-medium text-primary",
                      appliedPromo && "cursor-default"
                    )}
                  >
                    Have a promo code?
                    <ChevronDown
                      className={cx(
                        "h-4 w-4 shrink-0 transition-transform",
                        (promoExpanded || appliedPromo) && "rotate-180"
                      )}
                      aria-hidden
                    />
                  </button>

                  {promoExpanded || appliedPromo ? (
                    <div className="mt-3 space-y-2">
                      <div className="flex gap-2">
                        <TextInput
                          id="checkout-promo-code"
                          value={promoInput}
                          readOnly={Boolean(appliedPromo)}
                          disabled={promoChecking || paying}
                          placeholder="Enter your promo code"
                          autoComplete="off"
                          spellCheck={false}
                          className="flex-1 uppercase tracking-wide"
                          onChange={(e) => {
                            setPromoError(null);
                            setPromoInput(
                              normalizePromoCode(e.target.value)
                            );
                          }}
                          onKeyDown={handlePromoKeyDown}
                        />
                        {appliedPromo ? (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={paying}
                            onClick={handleRemovePromo}
                            className="shrink-0"
                          >
                            Remove
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            disabled={
                              !promoInput.trim() || promoChecking || paying
                            }
                            loading={promoChecking}
                            onClick={() => void handleApplyPromo()}
                            className="shrink-0 !bg-text !text-white hover:!bg-text/90"
                          >
                            {promoChecking ? "Checking…" : "Apply"}
                          </Button>
                        )}
                      </div>
                      {promoError ? (
                        <p
                          role="alert"
                          className="text-xs text-error"
                        >
                          {promoError}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>

                <li className="flex items-center justify-between gap-3 px-4 py-3.5">
                  <span className="text-sm font-semibold text-text">
                    Estimated total
                  </span>
                  <span className="text-lg font-semibold tabular-nums text-text">
                    {formatCheckoutAmount(totals.total, currency)}
                  </span>
                </li>
              </ul>
            </div>

            {/* Trust / notes */}
            <p className="mt-4 text-xs leading-relaxed text-text-secondary">
              Access starts after payment succeeds. You can cancel anytime
              from your account.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-text-secondary">
                <RefreshCw className="h-3 w-3" aria-hidden />
                Cancel anytime
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-text-secondary">
                <Lock className="h-3 w-3" aria-hidden />
                Secure payment
              </span>
            </div>
          </div>

          <div className="shrink-0 border-t border-divider bg-white px-4 py-4">
            <Button
              type="submit"
              disabled={!canPay}
              loading={paying}
              className="w-full !bg-primary hover:!bg-primary-hover !text-white"
            >
              {paying
                ? "Opening payment…"
                : `Pay ${formatCheckoutAmount(totals.total, currency)}`}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

function SummaryRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <span className="text-text-secondary">{label}</span>
      <span className={cx("tabular-nums text-text", valueClassName)}>
        {value}
      </span>
    </li>
  );
}
