/**
 * Assign a shared sequential `order` (1, 2, 3, …) across routes, places,
 * and whereToEat on each itinerary day — one timeline.
 * Mirrors functions/src/trip/ai/assignSharedOrders.ts.
 */

import type { RoutePoint } from "@/types/trip-planner";
import type {
  TripPlannerAiResponseDay,
  TripPlannerAiResponseLocationPlace,
  TripPlannerAiResponseNestedPlace,
  TripPlannerAiResponsePlace,
  TripPlannerAiResponseRoute,
} from "@/types/trip-planner-ai-request";

function parseMs(iso?: string): number | null {
  if (!iso?.trim()) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Offset east of UTC in minutes from an ISO instant (`Z` / `±HH:MM`). */
function parseOffsetMinutes(iso?: string): number {
  if (!iso?.trim()) return 0;
  const trimmed = iso.trim();
  if (/[zZ]$/.test(trimmed)) return 0;
  const m = trimmed.match(/([+-])(\d{2}):?(\d{2})$/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * Local HH:mm on a calendar day → UTC ms for sorting.
 * When `offsetAnchorIso` is set (freeTime / route ISO), HH:mm is interpreted in
 * that offset — never as bare UTC (which mis-orders vs timed flights).
 */
function parseVisitMs(
  dayDate: string,
  hhmm?: string,
  offsetAnchorIso?: string
): number | null {
  if (!hhmm?.trim()) return null;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  const baseUtc = Date.parse(`${dayDate}T00:00:00Z`);
  if (!Number.isFinite(baseUtc)) return null;
  const offsetMin = parseOffsetMinutes(offsetAnchorIso);
  return baseUtc - offsetMin * 60_000 + (hour * 60 + minute) * 60_000;
}

function normalizeCityKey(value?: string): string {
  return (value ?? "").trim().toLowerCase();
}

function slugifyLoose(raw?: string): string {
  return (raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pointMatchesCity(point: RoutePoint, cityId: string): boolean {
  const id = normalizeCityKey(cityId);
  if (!id) return false;
  if (normalizeCityKey(point.cityId) === id) return true;
  if (normalizeCityKey(point.placeId) === id) return true;
  // AI route points often omit cityId — match ASCII city name slug.
  if (slugifyLoose(point.city) === id) return true;
  return false;
}

type TimelineNode =
  | {
      kind: "route";
      routeIndex: number;
      sortMs: number | null;
      seq: number;
    }
  | {
      kind: "place";
      slotIndex: number;
      placeIndex: number;
      sortMs: number | null;
      seq: number;
    }
  | {
      kind: "eat";
      slotIndex: number;
      eatIndex: number;
      sortMs: number | null;
      seq: number;
    };

function routeSortMs(route: TripPlannerAiResponseRoute): number | null {
  return (
    parseMs(route.departure?.datetime) ?? parseMs(route.arrival?.datetime)
  );
}

function placeSortMs(
  dayDate: string,
  slot: TripPlannerAiResponsePlace,
  place: TripPlannerAiResponseNestedPlace | TripPlannerAiResponseLocationPlace
): number | null {
  const offsetAnchor = slot.freeTime?.start ?? slot.freeTime?.end;
  return (
    parseVisitMs(dayDate, place.bestVisitTime?.from, offsetAnchor) ??
    parseMs(slot.freeTime?.start) ??
    parseMs(slot.freeTime?.end)
  );
}

/**
 * Structural place-slot vs route order.
 * Negative → place/eat before route; positive → after; null → unknown.
 *
 * Free-time windows and city identity beat raw timestamps so return/home
 * flights cannot sort ahead of destination visits (common when AI HH:mm
 * visit times were compared as UTC against offset flight ISOs).
 */
function compareSlotVsRoute(
  slot: TripPlannerAiResponsePlace,
  route: TripPlannerAiResponseRoute
): number | null {
  const endMs = parseMs(slot.freeTime?.end);
  const startMs = parseMs(slot.freeTime?.start);
  const depMs = parseMs(route.departure?.datetime);
  const arrMs = parseMs(route.arrival?.datetime);

  // Window ends at/before departure → visit, then leave (incl. flight home).
  if (endMs != null && depMs != null && endMs <= depMs) return -1;
  // Window starts at/after arrival → arrive, then visit.
  if (startMs != null && arrMs != null && startMs >= arrMs) return 1;

  // Departure after free-time start on the same stay → places before leaving.
  if (
    startMs != null &&
    depMs != null &&
    startMs < depMs &&
    pointMatchesCity(route.from, slot.cityId) &&
    !pointMatchesCity(route.to, slot.cityId)
  ) {
    return -1;
  }
  // Arrival before free-time end → inbound leg before places.
  if (
    endMs != null &&
    arrMs != null &&
    arrMs < endMs &&
    pointMatchesCity(route.to, slot.cityId) &&
    !pointMatchesCity(route.from, slot.cityId)
  ) {
    return 1;
  }

  // Soft / untimed freeTime: city identity (return home = leave slot city).
  const leavesCity = pointMatchesCity(route.from, slot.cityId);
  const arrivesCity = pointMatchesCity(route.to, slot.cityId);
  if (leavesCity && !arrivesCity) return -1;
  if (arrivesCity && !leavesCity) return 1;

  return null;
}

function dayHasSharedOrders(day: TripPlannerAiResponseDay): boolean {
  const routeOrdered = (day.routes ?? []).some(
    (route) => typeof route.order === "number" && Number.isFinite(route.order)
  );
  const placeOrdered = (day.places ?? []).some((slot) =>
    (slot.places ?? []).some(
      (place) => typeof place.order === "number" && Number.isFinite(place.order)
    )
  );
  const eatOrdered = (day.places ?? []).some((slot) =>
    (slot.whereToEat ?? []).some(
      (place) => typeof place.order === "number" && Number.isFinite(place.order)
    )
  );
  return routeOrdered || placeOrdered || eatOrdered;
}

/**
 * Stamp `order: 1..n` on every route, nested place, and whereToEat for each day.
 * Skips days that already have shared orders unless `force` is true.
 */
export function assignSharedItineraryOrders(
  itinerary: TripPlannerAiResponseDay[],
  opts?: { force?: boolean }
): TripPlannerAiResponseDay[] {
  return itinerary.map((day) => {
    if (!opts?.force && dayHasSharedOrders(day)) return day;
    return assignDayOrders(day);
  });
}

function assignDayOrders(day: TripPlannerAiResponseDay): TripPlannerAiResponseDay {
  const routes = (day.routes ?? []).map((route) => ({ ...route }));
  const places = (day.places ?? []).map((slot) => ({
    ...slot,
    places: (slot.places ?? []).map((place) => ({ ...place })),
    whereToEat: (slot.whereToEat ?? []).map((place) => ({ ...place })),
  }));

  const nodes: TimelineNode[] = [];
  let seq = 0;

  routes.forEach((route, routeIndex) => {
    nodes.push({
      kind: "route",
      routeIndex,
      sortMs: routeSortMs(route),
      seq: seq++,
    });
  });

  places.forEach((slot, slotIndex) => {
    (slot.places ?? []).forEach((place, placeIndex) => {
      nodes.push({
        kind: "place",
        slotIndex,
        placeIndex,
        sortMs: placeSortMs(day.date, slot, place),
        seq: seq++,
      });
    });
    (slot.whereToEat ?? []).forEach((place, eatIndex) => {
      nodes.push({
        kind: "eat",
        slotIndex,
        eatIndex,
        sortMs: placeSortMs(day.date, slot, place),
        seq: seq++,
      });
    });
  });

  nodes.sort((a, b) => {
    const aSlotIndex =
      a.kind === "place" || a.kind === "eat" ? a.slotIndex : null;
    const bSlotIndex =
      b.kind === "place" || b.kind === "eat" ? b.slotIndex : null;

    // Structure first: freeTime / city vs route (fixes return-flight-before-visits).
    if (aSlotIndex != null && b.kind === "route") {
      const rel = compareSlotVsRoute(
        places[aSlotIndex]!,
        routes[b.routeIndex]!
      );
      if (rel != null) return rel;
    }
    if (a.kind === "route" && bSlotIndex != null) {
      const rel = compareSlotVsRoute(
        places[bSlotIndex]!,
        routes[a.routeIndex]!
      );
      if (rel != null) return -rel;
    }

    if (a.sortMs != null && b.sortMs != null && a.sortMs !== b.sortMs) {
      return a.sortMs - b.sortMs;
    }
    if (a.sortMs != null && b.sortMs == null) return -1;
    if (a.sortMs == null && b.sortMs != null) return 1;

    return a.seq - b.seq;
  });

  let order = 1;
  for (const node of nodes) {
    if (node.kind === "route") {
      routes[node.routeIndex] = {
        ...routes[node.routeIndex]!,
        order: order++,
      };
    } else if (node.kind === "place") {
      const slot = places[node.slotIndex]!;
      const nested = slot.places[node.placeIndex]!;
      slot.places[node.placeIndex] = { ...nested, order: order++ };
    } else {
      const slot = places[node.slotIndex]!;
      const nested = slot.whereToEat![node.eatIndex]!;
      slot.whereToEat![node.eatIndex] = { ...nested, order: order++ };
    }
  }

  return {
    ...day,
    routes,
    places: places.map((slot) => {
      const { whereToEat, ...rest } = slot;
      return {
        ...rest,
        ...(whereToEat?.length ? { whereToEat } : {}),
      };
    }),
  };
}
