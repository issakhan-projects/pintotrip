"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Bus,
  Car,
  Check,
  ChevronRight,
  ClipboardList,
  Clock,
  ExternalLink,
  FileText,
  Footprints,
  Plane,
  Ship,
  Train,
  TrainFront,
  type LucideIcon,
} from "lucide-react";
import { cx } from "@/lib/utils";
import { useTimeFormat } from "@/hooks/useTimeFormat";
import type {
  RoutePoint,
  TripRoute,
  TripRouteAttachment,
  TripRouteStatus,
  TripRouteTransport,
} from "@/types/trip-planner";
import { airlineIconUrlForName } from "./airlines";
import {
  durationMinutesBetween,
  formatRouteClock,
  formatRouteDateLabel,
  formatRouteDuration,
  isExactScheduleTransport,
  routeArrivalDayOffset,
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

const DETAILS_LABEL: Record<TripRouteTransport, string> = {
  flight: "Flight details",
  train: "Train details",
  bus: "Bus details",
  metro: "Metro details",
  taxi: "Transfer details",
  airport_transfer: "Transfer details",
  car: "Drive details",
  ferry: "Ferry details",
  other: "Trip details",
};

function headerPointLabel(
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

  if (transport === "train" || transport === "metro") {
    if (city && code) return `${city} (${code})`;
    if (name && city && name.toLowerCase() !== city.toLowerCase()) {
      return `${city} · ${name}`;
    }
    return name || city || code || "Unknown";
  }

  if (name && city && name.toLowerCase() !== city.toLowerCase()) {
    return `${city} · ${name}`;
  }
  return name || city || "Unknown";
}

function endpointCode(
  point: RoutePoint,
  transport: TripRouteTransport
): string | null {
  const code = point.code?.trim().toUpperCase();
  if (code) return code;
  if (transport === "flight") return null;
  const city = point.city?.trim();
  const name = point.name?.trim();
  if (transport === "train" || transport === "metro") {
    return name || city || null;
  }
  // Keep codes short under the clock — prefer city over long place names.
  if (city) return city;
  if (name && name.length <= 18) return name;
  return null;
}

function airlineInitials(airline: string): string {
  const parts = airline.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function AirlineBadge({
  airline,
  size = "md",
}: {
  airline: string;
  size?: "sm" | "md";
}) {
  const iconUrl = airlineIconUrlForName(airline);
  const [failed, setFailed] = useState(false);
  const box = size === "sm" ? "h-5 w-5" : "h-7 w-7";
  const img = size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5";
  const text = size === "sm" ? "text-[8px]" : "text-[10px]";

  useEffect(() => {
    setFailed(false);
  }, [iconUrl]);

  if (iconUrl && !failed) {
    return (
      <span
        className={cx(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-border",
          box
        )}
        aria-hidden
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- remote airline CDN logo */}
        <img
          src={iconUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={cx("object-contain", img)}
        />
      </span>
    );
  }

  return (
    <span
      className={cx(
        "flex shrink-0 items-center justify-center rounded-full bg-surface font-bold tracking-wide text-text ring-1 ring-border",
        box,
        text
      )}
      aria-hidden
    >
      {airlineInitials(airline)}
    </span>
  );
}

function TimeBlock({
  time,
  code,
  dayOffset,
  approximate,
  align = "left",
}: {
  time: string | null;
  code: string | null;
  dayOffset?: number | null;
  approximate?: boolean;
  align?: "left" | "right";
}) {
  const right = align === "right";
  return (
    <div className={cx("min-w-[3.25rem] shrink-0", right && "text-right")}>
      {time ? (
        <p
          className={cx(
            "text-xl font-semibold tabular-nums tracking-tight text-text sm:text-2xl",
            right ? "justify-end" : "justify-start",
            "inline-flex items-start"
          )}
        >
          <span>{time}</span>
          {dayOffset != null && dayOffset !== 0 ? (
            <span className="ml-0.5 mt-0.5 text-[10px] font-semibold leading-none text-text-muted">
              {dayOffset > 0 ? `+${dayOffset}` : dayOffset}
            </span>
          ) : null}
          {approximate ? (
            <span className="ml-1 mt-1 text-[10px] font-medium text-primary">
              est.
            </span>
          ) : null}
        </p>
      ) : (
        <p className="text-sm font-medium text-text-muted">TBD</p>
      )}
      {code ? (
        <p className="mt-0.5 truncate text-xs font-medium text-text-secondary">
          {code}
        </p>
      ) : null}
    </div>
  );
}

function RouteConnector({
  duration,
  hint,
}: {
  duration: string | null;
  hint?: string | null;
}) {
  const label = [duration, hint].filter(Boolean).join(", ");
  return (
    <div className="mx-2 flex min-w-0 flex-1 flex-col items-center px-1 sm:mx-4">
      {label ? (
        <p className="max-w-full truncate text-center text-[11px] font-medium text-text-secondary">
          {label}
        </p>
      ) : (
        <span className="h-4" aria-hidden />
      )}
      <div className="relative mt-1.5 flex w-full max-w-[11rem] items-center" aria-hidden>
        <span className="h-2 w-2 shrink-0 rounded-full border-[1.5px] border-border bg-white" />
        <span className="mx-0.5 h-px flex-1 bg-border" />
        <ChevronRight className="h-3.5 w-3.5 shrink-0 -translate-x-0.5 text-border" strokeWidth={2.5} />
      </div>
    </div>
  );
}

export function RouteLegCard({
  route,
  index,
  actions,
  className,
}: {
  route: TripRoute;
  /** 1-based position in the list (shown as `1.`). */
  index?: number;
  /** Optional trailing actions (menu, etc.). */
  actions?: ReactNode;
  className?: string;
}) {
  const timeFormat = useTimeFormat();
  const done = route.status === "done";
  const status = ROUTE_STATUS_UI[route.status];
  const StatusIcon = status.Icon;
  const isFlight = route.transport === "flight";
  const exactSchedule = isExactScheduleTransport(route.transport);
  const depTime = formatRouteClock(
    route.departure?.datetime,
    route.departure?.timezone,
    route.departure?.timeKnown,
    timeFormat
  );
  const arrTime = formatRouteClock(
    route.arrival?.datetime,
    route.arrival?.timezone,
    route.arrival?.timeKnown,
    timeFormat
  );
  const dateLabel = formatRouteDateLabel(
    route.departure?.datetime,
    route.departure?.timezone
  );
  const dayOffset = routeArrivalDayOffset(
    route.departure?.datetime,
    route.departure?.timezone,
    route.arrival?.datetime,
    route.arrival?.timezone
  );
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
  const note = route.note?.trim() || "";
  const [detailsOpen, setDetailsOpen] = useState(false);

  const fromLabel = headerPointLabel(route.from, route.transport);
  const toLabel = headerPointLabel(route.to, route.transport);
  const fromCode = endpointCode(route.from, route.transport);
  const toCode = endpointCode(route.to, route.transport);

  const connectorHint =
    !isFlight && route.durationApproximate ? "Estimated" : null;

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
  const attachments = route.attachments ?? [];
  const hasExpandableDetails = Boolean(
    note ||
      priceLabel ||
      transferLink ||
      (isFlight && (airline || flightNumber)) ||
      (!isFlight && route.status !== "planned")
  );

  const showOperator = isFlight && Boolean(airline);
  const showNonFlightFooter =
    !isFlight && Boolean(priceLabel || transferLink || note || done);

  function renderDetailsButton() {
    return (
      <button
        type="button"
        onClick={() => setDetailsOpen((open) => !open)}
        className={cx(
          "inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text transition-colors hover:text-primary",
          detailsOpen && "text-primary"
        )}
        aria-expanded={detailsOpen}
      >
        <ClipboardList className="h-3.5 w-3.5" aria-hidden />
        {DETAILS_LABEL[route.transport]}
      </button>
    );
  }

  return (
    <article
      className={cx(
        "overflow-hidden rounded-xl border border-border bg-white",
        done && "opacity-90",
        className
      )}
    >
      <header className="px-4 py-3 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-2">
              {index != null ? (
                <span className="shrink-0 text-sm font-medium tabular-nums text-text-muted">
                  {index}.
                </span>
              ) : null}
              <p className="min-w-0 text-sm font-semibold leading-snug text-text sm:text-[15px]">
                <span className="break-words">{fromLabel}</span>
                <span className="mx-1.5 font-normal text-text-muted" aria-hidden>
                  →
                </span>
                <span className="break-words">{toLabel}</span>
              </p>
            </div>
            {/* Mobile: date under the route title */}
            {dateLabel ? (
              <p className="mt-1.5 text-sm font-semibold text-text sm:hidden">
                {dateLabel}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Desktop: date on the right next to actions */}
            {dateLabel ? (
              <p className="hidden whitespace-nowrap text-sm font-semibold text-text sm:block">
                {dateLabel}
              </p>
            ) : null}
            {actions}
          </div>
        </div>
      </header>

      <div className="border-t border-border" />

      <div className="flex items-center px-4 py-4 sm:px-5">
        {/* Times: full width on mobile, 60% on desktop */}
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-[60%] sm:gap-3">
          <TimeBlock time={depTime} code={fromCode} />
          <RouteConnector duration={duration} hint={connectorHint} />
          <TimeBlock
            time={arrTime}
            code={toCode}
            dayOffset={dayOffset}
            approximate={Boolean(route.durationApproximate) && !isFlight}
            align="right"
          />
        </div>
        {/* Details: 40% on desktop only */}
        <div className="hidden w-[40%] shrink-0 items-center justify-end pl-4 sm:flex">
          {renderDetailsButton()}
        </div>
      </div>

      {/* Mobile footer: operator (or transport) left · details right */}
      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 sm:hidden">
        <div className="flex min-w-0 items-center gap-2">
          {showOperator ? (
            <>
              <span className="shrink-0 text-xs text-text-secondary">
                Operated by
              </span>
              <AirlineBadge airline={airline} size="sm" />
            </>
          ) : (
            <span className="truncate text-xs text-text-secondary">
              {ROUTE_TRANSPORT_LABEL[route.transport]}
              {priceLabel ? ` · ${priceLabel}` : ""}
            </span>
          )}
        </div>
        {renderDetailsButton()}
      </div>

      {/* Desktop flight footer: operator + optional done badge */}
      {showOperator ? (
        <div className="hidden items-center justify-between gap-3 border-t border-border px-5 py-2.5 sm:flex">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-xs text-text-secondary">
              Operated by
            </span>
            <AirlineBadge airline={airline} size="sm" />
            <span className="truncate text-xs text-text-secondary">
              {airline}
              {flightNumber ? ` · ${flightNumber}` : ""}
            </span>
          </div>
          {done ? (
            <span
              className={cx(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                status.className
              )}
            >
              <StatusIcon className="h-3 w-3" strokeWidth={2.5} aria-hidden />
              {status.label}
            </span>
          ) : null}
        </div>
      ) : null}

      {showNonFlightFooter && !detailsOpen ? (
        <div className="hidden items-center justify-between gap-3 border-t border-border px-5 py-2.5 sm:flex">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
              {ROUTE_TRANSPORT_LABEL[route.transport]}
            </span>
            {priceLabel ? (
              <span className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-text ring-1 ring-border">
                {priceLabel}
              </span>
            ) : null}
          </div>
          <span
            className={cx(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
              status.className
            )}
          >
            <StatusIcon className="h-3 w-3" strokeWidth={2.5} aria-hidden />
            {status.label}
          </span>
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div className="border-t border-border px-4 py-3 sm:px-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            Attached
          </p>
          <ul className="flex flex-wrap gap-2">
            {attachments.map((file) => (
              <li key={file.id}>
                <RouteAttachmentChip file={file} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {detailsOpen && hasExpandableDetails ? (
        <div className="space-y-2.5 border-t border-border bg-surface/40 px-4 py-3 sm:px-5">
          {isFlight && (airline || flightNumber) ? (
            <p className="text-xs text-text-secondary">
              {[airline, flightNumber].filter(Boolean).join(" · ")}
            </p>
          ) : null}
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
                {note}
              </p>
            </div>
          ) : null}
          {!isFlight ? (
            <span
              className={cx(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                status.className
              )}
            >
              <StatusIcon className="h-3 w-3" strokeWidth={2.5} aria-hidden />
              {status.label}
            </span>
          ) : null}
        </div>
      ) : detailsOpen ? (
        <div className="border-t border-border bg-surface/40 px-4 py-3 text-xs text-text-secondary sm:px-5">
          No extra details for this{" "}
          {ROUTE_TRANSPORT_LABEL[route.transport].toLowerCase()}.
        </div>
      ) : null}
    </article>
  );
}

function RouteAttachmentChip({ file }: { file: TripRouteAttachment }) {
  const isImage = file.kind === "image";
  return (
    <a
      href={file.url}
      target="_blank"
      rel="noopener noreferrer"
      title={file.name}
      className="inline-flex max-w-[11rem] items-center gap-1.5 rounded-lg border border-border bg-surface px-1.5 py-1 transition-colors hover:border-primary/30 hover:bg-primary-tint"
    >
      {isImage ? (
        <img
          src={file.url}
          alt=""
          className="h-8 w-8 shrink-0 rounded-md object-cover"
        />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-tint text-primary">
          <FileText className="h-3.5 w-3.5" aria-hidden />
        </span>
      )}
      <span className="min-w-0 truncate text-[11px] font-medium text-text">
        {file.name}
      </span>
    </a>
  );
}
