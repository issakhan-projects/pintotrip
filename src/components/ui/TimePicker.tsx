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
import { Clock } from "lucide-react";
import { cx } from "@/lib/utils";
import { formatHhMmDisplay, formatHourLabel } from "@/lib/time/formatClock";
import type { TimeFormat } from "@/types/user";

export type TimePickerProps = {
  value: string;
  onChange: (value: string) => void;
  /** Inclusive min time `HH:mm` (same calendar day). */
  min?: string;
  /** Inclusive max time `HH:mm` (same calendar day). */
  max?: string;
  /** Minute step (default 5). */
  stepMinutes?: number;
  /** Display preference for the closed trigger (value storage stays 24h). */
  timeFormat?: TimeFormat | null;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  className?: string;
};

const MENU_GAP = 6;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DEFAULT_STEP = 5;

function parseTime(value: string): { hour: number; minute: number } | null {
  const match = value.trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  return { hour, minute };
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function minutesOfDay(value: string): number | null {
  const parsed = parseTime(value);
  if (!parsed) return null;
  return parsed.hour * 60 + parsed.minute;
}

function buildMinutes(step: number): number[] {
  const safe = Math.max(1, Math.min(30, Math.floor(step)));
  const out: number[] = [];
  for (let m = 0; m < 60; m += safe) out.push(m);
  return out;
}

function nearestMinute(minute: number, options: number[]): number {
  let best = options[0] ?? 0;
  let bestDist = Math.abs(minute - best);
  for (const option of options) {
    const dist = Math.abs(minute - option);
    if (dist < bestDist) {
      best = option;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Popover time picker. Value is `HH:mm` (empty when unset).
 * Avoids native `<input type="time">` overflow on mobile.
 */
export function TimePicker({
  value,
  onChange,
  min,
  max,
  stepMinutes = DEFAULT_STEP,
  timeFormat = "24h",
  disabled = false,
  id,
  placeholder = "Select time",
  className,
}: TimePickerProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const hourListRef = useRef<HTMLDivElement>(null);
  const minuteListRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);

  const minutes = useMemo(
    () => buildMinutes(stepMinutes),
    [stepMinutes]
  );

  const parsed = useMemo(() => parseTime(value), [value]);
  const [draftHour, setDraftHour] = useState(parsed?.hour ?? 9);
  const [draftMinute, setDraftMinute] = useState(() =>
    nearestMinute(parsed?.minute ?? 0, minutes)
  );

  const minMins = useMemo(() => (min ? minutesOfDay(min) : null), [min]);
  const maxMins = useMemo(() => (max ? minutesOfDay(max) : null), [max]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const nextHour = parsed?.hour ?? 9;
    const nextMinute = nearestMinute(parsed?.minute ?? 0, minutes);
    setDraftHour(nextHour);
    setDraftMinute(nextMinute);
    window.setTimeout(() => {
      const hourEl = hourListRef.current?.querySelector<HTMLElement>(
        `[data-hour="${nextHour}"]`
      );
      const minuteEl = minuteListRef.current?.querySelector<HTMLElement>(
        `[data-minute="${nextMinute}"]`
      );
      hourEl?.scrollIntoView({ block: "center" });
      minuteEl?.scrollIntoView({ block: "center" });
    }, 0);
  }, [open, parsed, minutes]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }

    function updatePosition() {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const estimatedHeight = 280;
      const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
      const spaceAbove = rect.top - MENU_GAP;
      const openUp =
        spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
      const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 16);

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

  function isAllowed(hour: number, minute: number): boolean {
    const total = hour * 60 + minute;
    if (minMins != null && total < minMins) return false;
    if (maxMins != null && total > maxMins) return false;
    return true;
  }

  function commit(hour: number, minute: number) {
    if (!isAllowed(hour, minute)) return;
    onChange(formatTime(hour, minute));
    setOpen(false);
  }

  const display = parsed
    ? formatHhMmDisplay(formatTime(parsed.hour, parsed.minute), timeFormat)
    : "";

  const menu =
    open && mounted && menuStyle
      ? createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="dialog"
            aria-label="Choose time"
            style={menuStyle}
            className="overflow-hidden rounded-xl border border-border bg-white shadow-[0_12px_40px_rgba(0,0,0,0.12)]"
          >
            <div className="grid grid-cols-2 border-b border-border bg-surface text-center text-[11px] font-medium uppercase tracking-wide text-text-muted">
              <div className="px-2 py-2">Hour</div>
              <div className="px-2 py-2">Minute</div>
            </div>
            <div className="grid grid-cols-2">
              <div
                ref={hourListRef}
                className="max-h-52 overflow-y-auto overscroll-contain border-r border-border py-1"
              >
                {HOURS.map((hour) => {
                  const anyMinuteAllowed = minutes.some((minute) =>
                    isAllowed(hour, minute)
                  );
                  const active = draftHour === hour;
                  return (
                    <button
                      key={hour}
                      type="button"
                      data-hour={hour}
                      disabled={!anyMinuteAllowed}
                      onClick={() => {
                        setDraftHour(hour);
                        // Keep open so the user can pick minutes next.
                        if (!isAllowed(hour, draftMinute)) {
                          const fallback = minutes.find((m) =>
                            isAllowed(hour, m)
                          );
                          if (fallback != null) setDraftMinute(fallback);
                        }
                      }}
                      className={cx(
                        "flex w-full items-center justify-center px-2 py-2 text-sm tabular-nums transition-colors",
                        active
                          ? "bg-primary-tint font-semibold text-primary"
                          : "text-text hover:bg-surface",
                        !anyMinuteAllowed && "cursor-not-allowed opacity-35"
                      )}
                    >
                      {formatHourLabel(hour, timeFormat)}
                    </button>
                  );
                })}
              </div>
              <div
                ref={minuteListRef}
                className="max-h-52 overflow-y-auto overscroll-contain py-1"
              >
                {minutes.map((minute) => {
                  const allowed = isAllowed(draftHour, minute);
                  const active = draftMinute === minute;
                  return (
                    <button
                      key={minute}
                      type="button"
                      data-minute={minute}
                      disabled={!allowed}
                      onClick={() => {
                        setDraftMinute(minute);
                        commit(draftHour, minute);
                      }}
                      className={cx(
                        "flex w-full items-center justify-center px-2 py-2 text-sm tabular-nums transition-colors",
                        active
                          ? "bg-primary-tint font-semibold text-primary"
                          : "text-text hover:bg-surface",
                        !allowed && "cursor-not-allowed opacity-35"
                      )}
                    >
                      {String(minute).padStart(2, "0")}
                    </button>
                  );
                })}
              </div>
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
        <Clock className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
        <span
          className={cx(
            "min-w-0 flex-1 truncate tabular-nums",
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
