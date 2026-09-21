/**
 * Derive a read-only travel timeline from TripRoute data.
 * Gaps are calculated dynamically — no TimelineGap collection.
 */

import type {
  ItineraryPlace,
  ItineraryPlaceStatus,
  TripAccommodation,
  TripDestinationStop,
  TripPlannerDoc,
  TripRoute,
  TripRouteTransport,
} from "@/types/trip-planner";
import type { LocationStatus } from "@/types/location";
import type { PlaceCategory } from "@/types/trip-plan";
import { listTripAccommodations } from "./essentialsHelpers";
import { listTripDestinations, toIsoDate } from "./tripDestinations";
import {
  durationMinutesBetween,
  formatRouteDuration,
  formatRoutePointLabel,
} from "./routeHelpers";

/** Minimum gap (minutes) worth showing on the timeline. */
const MEANINGFUL_GAP_MINUTES = 45;

/** Below this, recommend staying near the hub (airport/station). */
const SHORT_GAP_MINUTES = 100;

/** Approximate airport/station buffer per end (minutes). */
const HUB_BUFFER_MINUTES: Partial<Record<TripRouteTransport, number>> = {
  flight: 90,
  train: 30,
  bus: 25,
  ferry: 40,
  metro: 15,
  taxi: 10,
  car: 15,
  other: 20,
};

/** Approximate one-way hub ↔ city transfer when we have no better data. */
const HUB_CITY_TRANSFER_MINUTES: Partial<Record<TripRouteTransport, number>> = {
  flight: 45,
  train: 20,
  bus: 20,
  ferry: 25,
  metro: 10,
  taxi: 0,
  car: 0,
  other: 15,
};

export type TimelineGapAdvice = {
  gapMinutes: number;
  /** Absolute connection window, e.g. "9h available". */
  availableLabel: string;
  /** Context label, e.g. "9h between flights". */
  betweenLabel: string;
  /** Approximate usable exploration minutes (undefined when not recommended). */
  explorationMinutes?: number;
  /** e.g. "~4h recommended exploration time" */
  explorationLabel?: string;
  recommendExplore: boolean;
  stayNearHub: boolean;
  /** e.g. "Stay near the airport" */
  stayNearHubLabel?: string;
  cityName: string;
  /** Matching itinerary gap slot when present (prefer its title). */
  itineraryGap?: ItineraryPlace;
};

export type TimelineRouteEvent = {
  kind: "route";
  id: string;
  route: TripRoute;
  /** Preferred sort instant (departure, else arrival). */
  instantMs: number | null;
  timeLabel: string | null;
  dateKey: string | null;
};

export type TimelineArrivalEvent = {
  kind: "arrival";
  id: string;
  route: TripRoute;
  cityName: string;
  instantMs: number | null;
  timeLabel: string | null;
  dateKey: string | null;
};

export type TimelineGapEvent = {
  kind: "gap";
  id: string;
  /** Present for route-derived connection windows. */
  previous?: TripRoute;
  next?: TripRoute;
  advice: TimelineGapAdvice;
  instantMs: number | null;
  dateKey: string | null;
};

export type TimelineStayEvent = {
  kind: "stay";
  id: string;
  cityName: string;
  days: number;
  /** Optional accommodation name when known. */
  stayName?: string;
  /** Full stay record when matched to this city. */
  accommodation?: TripAccommodation;
  instantMs: number | null;
  dateKey: string;
};

/** Resolved place info for timeline rows (from saved locations). */
export type TimelinePlaceLookup = {
  id: string;
  title: string;
  category?: PlaceCategory;
  cityName?: string;
  status?: string;
  imageUrl?: string;
};

export type TimelinePlaceEvent = {
  kind: "place";
  id: string;
  locationId: string;
  title: string;
  category?: PlaceCategory;
  cityName?: string;
  status: ItineraryPlaceStatus;
  /** Optional thumbnail for timeline cards. */
  imageUrl?: string;
  day: number;
  order: number;
  instantMs: number | null;
  timeLabel: string | null;
  dateKey: string;
};

export type TimelineEvent =
  | TimelineRouteEvent
  | TimelineArrivalEvent
  | TimelineGapEvent
  | TimelineStayEvent
  | TimelinePlaceEvent;

export type TimelineDay = {
  dateKey: string | null;
  /** e.g. "10 October 2026" — null for undated bucket. */
  label: string | null;
  events: TimelineEvent[];
};

export const TRANSPORT_LABEL: Record<TripRouteTransport, string> = {
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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Calendar day key from an ISO offset datetime (uses the offset wall date). */
export function dateKeyFromIso(iso?: string): string | null {
  if (!iso?.trim()) return null;
  const match = iso.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1]!;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function formatTimelineTime(
  iso?: string,
  timeKnown?: boolean
): string | null {
  if (!iso?.trim()) return null;
  // Date-only placeholder — do not show 00:00 as a real clock time.
  if (timeKnown === false) return null;
  const match = iso.trim().match(/T(\d{2}):(\d{2})/);
  if (match) return `${match[1]}:${match[2]}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatTimelineDateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Compact left-rail date, e.g. "21 Sep". */
export function formatTimelineShortDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

export function formatTimelineWeekday(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    timeZone: "UTC",
  }).format(date);
}

export function formatAvailableDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "0m";
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

/** Absolute minutes between two ISO datetimes (timezone-aware via Date parsing). */
export function gapMinutesBetween(
  arrivalIso?: string,
  departureIso?: string
): number | undefined {
  if (!arrivalIso?.trim() || !departureIso?.trim()) return undefined;
  const from = new Date(arrivalIso).getTime();
  const to = new Date(departureIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return undefined;
  return Math.round((to - from) / 60_000);
}

function cityNameFromRoutePoint(route: TripRoute, end: "from" | "to"): string {
  const point = end === "from" ? route.from : route.to;
  return point.city?.trim() || point.name?.trim() || "City";
}

function normalizeCity(name: string): string {
  return name.trim().toLowerCase();
}

/** True when this leg arrives at the trip origin (homebound / return). */
export function isReturnToHomeRoute(
  route: TripRoute,
  trip: TripPlannerDoc
): boolean {
  const homeName = trip.from?.cityName?.trim();
  if (!homeName) return false;
  const home = normalizeCity(homeName);
  const toCity = normalizeCity(route.to.city || "");
  if (toCity && toCity === home) return true;

  const homeId = trip.from?.cityId?.trim().toLowerCase();
  const toPlaceId = route.to.placeId?.trim().toLowerCase();
  if (homeId && toPlaceId && homeId === toPlaceId) return true;

  // Fallback: to.name often mirrors the city for city-level endpoints.
  const toName = normalizeCity(route.to.name || "");
  return Boolean(toName && toName === home);
}

function isReturnToHomeEvent(
  event: TimelineEvent,
  trip: TripPlannerDoc
): boolean {
  if (event.kind === "route" || event.kind === "arrival") {
    return isReturnToHomeRoute(event.route, trip);
  }
  // Keep the gap that precedes a homebound leg with destination activities.
  return false;
}

function listItineraryGaps(trip: TripPlannerDoc): ItineraryPlace[] {
  const gaps: ItineraryPlace[] = [];
  for (const day of trip.itinerary?.days ?? []) {
    for (const place of day.places ?? []) {
      if (place.type === "gap") gaps.push(place);
    }
  }
  return gaps;
}

function matchItineraryGap(
  gaps: ItineraryPlace[],
  cityName: string,
  gapMinutes: number
): ItineraryPlace | undefined {
  const city = normalizeCity(cityName);
  const scored = gaps
    .map((gap) => {
      const gapCity = normalizeCity(gap.cityName || gap.title || "");
      const cityHit =
        gapCity.includes(city) ||
        city.includes(gapCity) ||
        (gap.title && normalizeCity(gap.title).includes(city));
      if (!cityHit && gapCity) return null;
      const durationDelta =
        gap.durationMinutes != null
          ? Math.abs(gap.durationMinutes - gapMinutes)
          : 9999;
      return { gap, durationDelta, cityHit: Boolean(cityHit) };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => {
      if (a.cityHit !== b.cityHit) return a.cityHit ? -1 : 1;
      return a.durationDelta - b.durationDelta;
    });
  return scored[0]?.gap;
}

function betweenTransportLabel(
  previous: TripRoute,
  next: TripRoute
): string {
  if (previous.transport === "flight" && next.transport === "flight") {
    return "between flights";
  }
  if (previous.transport === next.transport) {
    return `between ${TRANSPORT_LABEL[previous.transport].toLowerCase()}s`;
  }
  return "available";
}

function hubStayLabel(transport: TripRouteTransport): string {
  if (transport === "flight") return "Stay near the airport";
  if (transport === "train" || transport === "metro") {
    return "Stay near the station";
  }
  if (transport === "ferry") return "Stay near the terminal";
  return "Stay near your connection";
}

export function buildGapAdvice(
  previous: TripRoute,
  next: TripRoute,
  gapMinutes: number,
  itineraryGaps: ItineraryPlace[] = []
): TimelineGapAdvice {
  const cityName = cityNameFromRoutePoint(previous, "to");
  const available = formatAvailableDuration(gapMinutes);
  const between = betweenTransportLabel(previous, next);
  const itineraryGap = matchItineraryGap(itineraryGaps, cityName, gapMinutes);
  const hubTransport =
    previous.transport === "flight" || next.transport === "flight"
      ? "flight"
      : previous.transport;

  if (gapMinutes < SHORT_GAP_MINUTES) {
    return {
      gapMinutes,
      availableLabel: `${available} available`,
      betweenLabel: `${available} ${between}`,
      recommendExplore: false,
      stayNearHub: true,
      stayNearHubLabel: hubStayLabel(hubTransport),
      cityName,
      ...(itineraryGap ? { itineraryGap } : {}),
    };
  }

  const buffer = HUB_BUFFER_MINUTES[hubTransport] ?? 30;
  const transfer = HUB_CITY_TRANSFER_MINUTES[hubTransport] ?? 20;
  // Arrival buffer + departure buffer + round-trip city transfer (approximate).
  const overhead = buffer * 2 + transfer * 2;
  const usable = Math.max(0, gapMinutes - overhead);

  if (usable < 90) {
    return {
      gapMinutes,
      availableLabel: `${available} available`,
      betweenLabel: `${available} ${between}`,
      recommendExplore: false,
      stayNearHub: true,
      stayNearHubLabel: hubStayLabel(hubTransport),
      cityName,
      ...(itineraryGap ? { itineraryGap } : {}),
    };
  }

  // Round exploration down to nearest 30m — avoid fake precision.
  const explorationMinutes = Math.max(60, Math.floor(usable / 30) * 30);
  const approx = formatAvailableDuration(explorationMinutes);

  return {
    gapMinutes,
    availableLabel: `${available} available`,
    betweenLabel: `${available} ${between}`,
    explorationMinutes,
    explorationLabel: `~${approx} recommended exploration time`,
    recommendExplore: true,
    stayNearHub: false,
    cityName,
    ...(itineraryGap ? { itineraryGap } : {}),
  };
}

function stayDaysBetween(arrivalIso?: string, departureIso?: string): number {
  const startKey = dateKeyFromIso(arrivalIso);
  const endKey = dateKeyFromIso(departureIso);
  if (!startKey || !endKey || startKey >= endKey) return 0;
  const start = new Date(`${startKey}T00:00:00Z`).getTime();
  const end = new Date(`${endKey}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

function findDestination(
  trip: TripPlannerDoc,
  cityName: string
): TripDestinationStop | undefined {
  const needle = normalizeCity(cityName);
  return listTripDestinations(trip).find((d) => {
    const name = normalizeCity(d.cityName || "");
    const id = d.cityId?.trim().toLowerCase();
    return name === needle || Boolean(id && id === needle);
  });
}

function findAccommodation(
  trip: TripPlannerDoc,
  cityName: string
): TripAccommodation | undefined {
  const stays = listTripAccommodations(trip);
  if (stays.length === 0) return undefined;
  const needle = normalizeCity(cityName);
  const cityMatch = stays.find(
    (stay) =>
      stay.cityName?.trim() && normalizeCity(stay.cityName) === needle
  );
  if (cityMatch) return cityMatch;
  // Legacy single stay without cityName applies to any destination stay.
  if (stays.length === 1 && !stays[0]!.cityName?.trim()) return stays[0];
  return undefined;
}

function destinationStayDays(dest: TripDestinationStop | undefined): number {
  if (!dest?.startDate || !dest?.endDate) return 0;
  if (
    typeof dest.startDate.toDate !== "function" ||
    typeof dest.endDate.toDate !== "function"
  ) {
    return 0;
  }
  const start = dest.startDate.toDate();
  const end = dest.endDate.toDate();
  const startMs = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate()
  );
  const endMs = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate()
  );
  if (endMs < startMs) return 0;
  return Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1);
}

function tripSpanDays(trip: TripPlannerDoc): number {
  if (
    !trip.startDate ||
    !trip.endDate ||
    typeof trip.startDate.toDate !== "function" ||
    typeof trip.endDate.toDate !== "function"
  ) {
    return 0;
  }
  const start = trip.startDate.toDate();
  const end = trip.endDate.toDate();
  const startMs = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate()
  );
  const endMs = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate()
  );
  if (endMs < startMs) return 0;
  return Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1);
}

function instantMs(iso?: string): number | null {
  if (!iso?.trim()) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Add itinerary place + gap slots onto the timeline when a plan exists. */
function appendItineraryPlaceEvents(
  events: TimelineEvent[],
  trip: TripPlannerDoc,
  placesById: Map<string, TimelinePlaceLookup>
): void {
  if (
    trip.itinerary.status === "empty" ||
    trip.itinerary.days.length === 0
  ) {
    return;
  }

  // Route-derived gaps may already reference an itinerary gap slot — skip those.
  const usedGapIds = new Set(
    events
      .filter((event): event is TimelineGapEvent => event.kind === "gap")
      .map((event) => event.advice.itineraryGap?.locationId?.trim())
      .filter((id): id is string => Boolean(id))
  );

  for (const day of trip.itinerary.days) {
    if (!day.date || typeof day.date.toDate !== "function") continue;
    const dateKey = toIsoDate(day.date.toDate());
    const slots = [...(day.places ?? [])].sort((a, b) => a.order - b.order);

    for (const slot of slots) {
      // Routes stay on TripRoute-derived timeline rows.
      if (slot.type === "route") continue;
      if (slot.status === "cancelled") continue;

      if (slot.type === "gap") {
        const gapId = slot.locationId?.trim();
        if (gapId && usedGapIds.has(gapId)) continue;
        if (gapId) usedGapIds.add(gapId);

        const cityName = slot.cityName?.trim() || "City";
        const gapMinutes =
          slot.durationMinutes != null && Number.isFinite(slot.durationMinutes)
            ? Math.max(0, Math.round(slot.durationMinutes))
            : 0;
        const available =
          gapMinutes > 0 ? formatAvailableDuration(gapMinutes) : null;
        const title =
          slot.title?.trim() ||
          (slot.cityName?.trim()
            ? `Time in ${slot.cityName.trim()}`
            : "Free time");

        events.push({
          kind: "gap",
          id: `itinerary-gap:${day.day}:${gapId || slot.order}`,
          advice: {
            gapMinutes,
            availableLabel: available ? `${available} available` : title,
            betweenLabel: title,
            recommendExplore: gapMinutes >= SHORT_GAP_MINUTES,
            stayNearHub: gapMinutes > 0 && gapMinutes < SHORT_GAP_MINUTES,
            ...(gapMinutes > 0 && gapMinutes < SHORT_GAP_MINUTES
              ? { stayNearHubLabel: "Stay near your connection" }
              : {}),
            cityName,
            itineraryGap: slot,
            ...(gapMinutes >= SHORT_GAP_MINUTES && available
              ? {
                  explorationMinutes: gapMinutes,
                  explorationLabel: `~${available} recommended exploration time`,
                }
              : {}),
          },
          instantMs: null,
          dateKey,
        });
        continue;
      }

      const loc = placesById.get(slot.locationId);
      if (loc?.status === "cancelled") continue;

      const title =
        slot.title?.trim() ||
        loc?.title?.trim() ||
        "Place";
      const cityName =
        loc?.cityName?.trim() || slot.cityName?.trim() || undefined;
      const imageUrl =
        slot.imageUrl?.trim() || loc?.imageUrl?.trim() || undefined;

      events.push({
        kind: "place",
        id: `place:${day.day}:${slot.locationId}`,
        locationId: slot.locationId,
        title,
        ...(loc?.category ? { category: loc.category } : {}),
        ...(cityName ? { cityName } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        status: slot.status,
        day: day.day,
        order: slot.order,
        instantMs: null,
        timeLabel: null,
        dateKey,
      });
    }
  }
}

/**
 * Build day-grouped timeline events from ordered routes + trip context.
 * When the itinerary is not empty, places from each day are included too.
 * Does not mutate TripRoute data.
 */
export function buildRouteTimeline(
  routes: TripRoute[],
  trip: TripPlannerDoc,
  places: TimelinePlaceLookup[] = []
): TimelineDay[] {
  const ordered = [...routes].sort((a, b) => a.order - b.order);
  const itineraryGaps = listItineraryGaps(trip);
  const events: TimelineEvent[] = [];
  const stayEmitted = new Set<string>();
  const placesById = new Map(places.map((place) => [place.id, place]));

  for (let i = 0; i < ordered.length; i++) {
    const route = ordered[i]!;
    const next = ordered[i + 1];
    const depIso = route.departure?.datetime;
    const arrIso = route.arrival?.datetime;
    const depKey = dateKeyFromIso(depIso);
    const arrKey = dateKeyFromIso(arrIso);

    events.push({
      kind: "route",
      id: `route:${route.id}`,
      route,
      instantMs: instantMs(depIso) ?? instantMs(arrIso),
      timeLabel: formatTimelineTime(depIso, route.departure?.timeKnown),
      dateKey: depKey ?? arrKey,
    });

    const arrivalCity = cityNameFromRoutePoint(route, "to");
    const gapMinutes =
      next &&
      route.arrival?.timeKnown !== false &&
      next.departure?.timeKnown !== false
        ? gapMinutesBetween(arrIso, next.departure?.datetime)
        : undefined;
    const hasMeaningfulGap =
      gapMinutes != null && gapMinutes >= MEANINGFUL_GAP_MINUTES;
    const calendarStayDays =
      next &&
      route.arrival?.timeKnown !== false &&
      next.departure?.timeKnown !== false
        ? stayDaysBetween(arrIso, next.departure?.datetime)
        : next
          ? stayDaysBetween(
              // Fall back to calendar dates when clock times are unknown.
              arrIso ?? depIso,
              next.departure?.datetime
            )
          : 0;

    const dest = findDestination(trip, arrivalCity);
    const destDays = destinationStayDays(dest);
    const showArrival =
      Boolean(arrIso) || hasMeaningfulGap || calendarStayDays > 0 || destDays > 1;

    if (showArrival) {
      events.push({
        kind: "arrival",
        id: `arrival:${route.id}`,
        route,
        cityName: arrivalCity,
        instantMs: instantMs(arrIso),
        timeLabel: formatTimelineTime(arrIso, route.arrival?.timeKnown),
        dateKey: arrKey ?? depKey,
      });
    }

    if (hasMeaningfulGap && next && gapMinutes != null) {
      const advice = buildGapAdvice(route, next, gapMinutes, itineraryGaps);
      events.push({
        kind: "gap",
        id: `gap:${route.id}:${next.id}`,
        previous: route,
        next,
        advice,
        instantMs: instantMs(arrIso),
        dateKey: arrKey ?? dateKeyFromIso(next.departure?.datetime),
      });
    }

    const stayDays = Math.max(calendarStayDays, destDays > 0 ? destDays : 0);
    if (stayDays >= 1) {
      const stayKey = normalizeCity(arrivalCity);
      if (!stayEmitted.has(stayKey)) {
        stayEmitted.add(stayKey);
        const accommodation = findAccommodation(trip, arrivalCity);
        // Check-in belongs on the stay start / arrival day — not the day after.
        const stayDateKey =
          accommodation?.startDate?.trim() ||
          arrKey ||
          (dest?.startDate && typeof dest.startDate.toDate === "function"
            ? (() => {
                const d = dest.startDate!.toDate();
                return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
              })()
            : null);

        if (stayDateKey) {
          events.push({
            kind: "stay",
            id: `stay:${stayKey}`,
            cityName: arrivalCity,
            days: stayDays,
            ...(accommodation?.name?.trim()
              ? { stayName: accommodation.name.trim() }
              : {}),
            ...(accommodation ? { accommodation } : {}),
            instantMs: instantMs(arrIso),
            dateKey: stayDateKey,
          });
        }
      }
    }
  }

  // Always surface a stay card per destination so users can add accommodation
  // inside the timeline (even before return routes exist / overnight gaps).
  const stayCities = listTripDestinations(trip).filter(
    (dest) => dest.stopType !== "transit"
  );
  for (const dest of stayCities) {
    const cityName = dest.cityName?.trim();
    if (!cityName) continue;
    const stayKey = normalizeCity(cityName);
    if (stayEmitted.has(stayKey)) continue;

    const destDays = destinationStayDays(dest);
    const tripDays = stayCities.length === 1 ? tripSpanDays(trip) : 0;
    const days = Math.max(destDays, tripDays, 1);
    const accommodation = findAccommodation(trip, cityName);

    const arrivalIntoCity = [...events]
      .reverse()
      .find(
        (event): event is TimelineArrivalEvent =>
          event.kind === "arrival" &&
          normalizeCity(event.cityName) === stayKey &&
          Boolean(event.dateKey)
      );
    let stayDateKey: string | null =
      accommodation?.startDate?.trim() ||
      arrivalIntoCity?.dateKey ||
      null;
    if (!stayDateKey && dest.startDate && typeof dest.startDate.toDate === "function") {
      const d = dest.startDate.toDate();
      stayDateKey = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    } else if (
      !stayDateKey &&
      trip.startDate &&
      typeof trip.startDate.toDate === "function"
    ) {
      const d = trip.startDate.toDate();
      stayDateKey = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    }

    if (!stayDateKey) continue;

    stayEmitted.add(stayKey);
    events.push({
      kind: "stay",
      id: `stay:${stayKey}`,
      cityName,
      days,
      ...(accommodation?.name?.trim()
        ? { stayName: accommodation.name.trim() }
        : {}),
      ...(accommodation ? { accommodation } : {}),
      instantMs: arrivalIntoCity?.instantMs ?? null,
      dateKey: stayDateKey,
    });
  }

  // Surface saved accommodations that weren't already attached to a route stay.
  for (const stay of listTripAccommodations(trip)) {
    const cityName = stay.cityName?.trim() || stay.name?.trim() || "Stay";
    const stayKey = normalizeCity(cityName);
    const already =
      stayEmitted.has(stayKey) ||
      events.some(
        (event) =>
          event.kind === "stay" &&
          (event.accommodation?.id === stay.id ||
            (stay.id && event.id === `stay:accommodation:${stay.id}`))
      );
    if (already) continue;

    const start = trip.startDate?.toDate?.();
    const dateKey =
      stay.startDate?.trim() ||
      (start
        ? `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}-${pad2(start.getUTCDate())}`
        : null);
    if (!dateKey) continue;

    let days = 1;
    if (stay.startDate && stay.endDate) {
      const start = new Date(`${stay.startDate}T00:00:00Z`);
      const end = new Date(`${stay.endDate}T00:00:00Z`);
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
        days = Math.max(
          1,
          Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
        );
      }
    }

    stayEmitted.add(stayKey);
    events.push({
      kind: "stay",
      id: `stay:accommodation:${stay.id ?? stayKey}`,
      cityName,
      days,
      ...(stay.name?.trim() ? { stayName: stay.name.trim() } : {}),
      accommodation: stay,
      instantMs: null,
      dateKey,
    });
  }

  appendItineraryPlaceEvents(events, trip, placesById);

  // Group by date key while preserving overall route order for undated items.
  const dayMap = new Map<string | null, TimelineEvent[]>();
  const dayOrder: Array<string | null> = [];

  for (const event of events) {
    const key = event.dateKey;
    if (!dayMap.has(key)) {
      dayMap.set(key, []);
      dayOrder.push(key);
    }
    dayMap.get(key)!.push(event);
  }

  // Stable chronological sort of dated days; undated last.
  const dated = dayOrder
    .filter((k): k is string => typeof k === "string")
    .sort((a, b) => a.localeCompare(b));
  const undated = dayOrder.includes(null) ? [null] : [];

  const days: TimelineDay[] = [...dated, ...undated].map((dateKey) => ({
    dateKey,
    label: dateKey ? formatTimelineDateLabel(dateKey) : null,
    events: dayMap.get(dateKey) ?? [],
  }));

  // Pin homebound legs (destination → trip.from) after all destination
  // activity so the return always closes the timeline.
  const mainDays: TimelineDay[] = [];
  const returnEvents: TimelineEvent[] = [];
  for (const day of days) {
    const main: TimelineEvent[] = [];
    for (const event of day.events) {
      if (isReturnToHomeEvent(event, trip)) {
        returnEvents.push(event);
      } else {
        main.push(event);
      }
    }
    if (main.length > 0) {
      mainDays.push({ ...day, events: main });
    }
  }

  if (returnEvents.length === 0) return mainDays;

  const returnDateKey =
    returnEvents.map((event) => event.dateKey).find((key): key is string => Boolean(key)) ??
    null;

  return [
    ...mainDays,
    {
      dateKey: returnDateKey,
      label: returnDateKey ? formatTimelineDateLabel(returnDateKey) : null,
      events: returnEvents,
    },
  ];
}

export function routeDurationLabel(route: TripRoute): string | null {
  const exact =
    (route.transport === "flight" || route.transport === "train") &&
    !route.durationApproximate;
  const minutes = exact
    ? (durationMinutesBetween(
        route.departure?.datetime,
        route.arrival?.datetime
      ) ?? route.durationMinutes)
    : route.durationMinutes;
  return formatRouteDuration(minutes, Boolean(route.durationApproximate));
}

export function routeTitle(route: TripRoute): string {
  return `${formatRoutePointLabel(route.from)} → ${formatRoutePointLabel(route.to)}`;
}

export type TimelineMapLeg = {
  id: string;
  transport: TripRouteTransport;
  from: { lat: number; lon: number; label: string };
  to: { lat: number; lon: number; label: string };
};

export type TimelineMapPoint = {
  id: string;
  lat: number;
  lon: number;
  label: string;
  /** Route hubs vs saved places — drives pin styling on the map. */
  kind: "place" | "city" | "airport";
  status?: LocationStatus;
};

function hasCoords(
  point: { lat?: number; lon?: number } | null | undefined
): point is { lat: number; lon: number } {
  return (
    typeof point?.lat === "number" &&
    Number.isFinite(point.lat) &&
    typeof point?.lon === "number" &&
    Number.isFinite(point.lon)
  );
}

function mapPointKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

export function buildTimelineMapLegs(routes: TripRoute[]): TimelineMapLeg[] {
  const ordered = [...routes].sort((a, b) => a.order - b.order);
  const legs: TimelineMapLeg[] = [];
  for (const route of ordered) {
    const from = route.from.location;
    const to = route.to.location;
    if (!hasCoords(from) || !hasCoords(to)) {
      continue;
    }
    legs.push({
      id: route.id,
      transport: route.transport,
      from: {
        lat: from.lat,
        lon: from.lon,
        label: formatRoutePointLabel(route.from),
      },
      to: {
        lat: to.lat,
        lon: to.lon,
        label: formatRoutePointLabel(route.to),
      },
    });
  }
  return legs;
}

/** Every route endpoint that has coordinates (even if the other end is missing). */
export function buildTimelineMapRoutePoints(
  routes: TripRoute[]
): TimelineMapPoint[] {
  const ordered = [...routes].sort((a, b) => a.order - b.order);
  const points: TimelineMapPoint[] = [];
  const seen = new Set<string>();

  const push = (
    id: string,
    location: { lat?: number; lon?: number } | null | undefined,
    label: string,
    transport: TripRouteTransport
  ) => {
    if (!hasCoords(location)) return;
    const key = mapPointKey(location.lat, location.lon);
    if (seen.has(key)) return;
    seen.add(key);
    points.push({
      id,
      lat: location.lat,
      lon: location.lon,
      label,
      kind: transport === "flight" ? "airport" : "city",
    });
  };

  for (const route of ordered) {
    push(
      `route:${route.id}:from`,
      route.from.location,
      formatRoutePointLabel(route.from),
      route.transport
    );
    push(
      `route:${route.id}:to`,
      route.to.location,
      formatRoutePointLabel(route.to),
      route.transport
    );
  }
  return points;
}

/** Deduped union of route hubs + place pins for the timeline map. */
export function mergeTimelineMapPoints(
  routePoints: TimelineMapPoint[],
  placePoints: TimelineMapPoint[]
): TimelineMapPoint[] {
  const seen = new Set<string>();
  const merged: TimelineMapPoint[] = [];
  for (const point of [...routePoints, ...placePoints]) {
    const key = mapPointKey(point.lat, point.lon);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(point);
  }
  return merged;
}
