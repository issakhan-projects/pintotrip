/**
 * Assign a shared sequential `order` (1, 2, 3, …) across routes, places,
 * and whereToEat on each itinerary day — one timeline.
 * Mirrors functions/src/trip/ai/assignSharedOrders.ts.
 */

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

/** Local HH:mm on a calendar day → UTC ms (date-only anchor; sort key only). */
function parseVisitMs(dayDate: string, hhmm?: string): number | null {
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
  const base = Date.parse(`${dayDate}T00:00:00Z`);
  if (!Number.isFinite(base)) return null;
  return base + (hour * 60 + minute) * 60_000;
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
  return (
    parseVisitMs(dayDate, place.bestVisitTime?.from) ??
    parseMs(slot.freeTime?.start) ??
    parseMs(slot.freeTime?.end)
  );
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
    if (a.sortMs != null && b.sortMs != null && a.sortMs !== b.sortMs) {
      return a.sortMs - b.sortMs;
    }
    if (a.sortMs != null && b.sortMs == null) return -1;
    if (a.sortMs == null && b.sortMs != null) return 1;

    const aSlotIndex =
      a.kind === "place" || a.kind === "eat" ? a.slotIndex : null;
    const bSlotIndex =
      b.kind === "place" || b.kind === "eat" ? b.slotIndex : null;

    if (aSlotIndex != null && b.kind === "route") {
      const slot = places[aSlotIndex]!;
      const route = routes[b.routeIndex]!;
      const endMs = parseMs(slot.freeTime?.end);
      const depMs = parseMs(route.departure?.datetime);
      if (endMs != null && depMs != null && endMs <= depMs) return -1;
      const startMs = parseMs(slot.freeTime?.start);
      const arrMs = parseMs(route.arrival?.datetime);
      if (startMs != null && arrMs != null && startMs >= arrMs) return 1;
    }
    if (a.kind === "route" && bSlotIndex != null) {
      const route = routes[a.routeIndex]!;
      const slot = places[bSlotIndex]!;
      const endMs = parseMs(slot.freeTime?.end);
      const depMs = parseMs(route.departure?.datetime);
      if (endMs != null && depMs != null && endMs <= depMs) return 1;
      const startMs = parseMs(slot.freeTime?.start);
      const arrMs = parseMs(route.arrival?.datetime);
      if (startMs != null && arrMs != null && startMs >= arrMs) return -1;
    }

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
