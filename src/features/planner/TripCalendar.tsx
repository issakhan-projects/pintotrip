"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { TripPlannerDoc } from "@/types/trip-planner";
import { cx } from "@/lib/utils";

const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

/** Soft palette for overlapping trip ranges (matches app tokens). */
const TRIP_PALETTE = [
  {
    bar: "bg-primary/15",
    endpoint: "bg-primary text-white",
    dot: "bg-primary",
    chip: "border-primary/25 bg-primary-tint text-primary",
  },
  {
    bar: "bg-success/15",
    endpoint: "bg-success text-white",
    dot: "bg-success",
    chip: "border-success/25 bg-success-background text-success",
  },
  {
    bar: "bg-warning/15",
    endpoint: "bg-warning text-white",
    dot: "bg-warning",
    chip: "border-warning/25 bg-warning-background text-warning",
  },
  {
    bar: "bg-primary-light/20",
    endpoint: "bg-primary-light text-white",
    dot: "bg-primary-light",
    chip: "border-primary-light/30 bg-primary-tint text-primary-hover",
  },
] as const;

type DayCell = {
  date: Date;
  inMonth: boolean;
};

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function sameDay(a: Date, b: Date): boolean {
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

function tripDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function tripLabel(trip: TripPlannerDoc): string {
  return trip.destination.cityName || trip.destination.countryName || "Trip";
}

function initialMonth(trips: TripPlannerDoc[]): Date {
  const today = startOfDay(new Date());
  const upcoming = trips
    .map((t) => ({
      trip: t,
      start: startOfDay(t.startDate.toDate()),
      end: startOfDay(t.endDate.toDate()),
    }))
    .filter(({ end }) => !isBeforeDay(end, today))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  if (upcoming[0]) return startOfMonth(upcoming[0].start);

  if (trips.length > 0) {
    const latest = [...trips].sort(
      (a, b) => b.startDate.toMillis() - a.startDate.toMillis()
    )[0]!;
    return startOfMonth(startOfDay(latest.startDate.toDate()));
  }

  return startOfMonth(today);
}

export interface TripCalendarProps {
  trips: TripPlannerDoc[];
  onSelectTrip?: (tripId: string) => void;
  className?: string;
}

/**
 * Single-month calendar styled like DateRangePicker.
 * Highlights trip date ranges and lists trips visible in the month.
 */
export function TripCalendar({
  trips,
  onSelectTrip,
  className,
}: TripCalendarProps) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [month, setMonth] = useState(() => initialMonth(trips));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const cells = useMemo(() => buildMonthGrid(month), [month]);

  const colorByTripId = useMemo(() => {
    const map = new Map<string, (typeof TRIP_PALETTE)[number]>();
    const sorted = [...trips].sort(
      (a, b) => a.startDate.toMillis() - b.startDate.toMillis()
    );
    sorted.forEach((trip, index) => {
      map.set(trip.id, TRIP_PALETTE[index % TRIP_PALETTE.length]!);
    });
    return map;
  }, [trips]);

  const tripsByDay = useMemo(() => {
    const map = new Map<string, TripPlannerDoc[]>();
    for (const trip of trips) {
      if (trip.status === "cancelled") continue;
      const start = startOfDay(trip.startDate.toDate());
      const end = startOfDay(trip.endDate.toDate());
      const cursor = new Date(start);
      while (!isAfterDay(cursor, end)) {
        const key = tripDayKey(cursor);
        const list = map.get(key) ?? [];
        list.push(trip);
        map.set(key, list);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return map;
  }, [trips]);

  const monthTrips = useMemo(() => {
    const monthStart = startOfMonth(month);
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    return trips
      .filter((trip) => {
        if (trip.status === "cancelled") return false;
        const start = startOfDay(trip.startDate.toDate());
        const end = startOfDay(trip.endDate.toDate());
        return !isAfterDay(start, monthEnd) && !isBeforeDay(end, monthStart);
      })
      .sort((a, b) => a.startDate.toMillis() - b.startDate.toMillis());
  }, [trips, month]);

  const selectedTrips = selectedDay
    ? (tripsByDay.get(tripDayKey(selectedDay)) ?? [])
    : [];

  function handleDayClick(date: Date, inMonth: boolean) {
    if (!inMonth) return;
    const dayTrips = tripsByDay.get(tripDayKey(date)) ?? [];
    setSelectedDay(date);
    if (dayTrips.length === 1) {
      onSelectTrip?.(dayTrips[0]!.id);
    }
  }

  return (
    <div
      className={cx(
        "overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-sm",
        className
      )}
    >
      <div className="p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between rounded-xl bg-surface px-2 py-2">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setMonth((prev) => addMonths(prev, -1))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="text-sm font-semibold text-text">
            {formatMonthYear(month)}
          </p>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonth((prev) => addMonths(prev, 1))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text"
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
            const dayTrips = inMonth
              ? (tripsByDay.get(tripDayKey(date)) ?? [])
              : [];
            const isToday = sameDay(date, today);
            const isSelected = selectedDay ? sameDay(date, selectedDay) : false;
            const primaryTrip = dayTrips[0];
            const palette = primaryTrip
              ? colorByTripId.get(primaryTrip.id)
              : undefined;

            const isRangeStart = dayTrips.some((trip) =>
              sameDay(date, startOfDay(trip.startDate.toDate()))
            );
            const isRangeEnd = dayTrips.some((trip) =>
              sameDay(date, startOfDay(trip.endDate.toDate()))
            );
            const inTripRange = dayTrips.length > 0;
            const isSingleDay = dayTrips.some((trip) =>
              sameDay(
                startOfDay(trip.startDate.toDate()),
                startOfDay(trip.endDate.toDate())
              )
            );

            return (
              <div
                key={`${tripDayKey(date)}-${inMonth}`}
                className={cx(
                  "relative flex items-center justify-center py-0.5",
                  inTripRange &&
                    inMonth &&
                    palette &&
                    !isRangeStart &&
                    !isRangeEnd &&
                    !isSingleDay &&
                    palette.bar,
                  inTripRange &&
                    inMonth &&
                    isRangeStart &&
                    !isRangeEnd &&
                    palette &&
                    cx(palette.bar, "rounded-l-lg"),
                  inTripRange &&
                    inMonth &&
                    isRangeEnd &&
                    !isRangeStart &&
                    palette &&
                    cx(palette.bar, "rounded-r-lg")
                )}
              >
                <button
                  type="button"
                  disabled={!inMonth}
                  onClick={() => handleDayClick(date, inMonth)}
                  aria-label={
                    dayTrips.length > 0
                      ? `${date.getDate()}, ${dayTrips.length} trip${dayTrips.length === 1 ? "" : "s"}`
                      : `${date.getDate()}`
                  }
                  className={cx(
                    "relative z-[1] flex h-9 w-9 flex-col items-center justify-center rounded-lg text-sm transition-colors",
                    !inMonth && "pointer-events-none text-text-muted/50",
                    inMonth &&
                      !inTripRange &&
                      !isSelected &&
                      "text-text hover:bg-primary-tint",
                    inMonth &&
                      inTripRange &&
                      !isRangeStart &&
                      !isRangeEnd &&
                      "font-medium text-text",
                    inMonth &&
                      (isRangeStart || isRangeEnd || (inTripRange && isSingleDay)) &&
                      palette &&
                      cx(palette.endpoint, "font-semibold"),
                    isSelected &&
                      inMonth &&
                      !isRangeStart &&
                      !isRangeEnd &&
                      !(inTripRange && isSingleDay) &&
                      "ring-2 ring-primary/40"
                  )}
                >
                  <span>{date.getDate()}</span>
                  {isToday && inMonth ? (
                    <span
                      className={cx(
                        "absolute bottom-1 h-1 w-1 rounded-full",
                        isRangeStart || isRangeEnd || (inTripRange && isSingleDay)
                          ? "bg-white"
                          : "bg-primary"
                      )}
                    />
                  ) : null}
                  {dayTrips.length > 1 && inMonth ? (
                    <span className="absolute -bottom-0.5 flex gap-0.5">
                      {dayTrips.slice(0, 3).map((trip) => (
                        <span
                          key={trip.id}
                          className={cx(
                            "h-1 w-1 rounded-full",
                            isRangeStart || isRangeEnd
                              ? "bg-white/90"
                              : colorByTripId.get(trip.id)?.dot
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

      <div className="border-t border-border px-4 py-3">
        {selectedTrips.length > 0 ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              {new Intl.DateTimeFormat("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              }).format(selectedDay!)}
            </p>
            <ul className="mt-2 space-y-1.5">
              {selectedTrips.map((trip) => {
                const palette = colorByTripId.get(trip.id)!;
                return (
                  <li key={trip.id}>
                    <button
                      type="button"
                      onClick={() => onSelectTrip?.(trip.id)}
                      className={cx(
                        "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors hover:opacity-90",
                        palette.chip
                      )}
                    >
                      <span
                        className={cx("h-2 w-2 shrink-0 rounded-full", palette.dot)}
                      />
                      <span className="min-w-0 truncate">{tripLabel(trip)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : monthTrips.length > 0 ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Trips this month
            </p>
            <ul className="mt-2 space-y-1.5">
              {monthTrips.map((trip) => {
                const palette = colorByTripId.get(trip.id)!;
                return (
                  <li key={trip.id}>
                    <button
                      type="button"
                      onClick={() => onSelectTrip?.(trip.id)}
                      className="flex w-full items-center gap-2 rounded-xl px-1 py-1.5 text-left text-sm text-text transition-colors hover:bg-surface"
                    >
                      <span
                        className={cx("h-2 w-2 shrink-0 rounded-full", palette.dot)}
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {tripLabel(trip)}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-text-muted">
                        {startOfDay(trip.startDate.toDate()).getDate()}
                        –
                        {startOfDay(trip.endDate.toDate()).getDate()}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-text-secondary">
            No trips planned this month.
          </p>
        )}
      </div>
    </div>
  );
}
