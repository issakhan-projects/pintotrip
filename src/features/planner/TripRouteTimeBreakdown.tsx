"use client";

import { useMemo } from "react";
import type { TripPlannerDoc, TripRoute } from "@/types/trip-planner";
import { cx } from "@/lib/utils";
import { useI18n } from "@/i18n";
import {
  buildTripRouteTimeBreakdown,
  formatBreakdownDuration,
  type TimeBreakdownSegment,
} from "./routeTimeBreakdown";

export function TripRouteTimeBreakdownSection({
  trip,
  routes,
}: {
  trip: TripPlannerDoc;
  routes: TripRoute[];
}) {
  const { t } = useI18n();
  const breakdown = useMemo(
    () => buildTripRouteTimeBreakdown(routes, trip),
    [routes, trip]
  );

  if (!breakdown) return null;

  const { totalMinutes, segments } = breakdown;
  const primary = segments.reduce((a, b) => (a.minutes >= b.minutes ? a : b));
  const restMinutes = Math.max(0, totalMinutes - primary.minutes);
  const restPercent =
    Math.round((100 - primary.percent) * 10) / 10;

  return (
    <section className="rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm sm:p-5">
      <div>
        <p className="text-sm text-text-secondary">{t("planner.timeBreakdown.total")}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight text-text sm:text-3xl">
          {formatBreakdownDuration(totalMinutes)}
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
          {t("planner.timeBreakdown.title")}
        </p>
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {segments.map((segment) => (
            <li
              key={segment.id}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-text-muted uppercase"
            >
              <span
                className={cx("h-2 w-2 shrink-0 rounded-full", segment.colorClass)}
                aria-hidden
              />
              {segment.label}
            </li>
          ))}
        </ul>
      </div>

      <div
        className="mt-3 flex h-3.5 w-full gap-1"
        role="img"
        aria-label={segments
          .map(
            (s) =>
              `${s.label}: ${formatBreakdownDuration(s.minutes)} (${s.percent}%)`
          )
          .join(", ")}
      >
        {segments.map((segment) => (
          <BreakdownBarSegment key={segment.id} segment={segment} />
        ))}
      </div>

      <div className="mt-2.5 flex items-start justify-between gap-3 text-sm">
        <p className="min-w-0 text-left">
          <span className="font-medium text-text">
            {formatBreakdownDuration(primary.minutes)}
          </span>
          <span className="text-text-muted">
            {" "}
            · {primary.percent}%
          </span>
        </p>
        {segments.length > 1 && restMinutes > 0 ? (
          <p className="min-w-0 text-right">
            <span className="font-medium text-text">
              {formatBreakdownDuration(restMinutes)}
            </span>
            <span className="text-text-muted"> · {restPercent}%</span>
          </p>
        ) : null}
      </div>
    </section>
  );
}

function BreakdownBarSegment({ segment }: { segment: TimeBreakdownSegment }) {
  const flexGrow = Math.max(segment.percent, 0.5);
  return (
    <div
      className={cx("h-full min-w-[6px] rounded-full", segment.colorClass)}
      style={{ flexGrow, flexBasis: 0 }}
      title={`${segment.label}: ${formatBreakdownDuration(segment.minutes)} (${segment.percent}%)`}
    />
  );
}
