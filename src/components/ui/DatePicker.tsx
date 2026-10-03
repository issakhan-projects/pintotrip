"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "@/lib/utils";

export type DatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  /** Inclusive min date `YYYY-MM-DD`. */
  min?: string;
  /** Inclusive max date `YYYY-MM-DD`. */
  max?: string;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  className?: string;
};

const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
const MENU_GAP = 6;

function parseIsoDate(value: string): Date | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

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

/** Monday = 0 … Sunday = 6 */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function formatMonthYear(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatDisplay(value: string): string {
  const date = parseIsoDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

type DayCell = { date: Date; inMonth: boolean };

function buildMonthGrid(month: Date): DayCell[] {
  const year = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(year, m, 1);
  const lead = mondayIndex(first);
  const total = daysInMonth(year, m);
  const cells: DayCell[] = [];

  for (let i = lead - 1; i >= 0; i -= 1) {
    cells.push({ date: new Date(year, m, -i), inMonth: false });
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
 * Single-date popover picker. Value is `YYYY-MM-DD` (empty when unset).
 * Avoids native `<input type="date">` overflow on mobile locales.
 */
export function DatePicker({
  value,
  onChange,
  min,
  max,
  disabled = false,
  id,
  placeholder = "Select date",
  className,
}: DatePickerProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);

  const selected = useMemo(() => parseIsoDate(value), [value]);
  const minDate = useMemo(
    () => (min ? parseIsoDate(min) : null),
    [min]
  );
  const maxDate = useMemo(
    () => (max ? parseIsoDate(max) : null),
    [max]
  );
  const today = useMemo(() => startOfDay(new Date()), []);

  const [month, setMonth] = useState(() =>
    startOfMonth(selected ?? minDate ?? today)
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      setMonth(startOfMonth(selected ?? minDate ?? today));
    }
  }, [open, selected, minDate, today]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }

    function updatePosition() {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const estimatedHeight = 360;
      const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
      const spaceAbove = rect.top - MENU_GAP;
      const openUp =
        spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
      const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 16);

      setMenuStyle({
        position: "fixed",
        left: Math.min(rect.left, window.innerWidth - width - 8),
        width,
        zIndex: 200,
        ...(openUp
          ? {
              bottom: window.innerHeight - rect.top + MENU_GAP,
              top: "auto",
            }
          : {
              top: rect.bottom + MENU_GAP,
              bottom: "auto",
            }),
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        rootRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const cells = useMemo(() => buildMonthGrid(month), [month]);
  const display = formatDisplay(value);

  function selectDay(date: Date) {
    onChange(toIsoDate(date));
    setOpen(false);
  }

  const menu =
    open && mounted && menuStyle
      ? createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="dialog"
            aria-label="Choose date"
            style={menuStyle}
            className="overflow-hidden rounded-xl border border-border bg-white p-3 shadow-[0_12px_40px_rgba(0,0,0,0.12)]"
          >
            <div className="mb-3 flex items-center justify-between rounded-xl bg-surface px-2 py-2">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setMonth((m) => addMonths(m, -1))}
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
                onClick={() => setMonth((m) => addMonths(m, 1))}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-1 grid grid-cols-7">
              {WEEKDAYS.map((day) => (
                <div
                  key={day}
                  className="py-1 text-center text-[11px] font-medium uppercase tracking-wide text-text-muted"
                >
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {cells.map((cell) => {
                const { date, inMonth } = cell;
                const isSelected = selected ? sameDay(date, selected) : false;
                const isToday = sameDay(date, today);
                const tooEarly = minDate ? isBeforeDay(date, minDate) : false;
                const tooLate = maxDate ? isAfterDay(date, maxDate) : false;
                const isDisabled = !inMonth || tooEarly || tooLate;

                return (
                  <div
                    key={`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${inMonth}`}
                    className="flex items-center justify-center py-0.5"
                  >
                    <button
                      type="button"
                      disabled={isDisabled}
                      onClick={() => selectDay(date)}
                      className={cx(
                        "relative flex h-9 w-9 items-center justify-center rounded-lg text-sm transition-colors",
                        !inMonth && "text-text-muted/40",
                        inMonth &&
                          !isSelected &&
                          "text-text hover:bg-primary-tint",
                        isSelected && "bg-primary font-semibold text-white",
                        isDisabled && inMonth && "cursor-not-allowed opacity-40",
                        !inMonth && "pointer-events-none"
                      )}
                    >
                      {date.getDate()}
                      {isToday && inMonth && !isSelected ? (
                        <span className="absolute bottom-1 h-1 w-1 rounded-full bg-primary" />
                      ) : null}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={rootRef} className={cx("relative min-w-0 w-full", className)}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
        className={cx(
          "flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-border bg-white px-3 text-left text-sm outline-none transition-colors",
          "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20",
          disabled
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer hover:border-primary/25",
          open && "border-primary ring-2 ring-primary/20"
        )}
      >
        <CalendarDays
          className="h-4 w-4 shrink-0 text-text-muted"
          aria-hidden
        />
        <span
          className={cx(
            "min-w-0 flex-1 truncate",
            display ? "text-text" : "text-text-muted"
          )}
        >
          {display || placeholder}
        </span>
      </button>
      {menu}
    </div>
  );
}
