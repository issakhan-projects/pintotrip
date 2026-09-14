"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Bus,
  ChevronDown,
  Coins,
  Info,
  Lightbulb,
  Loader2,
  Shield,
  Sun,
  Wallet,
  CloudSun,
} from "lucide-react";
import type { Timestamp } from "firebase/firestore";
import type { CityIntelligenceResult } from "@/types/city-intelligence";
import type { CityIntelligenceStatus } from "@/types/trip-planner";
import { cx } from "@/lib/utils";

interface TripCityIntelligenceBlockProps {
  status: CityIntelligenceStatus;
  result?: CityIntelligenceResult;
  errorMessage?: string;
  lastUpdatedAt?: Timestamp;
  onRetry?: () => void;
}

type TileTone =
  | "purple"
  | "blue"
  | "amber"
  | "green"
  | "sky"
  | "indigo"
  | "rose"
  | "yellow";

const TONE_CLASS: Record<TileTone, string> = {
  purple: "bg-primary-tint text-primary",
  blue: "bg-sky-50 text-sky-700",
  amber: "bg-amber-50 text-amber-700",
  green: "bg-emerald-50 text-emerald-700",
  sky: "bg-cyan-50 text-cyan-700",
  indigo: "bg-indigo-50 text-indigo-700",
  rose: "bg-rose-50 text-rose-700",
  yellow: "bg-yellow-50 text-yellow-700",
};

/**
 * Compact City Intelligence summary for Trip Planner Step 1.
 * Matches the trip detail grid layout (currency, visa, climate, …).
 */
export function TripCityIntelligenceBlock({
  status,
  result,
  errorMessage,
  lastUpdatedAt,
  onRetry,
}: TripCityIntelligenceBlockProps) {
  const isLoading = status === "pending" || status === "loading";
  const isError = status === "error" || (!result && Boolean(errorMessage));

  if (isError && !isLoading) {
    return (
      <section className="rounded-2xl border border-error/30 bg-error-background px-4 py-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
          <div>
            <p className="text-sm text-error">
              {errorMessage || "Could not load city intelligence."}
            </p>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="mt-2 text-sm font-medium text-error underline"
              >
                Try again
              </button>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  const details = result?.details;
  const currencyLabel = details?.currency
    ? [details.currency.code, details.currency.name].filter(Boolean).join(" ")
    : result?.currency
      ? result.currency
      : null;

  const visa =
    result?.visaRequirements?.summary ||
    details?.visa?.description ||
    (details?.visa?.required === true
      ? "Visa required"
      : details?.visa?.required === false
        ? "Visa not required"
        : null);

  const bestTime =
    result?.bestTimeToVisit?.summary ||
    details?.bestTimeToVisit?.description ||
    details?.bestTimeToVisit?.months?.join(", ");

  const budget = result?.approximateDailyBudget
    ? `${result.approximateDailyBudget.amount} ${result.approximateDailyBudget.currency} / day`
    : details?.dailyBudget?.midRange?.local != null
      ? `~${details.dailyBudget.midRange.local} ${details.dailyBudget.currency} / day`
      : details?.dailyBudget?.description;

  const climate = details?.climate?.description;
  const temp = details?.climate?.averageTemperature;
  const tempLabel =
    temp && (temp.min != null || temp.max != null)
      ? `Avg ${temp.min ?? "?"}–${temp.max ?? "?"}${temp.unit ?? "°C"}`
      : null;
  const climateValue = climate || tempLabel;

  const transport = details?.practicalInfo?.transport;
  const safety =
    details?.practicalInfo?.safety ||
    result?.safeRate?.summary ||
    (result?.safeRate?.score != null
      ? `${result.safeRate.score}/${result.safeRate.outOf}`
      : details?.practicalInfo?.safeRate?.score != null
        ? `${details.practicalInfo.safeRate.score}/${details.practicalInfo.safeRate.outOf}`
        : null);
  const tips = details?.practicalInfo?.tips?.[0];

  const checkedAt =
    result?.generatedAt != null
      ? new Date(result.generatedAt)
      : lastUpdatedAt?.toDate?.() ?? null;

  const tiles: Array<{
    key: string;
    icon: LucideIcon;
    label: string;
    value: string | null | undefined;
    tone: TileTone;
  }> = [
    {
      key: "currency",
      icon: Coins,
      label: "Currency",
      value: currencyLabel,
      tone: "purple",
    },
    { key: "visa", icon: BookOpen, label: "Visa", value: visa, tone: "blue" },
    {
      key: "best-time",
      icon: Sun,
      label: "Best time to visit",
      value: bestTime,
      tone: "amber",
    },
    {
      key: "budget",
      icon: Wallet,
      label: "Daily budget",
      value: budget,
      tone: "green",
    },
    {
      key: "climate",
      icon: CloudSun,
      label: "Climate",
      value: climateValue,
      tone: "sky",
    },
    {
      key: "transport",
      icon: Bus,
      label: "Transport",
      value: transport,
      tone: "indigo",
    },
    {
      key: "safety",
      icon: Shield,
      label: "Safety",
      value: safety,
      tone: "rose",
    },
    {
      key: "tips",
      icon: Lightbulb,
      label: "Practical tips",
      value: tips,
      tone: "yellow",
    },
  ];

  return (
    <section className="rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-tint text-primary">
            <BarChart3 className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-text">City Intelligence</h3>
            <p className="text-xs text-text-secondary">
              Destination insights tailored to your trip.
            </p>
          </div>
        </div>
        {isLoading ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Updating…
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {tiles.map((tile) => (
          <IntelTile
            key={tile.key}
            icon={tile.icon}
            label={tile.label}
            value={tile.value}
            tone={tile.tone}
            loading={isLoading && !tile.value}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-2 border-t border-divider pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-1.5 text-xs text-sky-800">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            This information is provided by AI and should be verified from
            official sources.
          </span>
        </p>
        {checkedAt ? (
          <p className="shrink-0 text-xs text-text-muted sm:text-right">
            Last checked{" "}
            {checkedAt.toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function IntelTile({
  icon: Icon,
  label,
  value,
  tone,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value?: string | null;
  tone: TileTone;
  loading?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = value?.trim() || "";
  const canExpand = !loading && text.length > 48;

  return (
    <div className="rounded-xl border border-border/70 bg-surface px-3 py-3">
      <div className="flex items-center gap-2">
        <span
          className={cx(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
            TONE_CLASS[tone]
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-secondary">
          {label}
        </span>
        {canExpand ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-elevated hover:text-text"
          >
            <ChevronDown
              className={cx(
                "h-4 w-4 transition-transform duration-200",
                expanded && "rotate-180"
              )}
            />
          </button>
        ) : null}
      </div>
      {loading ? (
        <p className="mt-2.5 flex items-center gap-1.5 text-xs text-text-muted">
          <Loader2 className="h-3 w-3 animate-spin text-primary" />
          Checking…
        </p>
      ) : (
        <button
          type="button"
          disabled={!canExpand}
          onClick={() => {
            if (canExpand) setExpanded((v) => !v);
          }}
          className={cx(
            "mt-2.5 w-full text-left text-sm font-medium leading-snug text-text",
            canExpand && "cursor-pointer",
            !canExpand && "cursor-default"
          )}
        >
          <span className={cx(!expanded && "line-clamp-2")}>
            {text || "—"}
          </span>
        </button>
      )}
    </div>
  );
}
