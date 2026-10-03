"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./Button";
import { cx } from "@/lib/utils";

export type DateRangeValue = {
  from?: Date;
  to?: Date;
};

/** Existing trip (or other booking) already occupying calendar days. */
export type BusyDateRange = {
  id: string;
  label: string;
  from: Date;
  to: Date;
};

interface DateRangePickerProps {
  value?: DateRangeValue;
  onValueChange?: (value: DateRangeValue) => void;
  /** Called when Apply is pressed (requires a complete range). */
  onApply?: (value: DateRangeValue) => void;
  /** Called when Cancel is pressed. */
  onCancel?: () => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Disallow dates before this day (inclusive). Defaults to today. */
  minDate?: Date | null;
  /**
   * Inclusive max days between start and end (e.g. 14 = from and to at most
   * 13 days apart). Applied while choosing the end date.
   */
  maxSpanDays?: number;
  /**
   * Existing trips to paint on the calendar. Days in these ranges (and
   * selections that would span them) are disabled so new trips can’t overlap.
   */
  busyRanges?: BusyDateRange[];
  /** Kept for API compatibility. */
  enableSelect?: boolean;
  enableYearNavigation?: boolean;
}

const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function sameDay(a?: Date | null, b?: Date | null): boolean {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isBeforeDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() < startOfDay(b).getTime();
}

function isAfterDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() > startOfDay(b).getTime();
}

/** Inclusive day count between two calendar days. */
function inclusiveDayCount(a: Date, b: Date): number {
  const start = startOfDay(a).getTime();
  const end = startOfDay(b).getTime();
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return Math.floor((hi - lo) / 86_400_000) + 1;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Monday = 0 … Sunday = 6 */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function formatMonthYear(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatRangeDay(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatCompactDay(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Inclusive overlap of two day ranges. */
function rangesOverlap(aFrom: Date, aTo: Date, bFrom: Date, bTo: Date): boolean {
  const aStart = startOfDay(aFrom).getTime();
  const aEnd = startOfDay(aTo).getTime();
  const bStart = startOfDay(bFrom).getTime();
  const bEnd = startOfDay(bTo).getTime();
  return aStart <= bEnd && bStart <= aEnd;
}

function dayInBusyRanges(
  date: Date,
  busyRanges: BusyDateRange[]
): BusyDateRange[] {
  return busyRanges.filter((range) =>
    rangesOverlap(date, date, range.from, range.to)
  );
}

function selectionOverlapsBusy(
  from: Date,
  to: Date,
  busyRanges: BusyDateRange[]
): boolean {
  return busyRanges.some((range) =>
    rangesOverlap(from, to, range.from, range.to)
  );
}

function normalizeBusyRanges(ranges: BusyDateRange[] | undefined): BusyDateRange[] {
  if (!ranges?.length) return [];
  return ranges.map((range) => ({
    ...range,
    from: startOfDay(range.from),
    to: startOfDay(range.to),
  }));
}

function rangesVisibleInMonth(
  month: Date,
  busyRanges: BusyDateRange[]
): BusyDateRange[] {
  const monthStart = startOfMonth(month);
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  return busyRanges.filter((range) =>
    rangesOverlap(range.from, range.to, monthStart, monthEnd)
  );
}

type DayCell = {
  date: Date;
  inMonth: boolean;
};

function buildMonthGrid(month: Date): DayCell[] {
  const year = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(year, m, 1);
  const lead = mondayIndex(first);
  const total = daysInMonth(year, m);
  const cells: DayCell[] = [];

  for (let i = lead - 1; i >= 0; i -= 1) {
    cells.push({
      date: new Date(year, m, -i),
      inMonth: false,
    });
  }

  for (let day = 1; day <= total; day += 1) {
    cells.push({ date: new Date(year, m, day), inMonth: true });
  }

  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1]!.date;
    cells.push({
      date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1),
      inMonth: false,
    });
  }

  return cells;
}

/**
 * Dual-month calendar date range picker (From → To) with Cancel / Apply.
 */
export function DateRangePicker({
  value,
  onValueChange,
  onApply,
  onCancel,
  className,
  disabled,
  minDate,
  maxSpanDays,
  busyRanges: busyRangesProp,
}: DateRangePickerProps) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const earliest =
    minDate === null
      ? null
      : startOfDay(minDate ?? today);
  const busyRanges = useMemo(
    () => normalizeBusyRanges(busyRangesProp),
    [busyRangesProp]
  );

  const [draft, setDraft] = useState<DateRangeValue>(() => ({
    from: value?.from ? startOfDay(value.from) : undefined,
    to: value?.to ? startOfDay(value.to) : undefined,
  }));
  const [leftMonth, setLeftMonth] = useState(() =>
    startOfMonth(value?.from ?? today)
  );
  const [rightMonth, setRightMonth] = useState(() => {
    const base = value?.to
      ? startOfMonth(value.to)
      : addMonths(startOfMonth(value?.from ?? today), 1);
    const left = startOfMonth(value?.from ?? today);
    return base.getTime() <= left.getTime() ? addMonths(left, 1) : base;
  });

  const valueFromTime = value?.from?.getTime();
  const valueToTime = value?.to?.getTime();

  useEffect(() => {
    setDraft({
      from: value?.from ? startOfDay(value.from) : undefined,
      to: value?.to ? startOfDay(value.to) : undefined,
    });
    if (value?.from) {
      const left = startOfMonth(value.from);
      setLeftMonth(left);
      const right = value.to
        ? startOfMonth(value.to)
        : addMonths(left, 1);
      setRightMonth(
        right.getTime() <= left.getTime() ? addMonths(left, 1) : right
      );
    }
  }, [valueFromTime, valueToTime, value?.from, value?.to]);

  function commitDraft(next: DateRangeValue) {
    setDraft(next);
    onValueChange?.(next);
  }

  function exceedsMaxSpan(a: Date, b: Date): boolean {
    return (
      typeof maxSpanDays === "number" &&
      maxSpanDays > 0 &&
      inclusiveDayCount(a, b) > maxSpanDays
    );
  }

  function selectDay(day: Date) {
    if (disabled) return;
    const picked = startOfDay(day);
    if (earliest && isBeforeDay(picked, earliest)) return;
    if (dayInBusyRanges(picked, busyRanges).length > 0) return;

    // Start a new range, or set the end date.
    if (!draft.from || (draft.from && draft.to)) {
      commitDraft({ from: picked, to: undefined });
      return;
    }

    if (sameDay(draft.from, picked)) {
      if (selectionOverlapsBusy(picked, picked, busyRanges)) return;
      commitDraft({ from: picked, to: picked });
      return;
    }

    if (exceedsMaxSpan(draft.from, picked)) return;

    if (isBeforeDay(picked, draft.from)) {
      if (selectionOverlapsBusy(picked, draft.from, busyRanges)) return;
      commitDraft({ from: picked, to: draft.from });
      return;
    }

    if (selectionOverlapsBusy(draft.from, picked, busyRanges)) return;
    commitDraft({ from: draft.from, to: picked });
  }

  function shiftLeft(delta: number) {
    setLeftMonth((prev) => {
      const next = addMonths(prev, delta);
      if (next.getTime() >= rightMonth.getTime()) {
        setRightMonth(addMonths(next, 1));
      }
      return next;
    });
  }

  function shiftRight(delta: number) {
    setRightMonth((prev) => {
      const next = addMonths(prev, delta);
      if (next.getTime() <= leftMonth.getTime()) {
        setLeftMonth(addMonths(next, -1));
      }
      return next;
    });
  }

  const draftOverlapsBusy = Boolean(
    draft.from &&
      draft.to &&
      selectionOverlapsBusy(draft.from, draft.to, busyRanges)
  );
  const canApply =
    Boolean(draft.from && draft.to) &&
    !disabled &&
    !draftOverlapsBusy &&
    !(draft.from && draft.to && exceedsMaxSpan(draft.from, draft.to));
  const rangeLabel =
    draft.from && draft.to
      ? `Range: ${formatRangeDay(draft.from)} - ${formatRangeDay(draft.to)}`
      : draft.from
        ? `Range: ${formatRangeDay(draft.from)} - …`
        : "Select a start and end date";

  const visibleBusyTrips = useMemo(() => {
    const byId = new Map<string, BusyDateRange>();
    for (const range of [
      ...rangesVisibleInMonth(leftMonth, busyRanges),
      ...rangesVisibleInMonth(rightMonth, busyRanges),
    ]) {
      byId.set(range.id, range);
    }
    return [...byId.values()].sort(
      (a, b) => a.from.getTime() - b.from.getTime()
    );
  }, [busyRanges, leftMonth, rightMonth]);

  return (
    <div
      className={cx(
        "overflow-hidden rounded-2xl border border-border bg-surface-elevated",
        className
      )}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 md:divide-x md:divide-border">
        <MonthPanel
          month={leftMonth}
          draft={draft}
          today={today}
          earliest={earliest}
          maxSpanDays={maxSpanDays}
          busyRanges={busyRanges}
          disabled={disabled}
          onPrev={() => shiftLeft(-1)}
          onNext={() => shiftLeft(1)}
          onSelect={selectDay}
        />
        <MonthPanel
          month={rightMonth}
          draft={draft}
          today={today}
          earliest={earliest}
          maxSpanDays={maxSpanDays}
          busyRanges={busyRanges}
          disabled={disabled}
          onPrev={() => shiftRight(-1)}
          onNext={() => shiftRight(1)}
          onSelect={selectDay}
          className="border-t border-border md:border-t-0"
        />
      </div>

      {visibleBusyTrips.length > 0 ? (
        <div className="border-t border-border px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
            Your trips
          </p>
          <ul className="mt-2 space-y-1.5">
            {visibleBusyTrips.map((trip) => (
              <li
                key={trip.id}
                className="flex items-center gap-2 text-sm text-text"
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-warning" />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {trip.label}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-text-muted">
                  {formatCompactDay(trip.from)}–{formatCompactDay(trip.to)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-muted">
            Occupied days can’t be selected so trips don’t overlap.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 truncate text-sm text-text-secondary">
          {draftOverlapsBusy
            ? "Selected range overlaps an existing trip."
            : rangeLabel}
        </p>
        <div className="flex shrink-0 justify-end gap-2">
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() => onCancel?.()}
            className="!h-9 !border-primary !bg-transparent !px-4 !text-primary hover:!bg-primary-tint"
          >
            Cancel
          </Button>
          <Button
            disabled={!canApply}
            onClick={() => {
              if (!draft.from || !draft.to) return;
              if (exceedsMaxSpan(draft.from, draft.to)) return;
              if (selectionOverlapsBusy(draft.from, draft.to, busyRanges)) {
                return;
              }
              onApply?.(draft);
            }}
            className="!h-9 !px-4"
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}

function MonthPanel({
  month,
  draft,
  today,
  earliest,
  maxSpanDays,
  busyRanges,
  disabled,
  onPrev,
  onNext,
  onSelect,
  className,
}: {
  month: Date;
  draft: DateRangeValue;
  today: Date;
  earliest: Date | null;
  maxSpanDays?: number;
  busyRanges: BusyDateRange[];
  disabled?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSelect: (date: Date) => void;
  className?: string;
}) {
  const cells = useMemo(() => buildMonthGrid(month), [month]);
  const selectingEnd = Boolean(draft.from && !draft.to);

  const busyByDay = useMemo(() => {
    const map = new Map<string, BusyDateRange[]>();
    for (const range of busyRanges) {
      const cursor = new Date(range.from);
      while (!isAfterDay(cursor, range.to)) {
        const key = dayKey(cursor);
        const list = map.get(key) ?? [];
        list.push(range);
        map.set(key, list);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return map;
  }, [busyRanges]);

  return (
    <div className={cx("p-3 sm:p-4", className)}>
      <div className="mb-3 flex items-center justify-between rounded-xl bg-surface px-2 py-2">
        <button
          type="button"
          aria-label="Previous month"
          disabled={disabled}
          onClick={onPrev}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text disabled:opacity-50"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-semibold text-text">
          {formatMonthYear(month)}
        </p>
        <button
          type="button"
          aria-label="Next month"
          disabled={disabled}
          onClick={onNext}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text disabled:opacity-50"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-y-1">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="py-1 text-center text-[11px] font-medium uppercase tracking-wide text-text-muted"
          >
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((cell) => {
          const { date, inMonth } = cell;
          const isStart = sameDay(date, draft.from);
          const isEnd = sameDay(date, draft.to);
          const isEndpoint = isStart || isEnd;
          const inRange =
            Boolean(draft.from && draft.to) &&
            !isBeforeDay(date, draft.from!) &&
            !isAfterDay(date, draft.to!);
          const isToday = sameDay(date, today);
          const dayBusy = inMonth ? (busyByDay.get(dayKey(date)) ?? []) : [];
          const isBusy = dayBusy.length > 0;
          const busyStart = dayBusy.some((trip) => sameDay(date, trip.from));
          const busyEnd = dayBusy.some((trip) => sameDay(date, trip.to));
          const busySingle = dayBusy.some((trip) =>
            sameDay(trip.from, trip.to)
          );
          const outsideSpan =
            selectingEnd &&
            typeof maxSpanDays === "number" &&
            maxSpanDays > 0 &&
            inclusiveDayCount(draft.from!, date) > maxSpanDays;
          const crossesBusy =
            selectingEnd &&
            selectionOverlapsBusy(
              isBeforeDay(date, draft.from!) ? date : draft.from!,
              isBeforeDay(date, draft.from!) ? draft.from! : date,
              busyRanges
            );
          const isDisabled =
            Boolean(disabled) ||
            (earliest ? isBeforeDay(date, earliest) : false) ||
            outsideSpan ||
            isBusy ||
            crossesBusy;

          const rangeBar =
            inRange && draft.from && draft.to && !sameDay(draft.from, draft.to);
          const busyBar =
            isBusy &&
            inMonth &&
            !rangeBar &&
            !isEndpoint &&
            !(busyStart && busyEnd);

          return (
            <div
              key={`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${inMonth}`}
              className={cx(
                "relative flex items-center justify-center py-0.5",
                rangeBar && inMonth && "bg-primary-tint",
                rangeBar && inMonth && isStart && "rounded-l-lg",
                rangeBar && inMonth && isEnd && "rounded-r-lg",
                busyBar && "bg-warning-background",
                busyBar && busyStart && !busyEnd && "rounded-l-lg",
                busyBar && busyEnd && !busyStart && "rounded-r-lg"
              )}
              title={
                isBusy
                  ? dayBusy.map((trip) => trip.label).join(", ")
                  : undefined
              }
            >
              <button
                type="button"
                disabled={isDisabled || !inMonth}
                onClick={() => onSelect(date)}
                aria-label={
                  isBusy
                    ? `${date.getDate()}, occupied by ${dayBusy.map((t) => t.label).join(", ")}`
                    : `${date.getDate()}`
                }
                className={cx(
                  "relative z-[1] flex h-9 w-9 flex-col items-center justify-center rounded-lg text-sm transition-colors",
                  !inMonth && "text-text-muted/50",
                  inMonth &&
                    !isEndpoint &&
                    !isBusy &&
                    "text-text hover:bg-primary-tint",
                  inMonth &&
                    isBusy &&
                    !isEndpoint &&
                    "font-medium text-warning",
                  inMonth &&
                    isBusy &&
                    (busyStart || busyEnd || busySingle) &&
                    !isEndpoint &&
                    "bg-warning text-white",
                  isEndpoint && "bg-primary font-semibold text-white",
                  isDisabled &&
                    inMonth &&
                    !isBusy &&
                    "cursor-not-allowed opacity-40",
                  isBusy && inMonth && "cursor-not-allowed",
                  !inMonth && "pointer-events-none"
                )}
              >
                <span>{date.getDate()}</span>
                {isToday && inMonth ? (
                  <span
                    className={cx(
                      "absolute bottom-1 h-1 w-1 rounded-full",
                      isEndpoint ||
                        (isBusy && (busyStart || busyEnd || busySingle))
                        ? "bg-white"
                        : "bg-primary"
                    )}
                  />
                ) : null}
                {isBusy && inMonth && dayBusy.length > 1 ? (
                  <span className="absolute -bottom-0.5 flex gap-0.5">
                    {dayBusy.slice(0, 3).map((trip) => (
                      <span
                        key={trip.id}
                        className={cx(
                          "h-1 w-1 rounded-full",
                          busyStart || busyEnd || busySingle
                            ? "bg-white/90"
                            : "bg-warning"
                        )}
                      />
                    ))}
                  </span>
                ) : null}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
