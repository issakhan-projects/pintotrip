"use client";

import { useMemo } from "react";
import { BedDouble, MapPin, Plane, type LucideIcon } from "lucide-react";
import type { SavedLocation } from "@/hooks/useLocations";
import type { TripPlannerDoc, TripRoute } from "@/types/trip-planner";
import { cx } from "@/lib/utils";
import { useI18n } from "@/i18n";
import {
  buildTripRouteTimeBreakdown,
  formatBreakdownDuration,
  type TimeBreakdownSegment,
} from "./routeTimeBreakdown";
import {
  computeApproximateTripCost,
  formatCurrencyAmountList,
  hasApproximateTripCost,
  type ApproximateTripCost,
} from "./approximateTripCost";
import { listTripAccommodations } from "./essentialsHelpers";

export function TripRouteTimeBreakdownSection({
  trip,
  routes,
  locations = [],
}: {
  trip: TripPlannerDoc;
  routes: TripRoute[];
  locations?: SavedLocation[];
}) {
  const { t } = useI18n();
  const breakdown = useMemo(
    () => buildTripRouteTimeBreakdown(routes, trip),
    [routes, trip]
  );

  const byId = useMemo(
    () => new Map(locations.map((location) => [location.id, location])),
    [locations]
  );

  const accommodations = useMemo(
    () => listTripAccommodations(trip),
    [trip]
  );

  const approximateCost = useMemo(
    () =>
      computeApproximateTripCost(
        trip.itinerary.days,
        byId,
        routes,
        accommodations
      ),
    [trip.itinerary.days, byId, routes, accommodations]
  );

  const showCost = hasApproximateTripCost(approximateCost);
  if (!breakdown && !showCost) return null;

  const primary = breakdown
    ? breakdown.segments.reduce((a, b) => (a.minutes >= b.minutes ? a : b))
    : null;
  const restMinutes =
    breakdown && primary
      ? Math.max(0, breakdown.totalMinutes - primary.minutes)
      : 0;
  const restPercent =
    breakdown && primary
      ? Math.round((100 - primary.percent) * 10) / 10
      : 0;

  return (
    <section className="rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm sm:p-5">
      {breakdown && primary ? (
        <>
          <div>
            <p className="text-sm text-text-secondary">
              {t("planner.timeBreakdown.total")}
            </p>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-text sm:text-3xl">
              {formatBreakdownDuration(breakdown.totalMinutes)}
            </p>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
              {t("planner.timeBreakdown.title")}
            </p>
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {breakdown.segments.map((segment) => (
                <li
                  key={segment.id}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-text-muted uppercase"
                >
                  <span
                    className={cx(
                      "h-2 w-2 shrink-0 rounded-full",
                      segment.colorClass
                    )}
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
            aria-label={breakdown.segments
              .map(
                (s) =>
                  `${s.label}: ${formatBreakdownDuration(s.minutes)} (${s.percent}%)`
              )
              .join(", ")}
          >
            {breakdown.segments.map((segment) => (
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
            {breakdown.segments.length > 1 && restMinutes > 0 ? (
              <p className="min-w-0 text-right">
                <span className="font-medium text-text">
                  {formatBreakdownDuration(restMinutes)}
                </span>
                <span className="text-text-muted"> · {restPercent}%</span>
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      {showCost ? (
        <ApproximateTripCostSummary
          cost={approximateCost}
          className={breakdown ? "mt-5 border-t border-border pt-4" : undefined}
        />
      ) : null}
    </section>
  );
}

function ApproximateTripCostSummary({
  cost,
  className,
}: {
  cost: ApproximateTripCost;
  className?: string;
}) {
  const { t } = useI18n();
  const hasPlaces = cost.places.length > 0;
  const hasTransport = cost.transport.length > 0;
  const hasAccommodation = cost.accommodation.length > 0;
  const totalLabel = formatCurrencyAmountList(cost.total);
  const categoryCount =
    Number(hasPlaces) + Number(hasTransport) + Number(hasAccommodation);
  const showSplit = categoryCount > 1;

  type CostRow = {
    key: string;
    label: string;
    count: number;
    amount: string;
    Icon: LucideIcon;
  };
  const rows: CostRow[] = [];
  if (hasPlaces) {
    rows.push({
      key: "places",
      label: t("planner.timeBreakdown.places"),
      count: cost.pricedPlaceCount,
      amount: formatCurrencyAmountList(cost.places),
      Icon: MapPin,
    });
  }
  if (hasTransport) {
    rows.push({
      key: "transport",
      label: t("planner.timeBreakdown.transport"),
      count: cost.pricedTransportCount,
      amount: formatCurrencyAmountList(cost.transport),
      Icon: Plane,
    });
  }
  if (hasAccommodation) {
    rows.push({
      key: "accommodation",
      label: t("planner.timeBreakdown.accommodation"),
      count: cost.pricedAccommodationCount,
      amount: formatCurrencyAmountList(cost.accommodation),
      Icon: BedDouble,
    });
  }

  const single = rows[0];

  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
          {t("planner.timeBreakdown.approxCost")}
        </p>
        {totalLabel ? (
          <p className="text-sm font-semibold tabular-nums text-text">
            ≈ {totalLabel}
          </p>
        ) : null}
      </div>
      {showSplit ? (
        <dl
          className={cx(
            "mt-2 grid gap-1.5 text-xs",
            rows.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"
          )}
        >
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex items-center justify-between gap-2 rounded-lg bg-surface px-2.5 py-2"
            >
              <dt className="inline-flex min-w-0 items-center gap-1.5 text-text-secondary">
                <row.Icon
                  className="h-3.5 w-3.5 shrink-0 text-primary"
                  aria-hidden
                />
                <span className="truncate">
                  {row.label}
                  <span className="text-text-muted"> · {row.count}</span>
                </span>
              </dt>
              <dd className="shrink-0 font-medium tabular-nums text-text">
                ≈ {row.amount}
              </dd>
            </div>
          ))}
        </dl>
      ) : single ? (
        <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-text-secondary">
          <single.Icon
            className="h-3.5 w-3.5 shrink-0 text-primary"
            aria-hidden
          />
          <span>
            {hasPlaces
              ? t(
                  cost.pricedPlaceCount === 1
                    ? "planner.timeBreakdown.fromPlaces_one"
                    : "planner.timeBreakdown.fromPlaces_other",
                  { count: cost.pricedPlaceCount }
                )
              : hasTransport
                ? t(
                    cost.pricedTransportCount === 1
                      ? "planner.timeBreakdown.fromTransport_one"
                      : "planner.timeBreakdown.fromTransport_other",
                    { count: cost.pricedTransportCount }
                  )
                : t(
                    cost.pricedAccommodationCount === 1
                      ? "planner.timeBreakdown.fromAccommodation_one"
                      : "planner.timeBreakdown.fromAccommodation_other",
                    { count: cost.pricedAccommodationCount }
                  )}
          </span>
        </p>
      ) : null}
      {showSplit ? (
        <p className="mt-2 text-[11px] text-text-muted">
          {t("planner.timeBreakdown.costHint")}
        </p>
      ) : null}
    </div>
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
