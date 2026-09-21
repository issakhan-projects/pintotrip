"use client";

import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Bus,
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
import { Sheet } from "@/components/ui/Sheet";
import type { CityIntelligenceResult } from "@/types/city-intelligence";
import type { CityIntelligenceStatus } from "@/types/trip-planner";
import { cx } from "@/lib/utils";

interface TripCityIntelligenceBlockProps {
  status: CityIntelligenceStatus;
  results?: CityIntelligenceResult[];
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
 * Supports one or many destination cities via results[].
 */
function hasCity(
  entry: CityIntelligenceResult
): entry is CityIntelligenceResult & {
  city: NonNullable<CityIntelligenceResult["city"]>;
} {
  return Boolean(entry?.city?.cityId || entry?.city?.name);
}

function cityKey(entry: CityIntelligenceResult, index: number): string {
  return entry.city?.cityId || entry.city?.name || `city-${index}`;
}

export function TripCityIntelligenceBlock({
  status,
  results = [],
  errorMessage,
  lastUpdatedAt,
  onRetry,
}: TripCityIntelligenceBlockProps) {
  const validResults = useMemo(() => results.filter(hasCity), [results]);
  const isLoading = status === "pending" || status === "loading";
  const isError =
    status === "error" ||
    (validResults.length === 0 && Boolean(errorMessage));

  const [activeCityId, setActiveCityId] = useState<string | null>(null);

  const selected = useMemo(() => {
    if (validResults.length === 0) return null;
    if (activeCityId) {
      return (
        validResults.find(
          (r, i) => cityKey(r, i) === activeCityId
        ) ?? validResults[0]!
      );
    }
    return validResults[0]!;
  }, [validResults, activeCityId]);

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

  const details = selected?.details;
  // Legacy payloads stored currency / visa under details.* or top-level aliases.
  const legacyDetails = details as
    | (NonNullable<CityIntelligenceResult["details"]> & {
        currency?: { code?: string; name?: string };
        visa?: CityIntelligenceResult["visa"];
        bestTimeToVisit?: {
          months?: string[];
          season?: string;
          description?: string;
        };
        practicalInfo?: {
          transport?: string;
          tips?: string[];
          safety?: string;
        };
      })
    | undefined;
  const legacyResult = selected as
    | (CityIntelligenceResult & {
        currency?: string;
        visaRequirements?: { summary?: string };
        approximateDailyBudget?: {
          amount?: number;
          currency?: string;
          summary?: string;
        };
      })
    | undefined;

  const currencyLabel =
    selected?.exchangeRate?.to ||
    details?.dailyBudget?.currency ||
    legacyDetails?.currency?.code ||
    (legacyDetails?.currency?.name
      ? [legacyDetails.currency.code, legacyDetails.currency.name]
          .filter(Boolean)
          .join(" ")
      : null) ||
    legacyResult?.currency ||
    null;

  const visa =
    selected?.visa?.description ||
    legacyDetails?.visa?.description ||
    legacyResult?.visaRequirements?.summary ||
    (selected?.visa?.required === true ||
    legacyDetails?.visa?.required === true
      ? "Visa required"
      : selected?.visa?.required === false ||
          legacyDetails?.visa?.required === false
        ? "Visa not required"
        : null);

  const bestTime =
    selected?.bestTimeToVisit?.summary ||
    selected?.bestTimeToVisit?.months?.join(", ") ||
    [
      legacyDetails?.bestTimeToVisit?.season,
      legacyDetails?.bestTimeToVisit?.description,
    ]
      .filter(Boolean)
      .join(" — ") ||
    legacyDetails?.bestTimeToVisit?.months?.join(", ");

  const budget = (() => {
    const midUser = details?.dailyBudget?.midRange?.userCurrency;
    const midLocal = details?.dailyBudget?.midRange?.local;
    const localCode =
      details?.dailyBudget?.currency?.trim().toUpperCase() ||
      selected?.exchangeRate?.to?.trim().toUpperCase() ||
      legacyDetails?.currency?.code?.trim().toUpperCase() ||
      legacyResult?.approximateDailyBudget?.currency?.trim().toUpperCase() ||
      "";
    const userCode =
      selected?.exchangeRate?.from?.trim().toUpperCase() || "";
    const rate = selected?.exchangeRate?.rate;

    let amountInUser =
      midUser != null && Number.isFinite(midUser) ? midUser : null;
    // Fallback when server-filled userCurrency is missing but FX is present.
    if (
      amountInUser == null &&
      midLocal != null &&
      Number.isFinite(midLocal) &&
      userCode &&
      rate != null &&
      rate > 0
    ) {
      amountInUser = Math.round((midLocal / rate) * 100) / 100;
    }

    const formatAmount = (amount: number, code: string) => {
      const rounded =
        amount >= 100 ? Math.round(amount) : Math.round(amount * 10) / 10;
      return `~${rounded} ${code} / day`;
    };

    if (amountInUser != null && userCode) {
      return formatAmount(amountInUser, userCode);
    }
    if (midLocal != null && Number.isFinite(midLocal) && localCode) {
      return formatAmount(midLocal, localCode);
    }
    const approx = legacyResult?.approximateDailyBudget;
    if (
      approx?.amount != null &&
      Number.isFinite(approx.amount) &&
      (approx.currency || localCode)
    ) {
      return formatAmount(
        approx.amount,
        (approx.currency || localCode).toUpperCase()
      );
    }
    return details?.dailyBudget?.description || approx?.summary;
  })();

  const climate = details?.climate?.description;
  const temp = details?.climate?.averageTemperature;
  const tempLabel =
    temp && (temp.min != null || temp.max != null)
      ? `Avg ${temp.min ?? "?"}–${temp.max ?? "?"}${temp.unit ?? "°C"}`
      : null;
  const climateValue = climate || tempLabel;

  const transport = details?.practicalInfo?.transport;
  const safety =
    selected?.safeRate?.summary ||
    legacyDetails?.practicalInfo?.safety ||
    (selected?.safeRate?.score != null &&
    Number.isFinite(selected.safeRate.score)
      ? `${selected.safeRate.score}/${selected.safeRate.outOf}`
      : null);
  const tips = details?.practicalInfo?.tips?.[0];

  const checkedAt =
    selected?.generatedAt != null
      ? new Date(selected.generatedAt)
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

  const multiCity = validResults.length > 1;

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
              {multiCity
                ? "Insights for each destination on your trip."
                : "Destination insights tailored to your trip."}
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

      {multiCity ? (
        <div className="-mx-1 mt-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {validResults.map((entry, index) => {
            const key = cityKey(entry, index);
            const active =
              (activeCityId ?? cityKey(validResults[0]!, 0)) === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveCityId(key)}
                className={cx(
                  "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary-tint text-primary"
                    : "border-border bg-surface text-text-secondary hover:border-primary/30 hover:text-text"
                )}
              >
                {entry.city.name}
              </button>
            );
          })}
        </div>
      ) : null}

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
  const [open, setOpen] = useState(false);
  const text = value?.trim() || "";
  const canOpen = !loading && text.length > 48;

  return (
    <>
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
          {canOpen ? (
            <button
              type="button"
              aria-label={`Show ${label} details`}
              onClick={() => setOpen(true)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-elevated hover:text-text"
            >
              <Info className="h-4 w-4" />
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
            disabled={!canOpen}
            onClick={() => {
              if (canOpen) setOpen(true);
            }}
            className={cx(
              "mt-2.5 w-full text-left text-sm font-medium leading-snug text-text",
              canOpen && "cursor-pointer",
              !canOpen && "cursor-default"
            )}
          >
            <span className="line-clamp-2">{text || "—"}</span>
          </button>
        )}
      </div>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        size="sm"
        leading={
          <span
            className={cx(
              "flex h-9 w-9 items-center justify-center rounded-xl",
              TONE_CLASS[tone]
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
        }
      >
        <p className="text-sm leading-relaxed text-text whitespace-pre-wrap">
          {text}
        </p>
      </Sheet>
    </>
  );
}
