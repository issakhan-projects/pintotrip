/**
 * After shared orders are assigned, ensure every place / whereToEat has a
 * bestVisitTime { from, to } suited to the place type and free-time window.
 */

import type {
  TripPlannerAiResponseDay,
  TripPlannerAiResponseLocationPlace,
  TripPlannerAiResponseNestedPlace,
  TripPlannerAiResponsePlace,
  TripPlannerAiResponseRoute,
} from "./tripPlannerAiTypes";

const DEFAULT_DURATION_MIN = 90;
const MIN_DURATION_MIN = 30;
const MAX_DURATION_MIN = 4 * 60;
const BUFFER_MIN = 15;

function parseHhMm(value?: string): number | null {
  if (!value?.trim()) return null;
  const m = value.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23
  ) {
    return null;
  }
  return hour * 60 + minute;
}

function formatHhMm(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  const hour = Math.floor(clamped / 60);
  const minute = clamped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseIsoLocalMinutes(iso?: string): number | null {
  if (!iso?.trim()) return null;
  // Prefer wall-clock HH:mm from ISO (…T14:30 or …T14:30:00±offset).
  const m = iso.trim().match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23
  ) {
    return null;
  }
  return hour * 60 + minute;
}

function clampDuration(raw?: number): number {
  if (raw == null || !Number.isFinite(raw)) return DEFAULT_DURATION_MIN;
  return Math.max(MIN_DURATION_MIN, Math.min(MAX_DURATION_MIN, Math.round(raw)));
}

/** Preferred start minute-of-day by place category (local). */
function preferredStartMinutes(
  category: string | undefined,
  windowStart: number,
  windowEnd: number
): number {
  const mid = Math.floor((windowStart + windowEnd) / 2);
  const pick = (ideal: number) =>
    Math.max(windowStart, Math.min(ideal, Math.max(windowStart, windowEnd - 45)));

  switch (category) {
    case "food":
      // Lunch if window covers midday, else dinner-ish, else mid-window.
      if (windowStart <= 12 * 60 && windowEnd >= 13 * 60) return pick(12 * 60);
      if (windowStart <= 19 * 60 && windowEnd >= 20 * 60) return pick(19 * 60);
      if (windowEnd <= 11 * 60) return pick(9 * 60);
      return pick(mid);
    case "cafe":
      if (windowStart <= 10 * 60 && windowEnd >= 11 * 60) return pick(10 * 60);
      if (windowStart <= 15 * 60 && windowEnd >= 16 * 60) return pick(15 * 60);
      return pick(mid);
    case "market":
      return pick(9 * 60 + 30);
    case "museum":
    case "landmark":
    case "attraction":
      return pick(10 * 60);
    case "park":
    case "nature":
    case "beach":
      return pick(9 * 60);
    case "viewpoint":
      return pick(16 * 60 + 30);
    case "nightlife":
      return pick(20 * 60);
    case "shopping":
      return pick(11 * 60);
    case "wellness":
      return pick(14 * 60);
    case "adventure":
      return pick(9 * 60);
    default:
      return pick(Math.max(windowStart, 10 * 60));
  }
}

function categoryOf(
  place: TripPlannerAiResponseNestedPlace | TripPlannerAiResponseLocationPlace
): string | undefined {
  if ("category" in place && typeof place.category === "string") {
    return place.category;
  }
  return undefined;
}

function freeTimeBounds(slot: TripPlannerAiResponsePlace): {
  start: number;
  end: number;
} {
  const start =
    parseIsoLocalMinutes(slot.freeTime?.start) ??
    parseHhMm("09:00")!;
  const end =
    parseIsoLocalMinutes(slot.freeTime?.end) ??
    parseHhMm("21:00")!;
  if (end <= start + 30) {
    return { start, end: start + 180 };
  }
  return { start, end };
}

function existingWindow(
  place: TripPlannerAiResponseNestedPlace | TripPlannerAiResponseLocationPlace
): { from: number; to: number } | null {
  const from = parseHhMm(place.bestVisitTime?.from);
  const to = parseHhMm(place.bestVisitTime?.to);
  if (from == null || to == null || to <= from) return null;
  return { from, to };
}

type TimelineItem =
  | { kind: "route"; route: TripPlannerAiResponseRoute; order: number }
  | {
      kind: "place";
      slotIndex: number;
      placeIndex: number;
      order: number;
      isEat: boolean;
    };

/**
 * Stamp bestVisitTime on every place / whereToEat.
 * Keeps valid AI windows; fills gaps with category-aware times inside freeTime,
 * packed sequentially after prior timeline items when possible.
 */
export function assignPlaceVisitTimes(
  itinerary: TripPlannerAiResponseDay[]
): TripPlannerAiResponseDay[] {
  return itinerary.map((day) => assignDayVisitTimes(day));
}

function assignDayVisitTimes(
  day: TripPlannerAiResponseDay
): TripPlannerAiResponseDay {
  const routes = (day.routes ?? []).map((r) => ({ ...r }));
  const places = (day.places ?? []).map((slot) => ({
    ...slot,
    places: (slot.places ?? []).map((p) => ({ ...p })),
    whereToEat: (slot.whereToEat ?? []).map((p) => ({ ...p })),
  }));

  const items: TimelineItem[] = [];
  routes.forEach((route) => {
    items.push({
      kind: "route",
      route,
      order:
        typeof route.order === "number" && Number.isFinite(route.order)
          ? route.order
          : Number.POSITIVE_INFINITY,
    });
  });
  places.forEach((slot, slotIndex) => {
    (slot.places ?? []).forEach((_, placeIndex) => {
      const place = slot.places[placeIndex]!;
      items.push({
        kind: "place",
        slotIndex,
        placeIndex,
        isEat: false,
        order:
          typeof place.order === "number" && Number.isFinite(place.order)
            ? place.order
            : Number.POSITIVE_INFINITY,
      });
    });
    (slot.whereToEat ?? []).forEach((_, placeIndex) => {
      const place = slot.whereToEat![placeIndex]!;
      items.push({
        kind: "place",
        slotIndex,
        placeIndex,
        isEat: true,
        order:
          typeof place.order === "number" && Number.isFinite(place.order)
            ? place.order
            : Number.POSITIVE_INFINITY,
      });
    });
  });

  items.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return 0;
  });

  let cursor: number | null = null;

  for (const item of items) {
    if (item.kind === "route") {
      const dep = parseIsoLocalMinutes(item.route.departure?.datetime);
      const arr = parseIsoLocalMinutes(item.route.arrival?.datetime);
      if (arr != null) cursor = arr + BUFFER_MIN;
      else if (dep != null) cursor = dep + BUFFER_MIN;
      continue;
    }

    const slot = places[item.slotIndex]!;
    const place = item.isEat
      ? slot.whereToEat![item.placeIndex]!
      : slot.places[item.placeIndex]!;
    const bounds = freeTimeBounds(slot);
    const duration = clampDuration(
      place.durationMinutes ??
        (item.isEat || categoryOf(place) === "food" || categoryOf(place) === "cafe"
          ? 60
          : undefined)
    );

    const existing = existingWindow(place);
    let from: number;
    let to: number;

    if (
      existing &&
      existing.from >= bounds.start - 30 &&
      existing.to <= bounds.end + 30
    ) {
      from = existing.from;
      to = existing.to;
    } else {
      const preferred = preferredStartMinutes(
        item.isEat ? categoryOf(place) ?? "food" : categoryOf(place),
        bounds.start,
        bounds.end
      );
      const earliest =
        cursor != null
          ? Math.max(bounds.start, cursor)
          : bounds.start;
      from = Math.max(earliest, Math.min(preferred, bounds.end - MIN_DURATION_MIN));
      // If preferred is before cursor, just start at cursor.
      if (cursor != null && preferred < cursor) {
        from = Math.min(cursor, bounds.end - MIN_DURATION_MIN);
      }
      from = Math.max(bounds.start, Math.min(from, bounds.end - MIN_DURATION_MIN));
      to = Math.min(bounds.end, from + duration);
      if (to <= from) {
        to = Math.min(bounds.end, from + MIN_DURATION_MIN);
      }
      if (to <= from) {
        from = Math.max(bounds.start, bounds.end - MIN_DURATION_MIN);
        to = bounds.end;
      }
    }

    const stamped = {
      ...place,
      bestVisitTime: { from: formatHhMm(from), to: formatHhMm(to) },
      ...(place.durationMinutes == null
        ? { durationMinutes: Math.max(MIN_DURATION_MIN, to - from) }
        : {}),
    };

    if (item.isEat) {
      slot.whereToEat![item.placeIndex] = stamped as TripPlannerAiResponseLocationPlace;
    } else {
      slot.places[item.placeIndex] = stamped;
    }

    cursor = to + BUFFER_MIN;
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
