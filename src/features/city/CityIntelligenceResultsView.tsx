"use client";

import { useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Bus,
  CalendarDays,
  Car,
  Clock,
  Coins,
  CreditCard,
  ExternalLink,
  Globe2,
  Languages,
  Map,
  ShieldCheck,
  Smartphone,
  Sun,
  Thermometer,
  Ticket,
  TrendingUp,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  CITY_INTELLIGENCE_DISCLAIMER,
  type CityIntelligenceDetails,
  type CityIntelligenceResult,
  type UsefulApp,
  type UsefulAppCategory,
} from "@/types/city-intelligence";

export function CityIntelligenceResultsView({
  data,
  citizenship,
  onChangeCitizenship,
  showDisclaimer = true,
}: {
  data: CityIntelligenceResult;
  citizenship: string;
  onChangeCitizenship?: () => void;
  showDisclaimer?: boolean;
}) {
  const [visaExpanded, setVisaExpanded] = useState(false);

  const details = data.details;
  const currencyParts = getCurrencyParts(data, details);
  const bestTimePrimary = formatBestTimePrimary(data, details);
  const bestTimeHint = formatBestTimeHint(data, details);
  const visaSummary = formatVisaSummary(data, details);
  const visaExtra = formatVisaExtra(data, details);
  const climateTemp = formatTemperature(details?.climate?.averageTemperature);
  const hasPractical = Boolean(
    details?.practicalInfo &&
      (details.practicalInfo.transport ||
        details.practicalInfo.walkability ||
        details.practicalInfo.payment ||
        details.practicalInfo.tips?.length)
  );
  const usefulApps = getUsefulApps(data, details);

  return (
    <>
      <div className="space-y-3">
        {/* Personalization banner */}
        <div className="flex items-start gap-3 rounded-2xl bg-sky-50 px-4 py-3.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/80 text-sky-700">
            <Globe2 className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-text">
              Recommendations personalized for{" "}
              <span className="font-semibold">{citizenship} citizenship</span>
            </p>
            <p className="mt-0.5 text-xs text-text-secondary">
              This may affect visa, entry rules and other travel information.
            </p>
          </div>
          {onChangeCitizenship ? (
            <button
              type="button"
              onClick={onChangeCitizenship}
              className="shrink-0 pt-0.5 text-sm font-medium text-sky-700 hover:underline"
            >
              Update ›
            </button>
          ) : null}
        </div>

        {/* Currency + Exchange */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MetricCard
            icon={Coins}
            label="Currency"
            value={currencyParts.primary}
            hint={currencyParts.symbol}
          />
          {data.exchangeRate ? (
            <MetricCard
              icon={TrendingUp}
              label="Exchange rate"
              value={`1 ${data.exchangeRate.from} ≈ ${data.exchangeRate.rate} ${data.exchangeRate.to}`}
              hint={`Source: ${data.exchangeRate.source}. Confirm before exchanging money.`}
            />
          ) : (
            <MetricCard
              icon={TrendingUp}
              label="Exchange rate"
              value="Not available"
              hint="Confirm rates with a bank or exchange office."
            />
          )}
        </div>

        {/* Safety */}
        {data.safeRate ? <SafeRateCard data={data} details={details} /> : null}

        {/* Best time / Budget / Visa / Climate — each full width */}
        {bestTimePrimary ? (
          <MetricCard
            icon={CalendarDays}
            label="Best time to visit"
            value={bestTimePrimary}
            hint={bestTimeHint}
          />
        ) : null}
        {details?.dailyBudget ? (
          <MetricCard
            icon={Wallet}
            label="Estimated daily budget"
            value={formatBudgetPrimary(data, details)}
            hint={formatBudgetHint(data, details)}
          />
        ) : null}
        {visaSummary ? (
          <div className="flex flex-col rounded-2xl bg-surface px-4 py-3.5">
            <SectionHeader icon={BookOpen} label="Visa" />
            <p className="mt-2.5 text-sm leading-relaxed text-text">
              {visaSummary}
            </p>
            {visaExpanded && visaExtra ? (
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                {visaExtra}
              </p>
            ) : null}
            <div className="mt-auto flex items-end justify-between gap-2 pt-3">
              {visaExtra ? (
                <button
                  type="button"
                  onClick={() => setVisaExpanded((v) => !v)}
                  className="text-sm font-medium text-sky-700 hover:underline"
                >
                  {visaExpanded ? "Hide details ‹" : "Show details ›"}
                </button>
              ) : (
                <span />
              )}
              <span className="inline-flex shrink-0 items-center rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-medium text-orange-700">
                Requires verification
              </span>
            </div>
          </div>
        ) : null}
        {details?.climate?.description ? (
          <div className="flex flex-col rounded-2xl bg-surface px-4 py-3.5">
            <SectionHeader icon={Sun} label="Climate" />
            <p className="mt-2.5 text-sm leading-relaxed text-text">
              {details.climate.description}
            </p>
            {climateTemp ? (
              <div className="mt-auto pt-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-800">
                  <Thermometer className="h-3 w-3" strokeWidth={2} />
                  {climateTemp}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Practical info */}
        {hasPractical && details?.practicalInfo ? (
          <div className="rounded-2xl bg-surface px-4 py-3.5">
            <SectionHeader icon={Car} label="Practical info" />
            <div className="mt-3 w-full overflow-hidden text-sm">
              {details.practicalInfo.transport ? (
                <PracticalRow
                  label="Transport"
                  value={details.practicalInfo.transport}
                />
              ) : null}
              {details.practicalInfo.walkability ? (
                <PracticalRow
                  label="Walkability"
                  value={details.practicalInfo.walkability}
                />
              ) : null}
              {details.practicalInfo.payment ? (
                <PracticalRow
                  label="Payment"
                  value={details.practicalInfo.payment}
                />
              ) : null}
              {data.safeRate?.summary ? (
                <PracticalRow label="Safety" value={data.safeRate.summary} />
              ) : null}
              {details.practicalInfo.tips?.length ? (
                <div className="flex w-full flex-col border-t border-border/70 bg-white/50 first:border-t-0">
                  <span className="px-3 pt-2.5 font-semibold text-text">
                    Travel tips
                  </span>
                  <ul className="list-disc space-y-1 px-3 pb-2.5 pl-7 leading-relaxed text-text-secondary">
                    {details.practicalInfo.tips.map((tip) => (
                      <li key={tip}>{tip}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Useful apps — destination-specific traveler prep */}
        {usefulApps.length > 0 ? (
          <div className="rounded-2xl bg-surface px-4 py-3.5">
            <SectionHeader icon={Smartphone} label="Useful apps" />
            <ul className="mt-3 divide-y divide-border/70 overflow-hidden rounded-xl ring-1 ring-border/70">
              {usefulApps.map((app) => (
                <UsefulAppRow key={`${app.category}-${app.name}`} app={app} />
              ))}
            </ul>
          </div>
        ) : null}

        <p className="flex items-center gap-1.5 pt-1 text-xs text-text-muted">
          <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
          Last checked:{" "}
          {new Date(data.generatedAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
      </div>

      {showDisclaimer ? (
        <div className="mt-5 flex gap-3 rounded-2xl bg-warning-background px-4 py-3.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="min-w-0 text-sm text-warning">
            <p className="font-semibold">Travel information can change.</p>
            <p className="mt-0.5 font-normal opacity-90">
              {data.disclaimer
                ? data.disclaimer.replace(
                    /^Travel information can change\.\s*/i,
                    ""
                  )
                : CITY_INTELLIGENCE_DISCLAIMER.replace(
                    /^Travel information can change\.\s*/i,
                    ""
                  )}
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}

function SectionHeader({
  icon: Icon,
  label,
}: {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-text-secondary ring-1 ring-border/80">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      </span>
      <p className="whitespace-nowrap text-[11px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </p>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}) {
  if (!value) return null;
  return (
    <div className="rounded-2xl bg-surface px-4 py-3.5">
      <SectionHeader icon={icon} label={label} />
      <p className="mt-2.5 text-sm font-semibold leading-snug text-text">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs leading-relaxed text-text-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function PracticalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex w-full flex-col border-t border-border/50 first:border-t-0">
      <span className="px-3 pt-2.5 font-semibold text-text">{label}</span>
      <span className="px-3 pb-2.5 leading-relaxed text-text-secondary">
        {value}
      </span>
    </div>
  );
}

const USEFUL_APP_META: Record<
  UsefulAppCategory,
  { label: string; icon: LucideIcon }
> = {
  taxi: { label: "Taxi", icon: Car },
  transport: { label: "Transport", icon: Bus },
  maps: { label: "Maps", icon: Map },
  food: { label: "Food", icon: UtensilsCrossed },
  booking: { label: "Booking", icon: Ticket },
  payments: { label: "Payments", icon: CreditCard },
  translation: { label: "Translation", icon: Languages },
  local: { label: "Local", icon: Smartphone },
};

function getUsefulApps(
  data: CityIntelligenceResult | null,
  _details?: CityIntelligenceDetails
): UsefulApp[] {
  const apps = data?.usefulApps;
  if (!apps?.length) return [];
  return apps.filter((app) => app.isRecommended !== false).slice(0, 8);
}

function UsefulAppRow({ app }: { app: UsefulApp }) {
  const meta = USEFUL_APP_META[app.category] ?? USEFUL_APP_META.local;
  const Icon = meta.icon;
  const blurb = app.description || app.whyUseful;

  return (
    <li className="flex items-start gap-3 bg-white/50 px-3 py-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-text-secondary ring-1 ring-border/80">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
          {meta.label}
        </p>
        <p className="text-sm font-semibold text-text">{app.name}</p>
        {blurb ? (
          <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
            {blurb}
          </p>
        ) : null}
        {app.officialUrl ? (
          <a
            href={app.officialUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline"
          >
            Open app
            <ExternalLink className="h-3 w-3" strokeWidth={2} aria-hidden />
          </a>
        ) : null}
      </div>
    </li>
  );
}

function getCurrencyParts(
  data: CityIntelligenceResult,
  details?: CityIntelligenceDetails
): { primary: string; symbol?: string } {
  const code =
    data.exchangeRate?.to || details?.dailyBudget?.currency || "";
  return { primary: code || "—" };
}

function formatBestTimePrimary(
  data: CityIntelligenceResult,
  _details?: CityIntelligenceDetails
): string {
  if (data.bestTimeToVisit?.months?.length) {
    return data.bestTimeToVisit.months.join(", ");
  }
  return data.bestTimeToVisit?.summary || "";
}

function formatBestTimeHint(
  data: CityIntelligenceResult,
  _details?: CityIntelligenceDetails
): string | undefined {
  const monthsShown = Boolean(data.bestTimeToVisit?.months?.length);
  if (!monthsShown) return undefined;
  return data.bestTimeToVisit?.summary;
}

function formatVisaSummary(
  data: CityIntelligenceResult,
  _details?: CityIntelligenceDetails
): string {
  return (
    data.visa?.description ||
    (data.visa?.required === true
      ? "Visa required"
      : data.visa?.required === false
        ? "Visa not required"
        : data.visa
          ? "Visa status unknown"
          : "")
  );
}

function formatVisaExtra(
  data: CityIntelligenceResult,
  _details?: CityIntelligenceDetails
): string | null {
  const visa = data.visa;
  const parts: string[] = [];
  if (visa?.type) parts.push(`Type: ${visa.type}`);
  if (visa?.cost?.amount != null) {
    const cur = visa.cost.currency ? ` ${visa.cost.currency}` : "";
    parts.push(`Approx. cost: ${visa.cost.amount}${cur}`);
  }
  if (visa?.verificationRequired) {
    parts.push("Verify with official immigration sources");
  }
  return parts.length ? parts.join(" · ") : null;
}

function getSafeRateValues(
  data: CityIntelligenceResult,
  _details?: CityIntelligenceDetails
): { score: number; outOf: number; summary?: string } | null {
  if (data.safeRate) {
    return {
      score: data.safeRate.score,
      outOf: data.safeRate.outOf,
      summary: data.safeRate.summary,
    };
  }
  return null;
}

function safeRateTone(normalized: number): {
  label: string;
  soft: string;
  text: string;
  badge: string;
} {
  if (normalized >= 0.8) {
    return {
      label: "Very safe",
      soft: "bg-success-background",
      text: "text-success",
      badge: "bg-success/15 text-success",
    };
  }
  if (normalized >= 0.6) {
    return {
      label: "Generally safe",
      soft: "bg-emerald-50",
      text: "text-emerald-700",
      badge: "bg-emerald-100 text-emerald-800",
    };
  }
  if (normalized >= 0.4) {
    return {
      label: "Moderate",
      soft: "bg-warning-background",
      text: "text-warning",
      badge: "bg-amber-100 text-amber-800",
    };
  }
  if (normalized >= 0.2) {
    return {
      label: "Use caution",
      soft: "bg-orange-50",
      text: "text-orange-700",
      badge: "bg-orange-100 text-orange-800",
    };
  }
  return {
    label: "Higher risk",
    soft: "bg-error-background",
    text: "text-error",
    badge: "bg-red-100 text-red-800",
  };
}

function SafeRateCard({
  data,
  details,
}: {
  data: CityIntelligenceResult;
  details?: CityIntelligenceDetails;
}) {
  const values = getSafeRateValues(data, details);
  if (!values) return null;

  const { score, outOf, summary } = values;
  const normalized = outOf > 0 ? Math.min(1, Math.max(0, score / outOf)) : 0;
  const percent = Math.round(normalized * 100);
  const tone = safeRateTone(normalized);
  const hint = summary;
  const scoreLabel = score % 1 === 0 ? score.toFixed(0) : score.toFixed(1);

  return (
    <div className={`relative overflow-hidden rounded-2xl ${tone.soft} px-4 py-4`}>
      <CityscapeSilhouette />

      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="w-full shrink-0 sm:w-auto">
          <SectionHeader icon={ShieldCheck} label="Safety rate" />
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
            <p className="inline-flex items-baseline whitespace-nowrap text-3xl font-semibold leading-none tracking-tight text-text">
              <span>{scoreLabel}</span>
              <span className="ml-1 text-base font-medium text-text-secondary">
                / {outOf}
              </span>
            </p>
          </div>
        </div>
        {hint ? (
          <p className="min-w-0 flex-1 text-sm leading-relaxed text-text-secondary sm:pt-6 sm:text-right">
            {hint}
          </p>
        ) : null}
      </div>

      <div className="relative mt-4">
        <div
          className="relative h-2.5 rounded-full"
          style={{
            background:
              "linear-gradient(90deg, #ef4444 0%, #f59e0b 28%, #22c55e 62%, #86efac 100%)",
          }}
        >
          <span
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-emerald-600 shadow-sm"
            style={{ left: `${percent}%` }}
            aria-hidden
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] font-medium text-text-muted">
          <span>Higher risk</span>
          <span>More safe</span>
        </div>
      </div>
    </div>
  );
}

function CityscapeSilhouette() {
  return (
    <svg
      className="pointer-events-none absolute inset-y-0 right-0 h-full w-[55%] text-emerald-900/10"
      viewBox="0 0 320 160"
      fill="currentColor"
      aria-hidden
      preserveAspectRatio="xMaxYMid meet"
    >
      <path d="M40 160V95h18v65H40zm22 0V78h14l8-18h10l8 18h12v82H62zm48 0V88h20v72H110zm24 0V70h16v-22h12v22h10v90H134zm42 0V82h28v78H176zm32 0V60h18V38l16-20 16 20v22h14v100H208zm68 0V90h24v70H276z" />
      <path d="M250 38c0-14 10-26 22-30 2 8 6 14 12 18-8 2-14 8-16 16h-18z" />
    </svg>
  );
}

function formatMoney(amount: number, code: string): string {
  const rounded =
    amount >= 100 ? Math.round(amount) : Math.round(amount * 10) / 10;
  return `~${rounded} ${code}`;
}

function formatBudgetPrimary(
  data: CityIntelligenceResult,
  details?: CityIntelligenceDetails
): string {
  const midUser = details?.dailyBudget?.midRange?.userCurrency;
  const midLocal = details?.dailyBudget?.midRange?.local;
  const localCode =
    details?.dailyBudget?.currency?.trim().toUpperCase() ||
    data.exchangeRate?.to?.trim().toUpperCase() ||
    "";
  const userCode = data.exchangeRate?.from?.trim().toUpperCase() || "";

  if (midUser != null && Number.isFinite(midUser) && userCode) {
    return `${formatMoney(midUser, userCode)} / day`;
  }
  if (midLocal != null && Number.isFinite(midLocal) && localCode) {
    return `${formatMoney(midLocal, localCode)} / day`;
  }
  return details?.dailyBudget?.description ?? "";
}

function formatBudgetHint(
  data: CityIntelligenceResult,
  details?: CityIntelligenceDetails
): string | undefined {
  const midUser = details?.dailyBudget?.midRange?.userCurrency;
  const midLocal = details?.dailyBudget?.midRange?.local;
  const localCode =
    details?.dailyBudget?.currency?.trim().toUpperCase() ||
    data.exchangeRate?.to?.trim().toUpperCase() ||
    "";
  const userCode = data.exchangeRate?.from?.trim().toUpperCase() || "";
  const description = details?.dailyBudget?.description?.trim();

  const parts: string[] = [];

  if (
    midUser != null &&
    Number.isFinite(midUser) &&
    userCode &&
    midLocal != null &&
    Number.isFinite(midLocal) &&
    localCode &&
    localCode !== userCode
  ) {
    parts.push(`${formatMoney(midLocal, localCode)} locally (mid-range)`);
  } else if (midLocal != null && Number.isFinite(midLocal) && localCode) {
    parts.push("Mid-range estimate");
  }

  if (description) parts.push(description);

  return parts.length ? parts.join(" · ") : undefined;
}

function formatTemperature(avg?: {
  min?: number | null;
  max?: number | null;
  unit?: string;
}): string | undefined {
  if (!avg) return undefined;
  const { min, max, unit } = avg;
  if (min == null && max == null) return undefined;
  const u = unit ?? "°C";
  if (min != null && max != null) return `Avg ${min}–${max}${u}`;
  if (min != null) return `Avg from ${min}${u}`;
  return `Avg up to ${max}${u}`;
}
