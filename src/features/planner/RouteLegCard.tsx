"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Bus,
  Car,
  Check,
  ChevronDown,
  Clock,
  FileText,
  Footprints,
  Plane,
  Ship,
  Train,
  TrainFront,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import { cx } from "@/lib/utils";
import type {
  RoutePoint,
  TripRoute,
  TripRouteStatus,
  TripRouteTransport,
} from "@/types/trip-planner";
import { airlineIconUrlForName } from "./airlines";
import {
  durationMinutesBetween,
  formatRouteDuration,
  formatRouteWhen,
  isExactScheduleTransport,
} from "./routeHelpers";

export const ROUTE_TRANSPORT_ICON: Record<TripRouteTransport, LucideIcon> = {
  flight: Plane,
  train: TrainFront,
  bus: Bus,
  metro: Train,
  taxi: Car,
  airport_transfer: Car,
  car: Car,
  ferry: Ship,
  other: Footprints,
};

export const ROUTE_TRANSPORT_LABEL: Record<TripRouteTransport, string> = {
  flight: "Flight",
  train: "Train",
  bus: "Bus",
  metro: "Metro",
  taxi: "Taxi",
  airport_transfer: "Airport transfer",
  car: "Car",
  ferry: "Ferry",
  other: "Other",
};

export const ROUTE_TRANSPORT_ACCENT: Record<
  TripRouteTransport,
  { iconWrap: string; icon: string }
> = {
  flight: {
    iconWrap: "bg-primary-tint",
    icon: "text-primary",
  },
  train: {
    iconWrap: "bg-primary-tint",
    icon: "text-primary",
  },
  bus: {
    iconWrap: "bg-warning-background",
    icon: "text-warning",
  },
  metro: {
    iconWrap: "bg-primary-tint",
    icon: "text-primary",
  },
  taxi: {
    iconWrap: "bg-warning-background",
    icon: "text-warning",
  },
  airport_transfer: {
    iconWrap: "bg-warning-background",
    icon: "text-warning",
  },
  car: {
    iconWrap: "bg-warning-background",
    icon: "text-warning",
  },
  ferry: {
    iconWrap: "bg-primary-tint",
    icon: "text-primary",
  },
  other: {
    iconWrap: "bg-surface",
    icon: "text-text-secondary",
  },
};

export const ROUTE_STATUS_UI: Record<
  TripRouteStatus,
  { label: string; className: string; Icon: LucideIcon }
> = {
  planned: {
    label: "Planned",
    className: "bg-primary-tint text-primary",
    Icon: Clock,
  },
  in_progress: {
    label: "In progress",
    className: "bg-warning-background text-warning",
    Icon: Clock,
  },
  done: {
    label: "Done",
    className: "bg-success-background text-success",
    Icon: Check,
  },
};

function pointPrimaryLabel(
  point: RoutePoint,
  transport: TripRouteTransport
): string {
  const code = point.code?.trim().toUpperCase();
  const city = point.city?.trim();
  const name = point.name?.trim();
  if (transport === "flight") {
    if (city && code) return `${city} (${code})`;
    if (city) return city;
    if (name && code) return `${name} (${code})`;
    return name || code || "Unknown";
  }
  return name || (city && code ? `${city} (${code})` : city) || "Unknown";
}

function pointSecondaryLabel(
  point: RoutePoint,
  transport: TripRouteTransport
): string | null {
  const name = point.name?.trim();
  const city = point.city?.trim();
  if (transport === "flight") {
    if (name && city && name.toLowerCase() !== city.toLowerCase()) return name;
    return null;
  }
  if (city && name && name.toLowerCase() !== city.toLowerCase()) {
    return `→ ${city}`;
  }
  if (city && !name) return city;
  return null;
}

function transportSubtitle(route: TripRoute): string | null {
  if (route.transport === "flight") return null;
  const fromName = route.from.name?.trim() || "";
  const fromCode = route.from.code?.trim();
  const looksAirport =
    Boolean(fromCode) || /airport|terminal/i.test(fromName);
  if (
    (route.transport === "taxi" ||
      route.transport === "car" ||
      route.transport === "bus") &&
    looksAirport
  ) {
    return "Airport transfer";
  }
  if (route.transport === "train" || route.transport === "metro") {
    return "Rail";
  }
  if (route.transport === "ferry") return "Sea transfer";
  return null;
}

function airlineInitials(airline: string): string {
  const parts = airline.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function AirlineBadge({ airline }: { airline: string }) {
  const iconUrl = airlineIconUrlForName(airline);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [iconUrl]);

  if (iconUrl && !failed) {
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-border"
        aria-hidden
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- remote airline CDN logo */}
        <img
          src={iconUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-5 w-5 object-contain"
        />
      </span>
    );
  }

  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface text-[10px] font-bold tracking-wide text-text ring-1 ring-border"
      aria-hidden
    >
      {airlineInitials(airline)}
    </span>
  );
}

function RouteEndpoint({
  point,
  transport,
  when,
  approximate,
  align = "left",
}: {
  point: RoutePoint;
  transport: TripRouteTransport;
  when: string | null;
  approximate?: boolean;
  align?: "left" | "right";
}) {
  const primary = pointPrimaryLabel(point, transport);
  const secondary = pointSecondaryLabel(point, transport);
  const right = align === "right";

  return (
    <div
      className={cx(
        "min-w-0 flex-1",
        right ? "text-right sm:text-right" : "text-left"
      )}
    >
      {when ? (
        <p className="text-lg font-semibold tabular-nums tracking-tight text-text sm:text-xl">
          {when}
          {approximate ? (
            <span className="ml-1 text-xs font-medium text-primary">
              (est.)
            </span>
          ) : null}
        </p>
      ) : (
        <p className="text-sm font-medium text-text-muted">Time TBD</p>
      )}
      <p
        className={cx(
          "mt-1 truncate text-sm font-semibold text-text",
          right && "sm:ml-auto"
        )}
      >
        {primary}
      </p>
      {secondary ? (
        <p className="mt-0.5 truncate text-xs text-text-secondary">
          {secondary}
        </p>
      ) : null}
    </div>
  );
}

function RouteConnector({
  route,
  duration,
}: {
  route: TripRoute;
  duration: string | null;
}) {
  const isFlight = route.transport === "flight";
  const estimated = Boolean(route.durationApproximate) || !isFlight;

  return (
    <div className="flex w-full max-w-[7.5rem] shrink-0 flex-col items-center px-2 sm:max-w-[9rem]">
      {duration ? (
        <p className="text-[11px] font-medium tabular-nums text-text-secondary">
          {duration}
        </p>
      ) : (
        <span className="h-4" aria-hidden />
      )}
      <div className="relative mt-1.5 flex w-full items-center" aria-hidden>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
        <span
          className={cx(
            "mx-1 h-0 flex-1 border-t",
            isFlight
              ? "border-dashed border-border"
              : "border-solid border-border"
          )}
        />
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
      </div>
      <p className="mt-1.5 text-[11px] font-medium text-text-muted">
        {isFlight ? "Nonstop" : estimated ? "Estimated" : "Direct"}
      </p>
    </div>
  );
}

export function RouteLegCard({
  route,
  actions,
  className,
}: {
  route: TripRoute;
  /** Optional trailing actions (menu, etc.). */
  actions?: ReactNode;
  className?: string;
}) {
  const Icon = ROUTE_TRANSPORT_ICON[route.transport] ?? Footprints;
  const accent = ROUTE_TRANSPORT_ACCENT[route.transport];
  const status = ROUTE_STATUS_UI[route.status];
  const StatusIcon = status.Icon;
  const done = route.status === "done";
  const isFlight = route.transport === "flight";
  const exactSchedule = isExactScheduleTransport(route.transport);
  const dep = formatRouteWhen(
    route.departure?.datetime,
    route.departure?.timezone,
    route.departure?.timeKnown
  );
  const arr = formatRouteWhen(
    route.arrival?.datetime,
    route.arrival?.timezone,
    route.arrival?.timeKnown
  );
  // Flights/trains: duration from absolute instants only when both times are known.
  const durationMinutes =
    exactSchedule &&
    !route.durationApproximate &&
    route.departure?.timeKnown !== false &&
    route.arrival?.timeKnown !== false
      ? (durationMinutesBetween(
          route.departure?.datetime,
          route.arrival?.datetime
        ) ?? route.durationMinutes)
      : route.durationMinutes;
  const duration = formatRouteDuration(
    durationMinutes,
    Boolean(route.durationApproximate)
  );
  const airline = route.airline?.trim() || "";
  const flightNumber = route.flightNumber?.trim().toUpperCase() || "";
  const subtitle = transportSubtitle(route);
  const note = route.note?.trim() || "";
  const [detailsOpen, setDetailsOpen] = useState(false);

  const brandSubtitle = isFlight ? flightNumber || null : subtitle;

  const flightFooterMeta = [flightNumber, airline].filter(Boolean).join(" · ");
  const showFlightFooter = isFlight && Boolean(flightFooterMeta || note);
  const priceLabel =
    route.priceLabel?.trim() ||
    (route.priceAmount != null
      ? route.priceAmount === 0
        ? "Free"
        : `${route.priceAmount}${
            route.priceCurrency ? ` ${route.priceCurrency}` : ""
          }`
      : null);
  const transferLink = route.link?.trim() || null;
  const showNoteFooter = !isFlight;
  const hasNoteMeta = Boolean(note || priceLabel || transferLink);

  return (
    <article
      className={cx(
        "overflow-hidden rounded-xl border border-border bg-white shadow-sm",
        done && "opacity-90",
        className
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface/40 px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cx(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
              accent.iconWrap,
              accent.icon
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text">
              {ROUTE_TRANSPORT_LABEL[route.transport]}
            </p>
            {isFlight && (airline || flightNumber) ? (
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                {airline ? <AirlineBadge airline={airline} /> : null}
                <p className="truncate text-xs text-text-secondary">
                  {[airline, flightNumber].filter(Boolean).join(" · ")}
                </p>
              </div>
            ) : brandSubtitle ? (
              <p className="truncate text-xs text-text-secondary">
                {brandSubtitle}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isFlight ? (
            <span
              className={cx(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                status.className
              )}
            >
              <StatusIcon className="h-3 w-3" strokeWidth={2.5} aria-hidden />
              {status.label}
            </span>
          ) : null}
          {actions}
        </div>
      </header>

      <div className="flex items-start gap-2 px-4 py-4 sm:items-center sm:gap-3 sm:px-5 sm:py-5">
        <RouteEndpoint
          point={route.from}
          transport={route.transport}
          when={dep}
        />
        <RouteConnector route={route} duration={duration} />
        <RouteEndpoint
          point={route.to}
          transport={route.transport}
          when={arr}
          approximate={Boolean(route.durationApproximate) && !isFlight}
          align="right"
        />
      </div>

      {showFlightFooter ? (
        <div className="border-t border-border bg-surface/50">
          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left sm:px-5"
            aria-expanded={detailsOpen}
          >
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary">
              <ChevronDown
                className={cx(
                  "h-3.5 w-3.5 transition-transform",
                  detailsOpen && "rotate-180"
                )}
                aria-hidden
              />
              Flight details
            </span>
            {flightFooterMeta ? (
              <span className="truncate text-xs text-text-muted">
                {flightFooterMeta}
              </span>
            ) : null}
          </button>
          {detailsOpen && note ? (
            <div className="flex items-start gap-2 border-t border-border/70 px-4 py-2.5 sm:px-5">
              <FileText
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted"
                aria-hidden
              />
              <p className="text-xs leading-relaxed text-text-secondary">
                {note}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {showNoteFooter ? (
        <div
          className={cx(
            "flex items-start gap-3 border-t border-border bg-surface/50 px-4 py-2.5 sm:px-5",
            hasNoteMeta ? "justify-between" : "justify-end"
          )}
        >
          {hasNoteMeta ? (
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {(priceLabel || transferLink) && (
                <div className="flex flex-wrap items-center gap-2">
                  {priceLabel ? (
                    <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-text ring-1 ring-border">
                      {priceLabel}
                    </span>
                  ) : null}
                  {transferLink ? (
                    <a
                      href={transferLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" aria-hidden />
                      Book / info
                    </a>
                  ) : null}
                </div>
              )}
              {note ? (
                <div className="flex items-start gap-2">
                  <FileText
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted"
                    aria-hidden
                  />
                  <p className="text-xs leading-relaxed text-text-secondary">
                    <span className="font-medium text-text-secondary">
                      Note:
                    </span>{" "}
                    {note}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
          <span
            className={cx(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
              status.className
            )}
          >
            <StatusIcon className="h-3 w-3" strokeWidth={2.5} aria-hidden />
            {status.label}
          </span>
        </div>
      ) : null}
    </article>
  );
}
