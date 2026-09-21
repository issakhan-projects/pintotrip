"use client";

/**
 * Routes → Timeline view.
 * Derives events/gaps from TripRoute; accommodations open AccommodationSheet.
 */

import { useMemo, useState, type ReactNode } from "react";
import {
  BedDouble,
  Bus,
  Camera,
  Car,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Footprints,
  Map as MapIcon,
  MapPin,
  Mountain,
  Plane,
  Plus,
  Route,
  Ship,
  Sparkles,
  Train,
  TrainFront,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui";
import { cx } from "@/lib/utils";
import { hasGoogleMapsConfigured } from "@/lib/env";
import type {
  TripAccommodation,
  TripPlannerDoc,
  TripRoute,
  TripRouteTransport,
} from "@/types/trip-planner";
import type { PlaceCategory } from "@/types/trip-plan";
import { PLACE_CATEGORY_LABELS } from "@/types/trip-plan";
import type { SavedLocation } from "@/hooks/useLocations";
import { AccommodationSheet } from "./AccommodationSheet";
import { listTripAccommodations } from "./essentialsHelpers";
import { RoutesTimelineMap } from "./RoutesTimelineMap";
import {
  TRANSPORT_LABEL,
  buildRouteTimeline,
  buildTimelineMapLegs,
  buildTimelineMapRoutePoints,
  mergeTimelineMapPoints,
  formatTimelineShortDate,
  routeDurationLabel,
  routeTitle,
  type TimelineArrivalEvent,
  type TimelineEvent,
  type TimelineGapEvent,
  type TimelineMapPoint,
  type TimelinePlaceEvent,
  type TimelinePlaceLookup,
  type TimelineRouteEvent,
  type TimelineStayEvent,
} from "./timelineHelpers";

type BadgeTone =
  | "flight"
  | "transfer"
  | "stay"
  | "place"
  | "food"
  | "shopping"
  | "activity"
  | "arrival";

const BADGE_CLASS: Record<BadgeTone, string> = {
  flight: "bg-violet-50 text-violet-700",
  transfer: "bg-sky-50 text-sky-600",
  stay: "bg-primary-tint text-primary",
  place: "bg-emerald-50 text-emerald-700",
  food: "bg-orange-50 text-orange-700",
  shopping: "bg-pink-50 text-pink-600",
  activity: "bg-violet-50 text-violet-600",
  arrival: "bg-slate-100 text-slate-600",
};

const TRANSPORT_ICON: Record<TripRouteTransport, LucideIcon> = {
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

type TimelineStyle = {
  Icon: LucideIcon;
  iconWrap: string;
  iconClass: string;
  badge?: { label: string; tone: BadgeTone };
};

function isTransferTransport(transport: TripRouteTransport): boolean {
  return (
    transport === "taxi" ||
    transport === "airport_transfer" ||
    transport === "car" ||
    transport === "bus" ||
    transport === "metro" ||
    transport === "other"
  );
}

function routeTimelineStyle(route: TripRoute): TimelineStyle {
  const Icon = TRANSPORT_ICON[route.transport] ?? Footprints;

  if (route.transport === "flight") {
    return {
      Icon,
      iconWrap: "bg-violet-100",
      iconClass: "text-violet-700",
      badge: { label: "Flight", tone: "flight" },
    };
  }

  if (isTransferTransport(route.transport)) {
    return {
      Icon,
      iconWrap: "bg-sky-100",
      iconClass: "text-sky-600",
      badge: {
        label:
          route.transport === "airport_transfer"
            ? "Transfer"
            : TRANSPORT_LABEL[route.transport],
        tone: "transfer",
      },
    };
  }

  if (route.transport === "train" || route.transport === "ferry") {
    return {
      Icon,
      iconWrap: "bg-indigo-100",
      iconClass: "text-indigo-600",
      badge: { label: TRANSPORT_LABEL[route.transport], tone: "activity" },
    };
  }

  return {
    Icon,
    iconWrap: "bg-slate-100",
    iconClass: "text-slate-600",
    badge: { label: TRANSPORT_LABEL[route.transport], tone: "arrival" },
  };
}

function routeSubtitle(route: TripRoute): string | null {
  const codes = [route.from.code, route.to.code]
    .map((code) => code?.trim().toUpperCase())
    .filter(Boolean);
  const flightMeta = [
    route.flightNumber?.trim().toUpperCase(),
    route.airline?.trim(),
  ]
    .filter(Boolean)
    .join(" · ");
  const duration = routeDurationLabel(route);

  if (route.transport === "flight") {
    const parts = [
      flightMeta || (codes.length === 2 ? codes.join(" → ") : null),
      duration,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : null;
  }

  if (isTransferTransport(route.transport)) {
    const label =
      route.transport === "airport_transfer"
        ? "Private transfer"
        : TRANSPORT_LABEL[route.transport];
    return [label, duration].filter(Boolean).join(" · ");
  }

  if (codes.length === 2) {
    return [codes.join(" → "), duration].filter(Boolean).join(" · ");
  }

  return duration;
}

function placeTimelineStyle(category?: PlaceCategory): TimelineStyle {
  if (category === "food" || category === "cafe") {
    return {
      Icon: UtensilsCrossed,
      iconWrap: "bg-orange-100",
      iconClass: "text-orange-700",
      badge: { label: "Food", tone: "food" },
    };
  }
  if (category === "nature" || category === "park" || category === "beach") {
    return {
      Icon: Mountain,
      iconWrap: "bg-emerald-100",
      iconClass: "text-emerald-700",
      badge: {
        label: category === "nature" ? "Nature" : PLACE_CATEGORY_LABELS[category],
        tone: "place",
      },
    };
  }
  if (category === "shopping" || category === "market") {
    return {
      Icon: MapPin,
      iconWrap: "bg-pink-100",
      iconClass: "text-pink-600",
      badge: { label: "Shopping", tone: "shopping" },
    };
  }
  if (
    category === "nightlife" ||
    category === "adventure" ||
    category === "wellness"
  ) {
    return {
      Icon: Camera,
      iconWrap: "bg-violet-100",
      iconClass: "text-violet-600",
      badge: { label: "Activity", tone: "activity" },
    };
  }
  return {
    Icon: MapPin,
    iconWrap: "bg-emerald-100",
    iconClass: "text-emerald-700",
    badge: {
      label: category
        ? PLACE_CATEGORY_LABELS[category] ?? "Place"
        : "Place",
      tone: "place",
    },
  };
}

function locationsToPlaceLookup(
  locations: SavedLocation[]
): TimelinePlaceLookup[] {
  return locations.map((loc) => ({
    id: loc.id,
    title: loc.title,
    ...(loc.category ? { category: loc.category } : {}),
    ...(loc.city?.name ? { cityName: loc.city.name } : {}),
    ...(loc.status ? { status: loc.status } : {}),
    ...(loc.images?.[0]?.url ? { imageUrl: loc.images[0].url } : {}),
  }));
}

function arrivalTitle(event: TimelineArrivalEvent): string {
  const point = event.route.to;
  const hub =
    point.name?.trim() ||
    (point.code?.trim()
      ? `${point.code.trim().toUpperCase()} Airport`
      : null) ||
    `${event.cityName} Airport`;
  if (/airport|station|terminal/i.test(hub)) {
    return `Arrive ${hub}`;
  }
  return `Arrive ${event.cityName}`;
}

function TimelineBadge({
  label,
  tone,
}: {
  label: string;
  tone: BadgeTone;
}) {
  return (
    <span
      className={cx(
        "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
        BADGE_CLASS[tone]
      )}
    >
      {label}
    </span>
  );
}

function TimelineCard({
  title,
  subtitle,
  badge,
  imageUrl,
  onClick,
  interactive = Boolean(onClick),
}: {
  title: string;
  subtitle?: string | null;
  badge?: { label: string; tone: BadgeTone } | null;
  imageUrl?: string | null;
  onClick?: () => void;
  interactive?: boolean;
}) {
  const content = (
    <>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          className="h-14 w-14 shrink-0 rounded-xl object-cover"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold leading-snug text-text">
          {title}
        </p>
        {subtitle ? (
          <p className="mt-0.5 truncate text-sm text-text-secondary">
            {subtitle}
          </p>
        ) : null}
      </div>
      {badge ? <TimelineBadge label={badge.label} tone={badge.tone} /> : null}
      {interactive ? (
        <ChevronRight
          className="h-4 w-4 shrink-0 text-text-muted"
          aria-hidden
        />
      ) : null}
    </>
  );

  const className = cx(
    "flex w-full items-center gap-3 rounded-2xl border border-border bg-white px-3.5 py-3 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)]",
    interactive && "transition-colors hover:border-primary/30 hover:bg-surface/60"
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

function TimelineRow({
  dateLabel,
  timeLabel,
  style,
  isLast,
  children,
}: {
  dateLabel?: string | null;
  timeLabel?: string | null;
  style: TimelineStyle;
  isLast: boolean;
  children: ReactNode;
}) {
  const Icon = style.Icon;
  const hasMeta = Boolean(dateLabel || timeLabel);

  return (
    <div className="relative flex gap-3 sm:gap-4">
      <div className="flex w-[3.25rem] shrink-0 flex-col items-end pt-3 sm:w-14">
        {hasMeta ? (
          <>
            {dateLabel ? (
              <span className="text-right text-[12px] leading-tight text-text-secondary sm:text-[13px]">
                {dateLabel}
              </span>
            ) : null}
            {timeLabel ? (
              <time className="mt-0.5 text-right text-sm font-semibold tabular-nums tracking-tight text-text sm:text-[15px]">
                {timeLabel}
              </time>
            ) : null}
          </>
        ) : (
          <span className="text-sm text-transparent" aria-hidden>
            —
          </span>
        )}
      </div>

      <div className="relative flex w-10 shrink-0 flex-col items-center">
        <span
          className={cx(
            "z-10 mt-1.5 flex h-10 w-10 items-center justify-center rounded-full",
            style.iconWrap
          )}
          aria-hidden
        >
          <Icon className={cx("h-4 w-4", style.iconClass)} strokeWidth={2.25} />
        </span>
        {!isLast ? (
          <span
            className="absolute top-12 bottom-[-0.875rem] w-px border-l border-dashed border-[#d4d4d8]"
            aria-hidden
          />
        ) : null}
      </div>

      <div className={cx("min-w-0 flex-1", !isLast && "pb-3.5")}>{children}</div>
    </div>
  );
}

function eventDateLabel(dateKey: string | null | undefined): string | null {
  return dateKey ? formatTimelineShortDate(dateKey) : null;
}

function RouteEventRow({
  event,
  isLast,
  onEdit,
}: {
  event: TimelineRouteEvent;
  isLast: boolean;
  onEdit?: (route: TripRoute) => void;
}) {
  const { route } = event;
  const style = routeTimelineStyle(route);

  return (
    <TimelineRow
      dateLabel={eventDateLabel(event.dateKey)}
      timeLabel={event.timeLabel}
      style={style}
      isLast={isLast}
    >
      <TimelineCard
        title={routeTitle(route)}
        subtitle={routeSubtitle(route)}
        badge={style.badge}
        onClick={onEdit ? () => onEdit(route) : undefined}
      />
    </TimelineRow>
  );
}

function ArrivalEventRow({
  event,
  isLast,
}: {
  event: TimelineArrivalEvent;
  isLast: boolean;
}) {
  return (
    <TimelineRow
      dateLabel={eventDateLabel(event.dateKey)}
      timeLabel={event.timeLabel}
      style={{
        Icon: MapPin,
        iconWrap: "bg-slate-100",
        iconClass: "text-slate-500",
      }}
      isLast={isLast}
    >
      <TimelineCard
        title={arrivalTitle(event)}
        subtitle="Welcome!"
        interactive={false}
      />
    </TimelineRow>
  );
}

function GapEventRow({
  event,
  isLast,
}: {
  event: TimelineGapEvent;
  isLast: boolean;
}) {
  const { advice } = event;
  const title =
    advice.itineraryGap?.title?.trim() ||
    (advice.recommendExplore
      ? `Explore ${advice.cityName}`
      : advice.stayNearHub
        ? advice.stayNearHubLabel ?? "Stay near your connection"
        : advice.betweenLabel);
  const subtitle = [
    advice.availableLabel,
    advice.explorationLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <TimelineRow
      dateLabel={eventDateLabel(event.dateKey)}
      style={{
        Icon: advice.recommendExplore ? Sparkles : Footprints,
        iconWrap: "bg-slate-100",
        iconClass: "text-slate-500",
      }}
      isLast={isLast}
    >
      <TimelineCard
        title={title}
        subtitle={subtitle || advice.betweenLabel}
        interactive={false}
      />
    </TimelineRow>
  );
}

function StayEventRow({
  event,
  isLast,
  onAddAccommodation,
  onManageAccommodation,
}: {
  event: TimelineStayEvent;
  isLast: boolean;
  onAddAccommodation: () => void;
  onManageAccommodation: () => void;
}) {
  const stay = event.accommodation;
  const stayTitle =
    stay?.name?.trim() || event.stayName?.trim() || null;
  const hasStay = Boolean(stayTitle);

  return (
    <TimelineRow
      dateLabel={eventDateLabel(event.dateKey)}
      style={{
        Icon: BedDouble,
        iconWrap: "bg-primary-tint",
        iconClass: "text-primary",
        badge: { label: "Accommodation", tone: "stay" },
      }}
      isLast={isLast}
    >
      {hasStay ? (
        <TimelineCard
          title={`Check-in at ${stayTitle}`}
          subtitle={`${event.cityName} · ${event.days} ${event.days === 1 ? "day" : "days"}`}
          badge={{ label: "Accommodation", tone: "stay" }}
          onClick={onManageAccommodation}
        />
      ) : (
        <button
          type="button"
          onClick={onAddAccommodation}
          className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-border bg-white px-3.5 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary-tint/40"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-text">
              Add accommodation in {event.cityName}
            </p>
            <p className="mt-0.5 text-sm text-text-secondary">
              {event.days} {event.days === 1 ? "day" : "days"} stay
            </p>
          </div>
          <TimelineBadge label="Accommodation" tone="stay" />
          <Plus className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        </button>
      )}
    </TimelineRow>
  );
}

function PlaceEventRow({
  event,
  isLast,
  onOpen,
}: {
  event: TimelinePlaceEvent;
  isLast: boolean;
  onOpen?: (locationId: string) => void;
}) {
  const style = placeTimelineStyle(event.category);
  const visited = event.status === "visited";
  const subtitle = [
    event.cityName,
    visited ? "Visited" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <TimelineRow
      dateLabel={eventDateLabel(event.dateKey)}
      timeLabel={event.timeLabel}
      style={style}
      isLast={isLast}
    >
      <TimelineCard
        title={event.title}
        subtitle={subtitle || null}
        badge={style.badge}
        imageUrl={event.imageUrl}
        onClick={onOpen ? () => onOpen(event.locationId) : undefined}
      />
    </TimelineRow>
  );
}

function TimelineEventRow({
  event,
  isLast,
  itineraryStatus,
  onEditRoute,
  onOpenPlace,
  onAddAccommodation,
  onManageAccommodation,
}: {
  event: TimelineEvent;
  isLast: boolean;
  itineraryStatus: TripPlannerDoc["itinerary"]["status"];
  onEditRoute?: (route: TripRoute) => void;
  onOpenPlace?: (locationId: string) => void;
  onAddAccommodation: () => void;
  onManageAccommodation: () => void;
}) {
  switch (event.kind) {
    case "route":
      return (
        <RouteEventRow event={event} isLast={isLast} onEdit={onEditRoute} />
      );
    case "arrival":
      return <ArrivalEventRow event={event} isLast={isLast} />;
    case "gap":
      if (itineraryStatus !== "empty") return null;
      return <GapEventRow event={event} isLast={isLast} />;
    // case "stay":
    //   return (
    //     <StayEventRow
    //       event={event}
    //       isLast={isLast}
    //       onAddAccommodation={onAddAccommodation}
    //       onManageAccommodation={onManageAccommodation}
    //     />
    //   );
    case "place":
      return (
        <PlaceEventRow
          event={event}
          isLast={isLast}
          onOpen={onOpenPlace}
        />
      );
    default:
      return null;
  }
}

export function RoutesTimeline({
  trip,
  routes,
  locations = [],
  loading,
  error,
  onAddRoute,
  onEditRoute,
  onOpenPlace,
  onSaveAccommodations,
}: {
  trip: TripPlannerDoc;
  routes: TripRoute[];
  locations?: SavedLocation[];
  loading: boolean;
  error: string | null;
  onAddRoute: () => void;
  onEditRoute?: (route: TripRoute) => void;
  onOpenPlace?: (locationId: string) => void;
  onSaveAccommodations: (items: TripAccommodation[]) => Promise<void>;
}) {
  const [mapOpen, setMapOpen] = useState(false);
  const [accommodationOpen, setAccommodationOpen] = useState(false);
  const [accommodationStartInForm, setAccommodationStartInForm] =
    useState(false);
  const showMap = hasGoogleMapsConfigured();
  const accommodations = useMemo(
    () => listTripAccommodations(trip),
    [trip]
  );
  const placeLookup = useMemo(
    () => locationsToPlaceLookup(locations),
    [locations]
  );

  const days = useMemo(
    () => buildRouteTimeline(routes, trip, placeLookup),
    [routes, trip, placeLookup]
  );
  const flatEvents = useMemo(() => {
    const events = days.flatMap((day) => day.events);
    // Gap / free-time cards only while the itinerary is empty — once places
    // are planned, those slots replace the synthetic explore windows.
    if (trip.itinerary.status === "empty") return events;
    return events.filter((event) => event.kind !== "gap");
  }, [days, trip.itinerary.status]);
  const hasStayEvent = useMemo(
    () => flatEvents.some((event) => event.kind === "stay"),
    [flatEvents]
  );
  const mapLegs = useMemo(() => buildTimelineMapLegs(routes), [routes]);
  const tripPlaces = useMemo(() => {
    const ids = new Set(trip.savedPlaceIds ?? []);
    for (const day of trip.itinerary?.days ?? []) {
      for (const place of day.places ?? []) {
        if (place.type === "gap" || place.type === "route") continue;
        ids.add(place.locationId);
      }
    }
    return locations.filter(
      (loc) =>
        ids.has(loc.id) &&
        loc.status !== "cancelled" &&
        Number.isFinite(loc.lat) &&
        Number.isFinite(loc.lon)
    );
  }, [locations, trip.savedPlaceIds, trip.itinerary?.days]);
  const mapPoints = useMemo(() => {
    const routePoints = buildTimelineMapRoutePoints(routes);
    const placePoints: TimelineMapPoint[] = tripPlaces.map((place) => ({
      id: `place:${place.id}`,
      lat: place.lat,
      lon: place.lon,
      label: place.title,
      kind: "place",
      ...(place.status ? { status: place.status } : {}),
    }));
    return mergeTimelineMapPoints(routePoints, placePoints);
  }, [routes, tripPlaces]);

  function openAddAccommodation() {
    setAccommodationStartInForm(true);
    setAccommodationOpen(true);
  }

  function openManageAccommodation() {
    setAccommodationStartInForm(false);
    setAccommodationOpen(true);
  }

  if (error) {
    return (
      <p className="rounded-xl bg-error-background px-4 py-3 text-sm text-error">
        {error}
      </p>
    );
  }

  if (loading) {
    return (
      <p className="py-10 text-center text-sm text-text-secondary">
        Loading timeline…
      </p>
    );
  }

  if (flatEvents.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-surface/60 px-6 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-tint text-primary">
            <Route className="h-5 w-5" aria-hidden />
          </span>
          <h3 className="mt-4 text-base font-semibold text-text">
            Your journey starts here
          </h3>
          <p className="mt-1.5 max-w-sm text-sm text-text-secondary">
            Add routes to build your travel timeline. You can also save
            accommodation now.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              variant="primary"
              icon={Plus}
              className="!h-10"
              onClick={onAddRoute}
            >
              Add route
            </Button>
            {/* <Button
              type="button"
              variant="secondary"
              icon={BedDouble}
              className="!h-10"
              onClick={openAddAccommodation}
            >
              Add accommodation
            </Button> */}
          </div>
        </div>

        <AccommodationSheet
          open={accommodationOpen}
          onClose={() => setAccommodationOpen(false)}
          trip={trip}
          items={accommodations}
          startInForm={accommodationStartInForm}
          onSaveAll={async (items) => {
            await onSaveAccommodations(items);
            setAccommodationOpen(false);
          }}
        />
      </>
    );
  }

  const showFallbackAddStay =
    !hasStayEvent && accommodations.length === 0;
  const primaryCity =
    trip.destinations?.find((d) => d.stopType !== "transit")?.cityName?.trim() ||
    trip.destinations?.[0]?.cityName?.trim() ||
    "your trip";

  const timelineColumn = (
    <div className="min-w-0">
      {/* <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          icon={BedDouble}
          className="!h-9"
          onClick={
            accommodations.length > 0
              ? openManageAccommodation
              : openAddAccommodation
          }
        >
          {accommodations.length > 0 ? "Accommodation" : "Add accommodation"}
        </Button>
      </div> */}

      <div>
        {flatEvents.map((event, index) => (
          <TimelineEventRow
            key={event.id}
            event={event}
            itineraryStatus={trip.itinerary.status}
            isLast={
              index === flatEvents.length - 1 && !showFallbackAddStay
            }
            onEditRoute={onEditRoute}
            onOpenPlace={onOpenPlace}
            onAddAccommodation={openAddAccommodation}
            onManageAccommodation={openManageAccommodation}
          />
        ))}

        {/* {showFallbackAddStay ? (
          <TimelineRow
            style={{
              Icon: BedDouble,
              iconWrap: "bg-primary-tint",
              iconClass: "text-primary",
              badge: { label: "Accommodation", tone: "stay" },
            }}
            isLast
          >
            <button
              type="button"
              onClick={openAddAccommodation}
              className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-border bg-white px-3.5 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary-tint/40"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-text">
                  Add accommodation in {primaryCity}
                </p>
                <p className="mt-0.5 text-sm text-text-secondary">
                  Save where you&apos;ll stay on this trip
                </p>
              </div>
              <TimelineBadge label="Accommodation" tone="stay" />
              <Plus className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            </button>
          </TimelineRow>
        ) : null} */}
      </div>
    </div>
  );

  const mapPanel =
    showMap && mapPoints.length > 0 ? (
      <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2.5">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">
            <MapIcon className="h-3.5 w-3.5 text-primary" aria-hidden />
            Route map
          </p>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-text-secondary hover:bg-white hover:text-text lg:hidden"
            onClick={() => setMapOpen((open) => !open)}
            aria-expanded={mapOpen}
          >
            {mapOpen ? (
              <>
                Hide
                <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                Show
                <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
        <div
          className={cx(
            "h-56 w-full lg:h-[28rem]",
            !mapOpen && "hidden lg:block"
          )}
        >
          <RoutesTimelineMap
            legs={mapLegs}
            points={mapPoints}
            className="h-full w-full"
          />
        </div>
      </div>
    ) : null;

  return (
    <>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.95fr)] lg:items-start">
        {timelineColumn}
        {mapPanel}
      </div>

      <AccommodationSheet
        open={accommodationOpen}
        onClose={() => setAccommodationOpen(false)}
        trip={trip}
        items={accommodations}
        startInForm={accommodationStartInForm}
        onSaveAll={async (items) => {
          await onSaveAccommodations(items);
          setAccommodationOpen(false);
        }}
      />
    </>
  );
}
