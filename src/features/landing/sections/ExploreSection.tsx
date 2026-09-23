"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CircleDollarSign,
  Coins,
  Landmark,
  Lightbulb,
  Stamp,
} from "lucide-react";
import { useI18n } from "@/i18n";
import { TOKYO_PREVIEW } from "../constants";

const FEATURE_ITEMS = [
  { key: "bestTime", Icon: CalendarDays },
  { key: "dailyBudget", Icon: CircleDollarSign },
  { key: "currency", Icon: Coins },
  { key: "visa", Icon: Stamp },
  { key: "attractions", Icon: Landmark },
  { key: "tips", Icon: Lightbulb },
] as const;

const ATTRACTION_KEYS = ["shibuya", "sensoji", "skytree"] as const;
const TIP_KEYS = ["transport", "apps", "safety", "andMore"] as const;

export function ExploreSection() {
  const { t } = useI18n();

  return (
    <section
      id="explore"
      className="scroll-mt-16 border-t border-border bg-surface py-12 sm:py-16"
    >
      <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.15fr_0.95fr] lg:gap-8 lg:items-start">
        {/* Left copy */}
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text sm:text-3xl">
            {t("landing.explore.title")}
          </h2>
          <p className="mt-2 text-sm text-text-secondary sm:text-base">
            {t("landing.explore.sub")}
          </p>

          <ul className="mt-6 space-y-3">
            {FEATURE_ITEMS.map(({ key, Icon }) => {
              const label = t(`landing.explore.features.${key}`);
              return (
                <li
                  key={key}
                  className="flex items-center gap-3 text-sm text-text-secondary"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-primary shadow-sm ring-1 ring-border">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  {label}
                </li>
              );
            })}
          </ul>

          <Link href="/login" className="btn-secondary mt-7 h-10 gap-2 px-4">
            {t("landing.explore.cta")}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>

        {/* Center imagery */}
        <div>
          <div className="relative aspect-[4/5] overflow-hidden rounded-2xl sm:aspect-[5/6]">
            <Image
              src={TOKYO_PREVIEW.image}
              alt="Tokyo with Mount Fuji"
              fill
              sizes="(max-width: 1024px) 100vw, 40vw"
              className="object-cover"
            />
          </div>
        </div>

        {/* Right info card */}
        <article className="rounded-2xl border border-border bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
            {t("landing.explore.tokyo.country")}
          </p>
          <h3 className="mt-1 text-2xl font-semibold tracking-tight text-text">
            {t("landing.explore.tokyo.city")}
          </h3>

          <dl className="mt-5 space-y-4">
            <InfoRow
              label={t("landing.explore.tokyo.bestTimeLabel")}
              value={t("landing.explore.tokyo.bestTime")}
            />
            <InfoRow
              label={t("landing.explore.tokyo.budgetLabel")}
              value={t("landing.explore.tokyo.budget")}
            />
            <InfoRow
              label={t("landing.explore.tokyo.currencyLabel")}
              value={t("landing.explore.tokyo.currency")}
            />
            <InfoRow
              label={t("landing.explore.tokyo.visaLabel")}
              value={t("landing.explore.tokyo.visa")}
            />
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                {t("landing.explore.tokyo.attractionsLabel")}
              </dt>
              <dd className="mt-1.5 flex flex-wrap gap-1.5">
                {ATTRACTION_KEYS.map((key) => {
                  const item = t(`landing.explore.tokyo.attractions.${key}`);
                  return (
                    <span
                      key={key}
                      className="rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-text"
                    >
                      {item}
                    </span>
                  );
                })}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                {t("landing.explore.tokyo.tipsLabel")}
              </dt>
              <dd className="mt-1 text-sm text-text-secondary">
                {TIP_KEYS.map((key) =>
                  t(`landing.explore.tokyo.tips.${key}`)
                ).join(" · ")}
              </dd>
            </div>
          </dl>
        </article>
      </div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-text">{value}</dd>
    </div>
  );
}
