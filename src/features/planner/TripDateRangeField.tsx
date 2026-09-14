"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import {
  DateRangePicker,
  type DateRangeValue,
} from "@/components/ui";
import { cx } from "@/lib/utils";
import { Timestamp } from "firebase/firestore";
import { tripDayCount } from "@/services/trip-planner";

export type { DateRangeValue };

function formatCompactDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function dayCountLabel(range: DateRangeValue): string | null {
  if (!range.from || !range.to) return null;
  const days = tripDayCount(
    Timestamp.fromDate(range.from),
    Timestamp.fromDate(range.to)
  );
  return `${days} day${days === 1 ? "" : "s"}`;
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
  /** Start expanded (default false). */
  defaultOpen?: boolean;
  disabled?: boolean;
  className?: string;
  /** Disallow dates before this day. Pass null to allow any past date. */
  minDate?: Date | null;
}

/**
 * Trip dates field: summary trigger + dual-month calendar range picker.
 */
export function TripDateRangeField({
  value,
  onChange,
  defaultOpen = false,
  disabled,
  className,
  minDate,
}: TripDateRangeFieldProps) {
  const [open, setOpen] = useState(defaultOpen);
  const daysLabel = dayCountLabel(value);
  const summary =
    value.from && value.to
      ? `${formatCompactDate(value.from)} — ${formatCompactDate(value.to)}`
      : "Select dates";

  return (
    <section className={className}>
      <div className="flex items-center gap-1.5 text-sm font-medium text-text">
        <CalendarDays className="h-3.5 w-3.5 text-text-muted" aria-hidden />
        <span>Dates</span>
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
