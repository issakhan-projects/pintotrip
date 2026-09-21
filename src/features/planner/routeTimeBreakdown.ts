/** Aggregate route durations into a trip time breakdown (transit + leisure). */

import type { TripPlannerDoc, TripRoute, TripRouteTransport } from "@/types/trip-planner";
import { gapMinutesBetween } from "./timelineHelpers";

const MEANINGFUL_GAP_MINUTES = 45;

export type TimeBreakdownKind = TripRouteTransport | "leisure";

export type TimeBreakdownSegment = {
  id: TimeBreakdownKind;
  label: string;
  minutes: number;
  percent: number;
  /** Tailwind background class for the bar segment / legend dot. */
  colorClass: string;
};

export type TripRouteTimeBreakdown = {
  totalMinutes: number;
  segments: TimeBreakdownSegment[];
};

const TRANSPORT_META: Record<
  TripRouteTransport,
  { label: string; colorClass: string }
> = {
  flight: { label: "Flight", colorClass: "bg-primary" },
  train: { label: "Train", colorClass: "bg-success" },
  bus: { label: "Bus", colorClass: "bg-warning" },
  metro: { label: "Metro", colorClass: "bg-sky-500" },
  taxi: { label: "Taxi", colorClass: "bg-orange-400" },
  airport_transfer: { label: "Airport transfer", colorClass: "bg-orange-500" },
  car: { label: "Car", colorClass: "bg-amber-600" },
  ferry: { label: "Ferry", colorClass: "bg-cyan-500" },
  other: { label: "Other", colorClass: "bg-text-muted" },
};

const LEISURE_META = {
  label: "Leisure",
  colorClass: "bg-rose-400",
} as const;

const TRANSPORT_ORDER: TripRouteTransport[] = [
  "flight",
  "train",
  "bus",
  "metro",
  "taxi",
  "airport_transfer",
  "car",
  "ferry",
  "other",
];

/** Human duration like "16 hr 30 min" / "45 min". */
export function formatBreakdownDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

function formatPercent(part: number, total: number): number {
  if (total <= 0 || part <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/**
 * Build a time breakdown from filled routes.
 * Transit = sum of `durationMinutes` by transport.
 * Leisure = free time between legs (arrival → next departure, ≥45m).
 */
export function buildTripRouteTimeBreakdown(
  routes: TripRoute[],
  _trip?: TripPlannerDoc
): TripRouteTimeBreakdown | null {
  if (routes.length === 0) return null;

  const ordered = [...routes].sort((a, b) => a.order - b.order);
  const byTransport = new Map<TripRouteTransport, number>();

  for (const route of ordered) {
    const minutes = route.durationMinutes;
    if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) continue;
    const rounded = Math.round(minutes);
    byTransport.set(
      route.transport,
      (byTransport.get(route.transport) ?? 0) + rounded
    );
  }

  let transitMinutes = 0;
  for (const value of byTransport.values()) transitMinutes += value;

  let leisureMinutes = 0;
  for (let i = 0; i < ordered.length - 1; i++) {
    const gap = gapMinutesBetween(
      ordered[i]?.arrival?.datetime,
      ordered[i + 1]?.departure?.datetime
    );
    if (gap != null && gap >= MEANINGFUL_GAP_MINUTES) {
      leisureMinutes += gap;
    }
  }

  const totalMinutes = transitMinutes + leisureMinutes;
  if (totalMinutes <= 0) return null;

  const segments: TimeBreakdownSegment[] = [];

  for (const transport of TRANSPORT_ORDER) {
    const minutes = byTransport.get(transport) ?? 0;
    if (minutes <= 0) continue;
    const meta = TRANSPORT_META[transport];
    segments.push({
      id: transport,
      label: meta.label,
      minutes,
      percent: formatPercent(minutes, totalMinutes),
      colorClass: meta.colorClass,
    });
  }

  if (leisureMinutes > 0) {
    segments.push({
      id: "leisure",
      label: LEISURE_META.label,
      minutes: leisureMinutes,
      percent: formatPercent(leisureMinutes, totalMinutes),
      colorClass: LEISURE_META.colorClass,
    });
  }

  if (segments.length === 0) return null;

  const percentSum = segments.reduce((sum, s) => sum + s.percent, 0);
  if (Math.abs(percentSum - 100) >= 0.1) {
    const largest = segments.reduce((a, b) => (a.minutes >= b.minutes ? a : b));
    largest.percent =
      Math.round((largest.percent + (100 - percentSum)) * 10) / 10;
  }

  return { totalMinutes, segments };
}
