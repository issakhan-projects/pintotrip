import type { TimeFormat } from "@/types/user";

/** Resolve preference to Intl `hour12` (defaults to 24h). */
export function hour12FromTimeFormat(
  timeFormat?: TimeFormat | null
): boolean {
  return timeFormat === "12h";
}

/** Intl hour/minute options for the user's clock preference. */
export function clockIntlOptions(
  timeFormat?: TimeFormat | null
): Pick<Intl.DateTimeFormatOptions, "hour" | "minute" | "hour12"> {
  return {
    hour: "2-digit",
    minute: "2-digit",
    hour12: hour12FromTimeFormat(timeFormat),
  };
}

/**
 * Format hour (0–23) + minute for display.
 * Storage stays 24h `HH:mm`; this only affects UI labels.
 */
export function formatClockParts(
  hour: number,
  minute: number,
  timeFormat?: TimeFormat | null,
  locale?: string
): string {
  const safeHour = ((Math.floor(hour) % 24) + 24) % 24;
  const safeMinute = Math.min(59, Math.max(0, Math.floor(minute)));
  const date = new Date(2000, 0, 1, safeHour, safeMinute);
  return new Intl.DateTimeFormat(locale || undefined, clockIntlOptions(timeFormat)).format(
    date
  );
}

/** Hour column label for pickers (e.g. `14` or `2 PM`). */
export function formatHourLabel(
  hour: number,
  timeFormat?: TimeFormat | null
): string {
  const safeHour = ((Math.floor(hour) % 24) + 24) % 24;
  if (timeFormat !== "12h") return String(safeHour).padStart(2, "0");
  const h12 = safeHour % 12 === 0 ? 12 : safeHour % 12;
  return `${h12} ${safeHour < 12 ? "AM" : "PM"}`;
}

/**
 * Format a stored `HH:mm` (24h) string for display.
 * Returns the original string when parsing fails.
 */
export function formatHhMmDisplay(
  value: string | null | undefined,
  timeFormat?: TimeFormat | null,
  locale?: string
): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return trimmed;
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
    return trimmed;
  }
  return formatClockParts(hour, minute, timeFormat, locale);
}

/**
 * Format a `YYYY-MM-DDTHH:mm` local datetime for display (date + clock).
 */
export function formatDatetimeLocalDisplay(
  value: string | null | undefined,
  timeFormat?: TimeFormat | null,
  locale?: string
): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return trimmed;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5])
  );
  if (Number.isNaN(date.getTime())) return trimmed;
  return new Intl.DateTimeFormat(locale || undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...clockIntlOptions(timeFormat),
  }).format(date);
}
