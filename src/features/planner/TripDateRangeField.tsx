"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import {
  DateRangePicker,
  type BusyDateRange,
  type DateRangeValue,
} from "@/components/ui";
import { cx } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { Timestamp } from "firebase/firestore";
import { tripDayCount } from "@/services/trip-planner";

export type { BusyDateRange, DateRangeValue };

function formatCompactDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === "kz" ? "kk" : locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function defaultTripDateRange(): DateRangeValue {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 4);
  return { from: start, to: end };
}

interface TripDateRangeFieldProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  /** Field label. Defaults to "Dates". */
  label?: string;
  /** Start expanded (default false). */
  defaultOpen?: boolean;
  disabled?: boolean;
  className?: string;
  /** Disallow dates before this day. Pass null to allow any past date. */
  minDate?: Date | null;
  /** Inclusive max days between start and end. */
  maxSpanDays?: number;
  /** Existing trips shown on the calendar; those days can’t be selected. */
  busyRanges?: BusyDateRange[];
}

/**
 * Trip dates field: summary trigger + dual-month calendar range picker.
 */
export function TripDateRangeField({
  value,
  onChange,
  label = "Dates",
  defaultOpen = false,
  disabled,
  className,
  minDate,
  maxSpanDays,
  busyRanges,
}: TripDateRangeFieldProps) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const days =
    value.from && value.to
      ? tripDayCount(
          Timestamp.fromDate(value.from),
          Timestamp.fromDate(value.to)
        )
      : 0;
  const daysLabel =
    value.from && value.to
      ? t(days === 1 ? "common.day_one" : "common.day_other", { count: days })
      : null;
  const summary =
    value.from && value.to
      ? `${formatCompactDate(value.from, locale)} — ${formatCompactDate(value.to, locale)}`
      : t("common.selectDates");

  return (
    <section className={className}>
      <div className="flex items-center gap-1.5 text-sm font-medium text-text">
        <CalendarDays className="h-3.5 w-3.5 text-text-muted" aria-hidden />
        <span>{label}</span>
        <span className="text-error" aria-hidden>
          *
        </span>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          "mt-2 flex w-full items-center gap-2 rounded-xl border border-border bg-surface-elevated px-3 py-2.5 text-left shadow-sm transition-colors",
          "hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60",
          open && "border-primary"
        )}
      >
        <span className="min-w-0 flex-1 truncate text-sm text-text">
          {summary}
        </span>
        {daysLabel ? (
          <span className="shrink-0 text-sm text-text-secondary">{daysLabel}</span>
        ) : null}
        <ChevronDown
          className={cx(
            "h-4 w-4 shrink-0 text-text-muted transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open ? (
        <div className="mt-2">
          <DateRangePicker
            key={`${value.from?.getTime() ?? 0}-${value.to?.getTime() ?? 0}-${open}`}
            value={value}
            disabled={disabled}
            minDate={minDate}
            maxSpanDays={maxSpanDays}
            busyRanges={busyRanges}
            onCancel={() => setOpen(false)}
            onApply={(next) => {
              onChange(next);
              setOpen(false);
            }}
          />
        </div>
      ) : null}
    </section>
  );
}
