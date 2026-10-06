"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Check, Globe2, Heart, Plane, Star, Users } from "lucide-react";
import {
  PLAN_DEFINITIONS,
  PLAN_ORDER,
  getPlanPrice,
  getYearlyListPrice,
  type BillingInterval,
} from "@/features/profile/plans";
import { useI18n } from "@/i18n";
import type { SubscriptionPlan } from "@/types/user";
import { cx } from "@/lib/utils";

const MOUNTAIN_BG =
  "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=2000&q=80";

const POLAROID_LEFT =
  "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?auto=format&fit=crop&w=600&q=80";

const POLAROID_RIGHT =
  "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=600&q=80";

const FREE_FEATURE_KEYS = [
  { key: "credits", included: true },
  { key: "saveMap", included: true },
  { key: "basicInfo", included: true },
  { key: "devices", included: true },
  { key: "advanced", included: false },
  { key: "support", included: false },
  { key: "early", included: false },
] as const;

const PAID_FEATURE_KEYS = [
  { key: "credits", included: true },
  { key: "unlimited", included: true },
  { key: "insights", included: true },
  { key: "visaBudget", included: true },
  { key: "devices", included: true },
  { key: "support", included: true },
  { key: "early", included: false as boolean },
] as const;

const STAT_ITEMS = [
  { Icon: Users, value: "10,000+", labelKey: "travelers" },
  { Icon: Globe2, value: "180+", labelKey: "countries" },
  { Icon: Star, value: "4.8", labelKey: "rating" },
] as const;

export function PricingSection() {
  const { t } = useI18n();
  const [interval, setInterval] = useState<BillingInterval>("month");

  return (
    <section
      id="pricing"
      className="relative scroll-mt-16 overflow-hidden border-t border-border py-14 sm:py-20"
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <Image
          src={MOUNTAIN_BG}
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-center opacity-[0.22]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-white/85 via-white/70 to-white/90" />
      </div>

      <div
        className="pointer-events-none absolute inset-0 hidden lg:block"
        aria-hidden
      >
        <p className="absolute top-16 left-[4%] max-w-[11rem] -rotate-6 font-[family-name:var(--font-montserrat)] text-sm italic leading-snug text-text-secondary/80">
          {t("landing.pricing.decor.morePlaces")}
          <br />
          {t("landing.pricing.decor.brighter")}
          <span className="mt-1 block h-0.5 w-16 rounded-full bg-primary/50" />
        </p>
        <div className="absolute top-14 right-[3%] flex max-w-[12rem] rotate-3 items-start gap-2">
          <Plane className="mt-0.5 h-4 w-4 text-primary" />
          <p className="text-sm italic leading-snug text-text-secondary/80">
            {t("landing.pricing.decor.ideas")}
          </p>
        </div>

        <div className="absolute bottom-28 left-[2%] w-36 -rotate-6 rounded-md bg-white p-2 shadow-lg">
          <div className="relative aspect-[4/3] overflow-hidden rounded-sm">
            <Image
              src={POLAROID_LEFT}
              alt=""
              fill
              sizes="144px"
              className="object-cover"
            />
          </div>
          <p className="mt-2 flex items-center justify-center gap-1 text-[11px] italic text-text-secondary">
            {t("landing.pricing.decor.moments")}
            <Heart className="h-3 w-3 fill-primary/70 text-primary/70" />
          </p>
        </div>

        <div className="absolute bottom-28 right-[2%] w-36 rotate-6 rounded-md bg-white p-2 shadow-lg">
          <div className="relative aspect-[4/3] overflow-hidden rounded-sm">
            <Image
              src={POLAROID_RIGHT}
              alt=""
              fill
              sizes="144px"
              className="object-cover"
            />
          </div>
          <p className="mt-2 text-center text-[11px] italic text-text-secondary">
            {t("landing.pricing.decor.biggerWorld")}
          </p>
        </div>
      </div>

      <div className="relative mx-auto max-w-5xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            {t("landing.pricing.eyebrow")}
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            {t("landing.pricing.title")}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary sm:text-base">
            {t("landing.pricing.sub")}
          </p>
        </div>

        <BillingToggle value={interval} onChange={setInterval} />

        <div className="mt-10 grid gap-4 md:grid-cols-3 md:items-stretch md:gap-5">
          {PLAN_ORDER.map((id) => (
            <PlanCard key={id} planId={id} interval={interval} />
          ))}
        </div>

        <div className="mt-8 rounded-2xl border border-border/80 bg-white/90 px-4 py-4 shadow-sm backdrop-blur sm:mt-10 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-3 sm:gap-2">
            {STAT_ITEMS.map(({ Icon, value, labelKey }) => (
              <div
                key={labelKey}
                className="flex items-center gap-3 sm:justify-center"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-base font-semibold text-text">{value}</p>
                  <p className="text-xs text-text-secondary">
                    {t(`landing.pricing.stats.${labelKey}`)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function BillingToggle({
  value,
  onChange,
}: {
  value: BillingInterval;
  onChange: (next: BillingInterval) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="mt-7 flex justify-center">
      <div
        role="group"
        aria-label={t("pricing.billingPeriodAria")}
        className="inline-flex items-center rounded-full border border-border bg-surface/90 p-1 shadow-sm"
      >
        <button
          type="button"
          aria-pressed={value === "month"}
          onClick={() => onChange("month")}
          className={cx(
            "rounded-full px-4 py-2 text-sm font-medium transition-colors",
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
            "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
            value === "year"
              ? "bg-white text-text shadow-sm"
              : "text-text-secondary hover:text-text"
          )}
        >
          {t("common.yearly")}
          <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            {t("landing.pricing.twoMonthsFree")}
          </span>
        </button>
      </div>
    </div>
  );
}

function PlanCard({
  planId,
  interval,
}: {
  planId: SubscriptionPlan;
  interval: BillingInterval;
}) {
  const { t } = useI18n();
  const plan = PLAN_DEFINITIONS[planId];
  const recommended = Boolean(plan.recommended);
  const price = getPlanPrice(plan, interval);
  const period =
    interval === "year" ? t("pricing.perYear") : t("pricing.perMonth");
  const isFree = plan.priceMonthly === 0;
  const yearlyListPrice = getYearlyListPrice(plan);
  const showYearlyCompare =
    interval === "year" && !isFree && yearlyListPrice > price;

  const features =
    planId === "free"
      ? FREE_FEATURE_KEYS.map((f) => ({
          label: t(`landing.pricing.planMeta.free.features.${f.key}`),
          included: f.included,
        }))
      : PAID_FEATURE_KEYS.map((f) => ({
          label: t(`landing.pricing.planMeta.${planId}.features.${f.key}`),
          included: planId === "pro" ? true : f.included,
        }));

  return (
    <article
      className={cx(
        "relative flex flex-col rounded-2xl border bg-white px-5 py-6 shadow-sm",
        recommended
          ? "border-primary ring-1 ring-primary/20 shadow-md"
          : "border-border"
      )}
    >
      {recommended ? (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-white">
          {t("common.mostPopular")}
        </span>
      ) : null}

      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xl font-semibold tracking-tight text-text">
          {plan.name}
        </h3>
        <p className="text-xs text-text-secondary">
          {t(`landing.pricing.planMeta.${planId}.tagline`)}
        </p>
      </div>

      <div className="mt-4">
        <p className="text-3xl font-semibold tracking-tight text-text">
          {isFree ? "$0" : `$${price.toFixed(2)}`}
          <span className="text-sm font-normal text-text-secondary">
            {" "}
            {period}
          </span>
        </p>
        {showYearlyCompare ? (
          <p className="mt-1 text-sm text-text-muted line-through">
            ${yearlyListPrice.toFixed(2)}
          </p>
        ) : null}
      </div>

      <p className="mt-2 text-sm leading-relaxed text-text-secondary">
        {t(`landing.pricing.planMeta.${planId}.blurb`)}
      </p>

      <Link
        href="/login"
        className={cx(
          "mt-5 w-full text-center",
          recommended ? "btn-primary" : "btn-secondary"
        )}
      >
        {t("landing.nav.startForFree")}
      </Link>

      <ul className="mt-5 flex-1 space-y-2.5 border-t border-divider pt-5">
        {features.map((feature) => (
          <li key={feature.label} className="flex items-start gap-2.5">
            <Check
              className={cx(
                "mt-0.5 h-4 w-4 shrink-0",
                feature.included ? "text-primary" : "text-text-muted/50"
              )}
              aria-hidden
            />
            <span
              className={cx(
                "text-sm",
                feature.included ? "text-text" : "text-text-muted"
              )}
            >
              {feature.label}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}
