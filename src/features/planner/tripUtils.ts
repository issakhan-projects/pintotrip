import type { Timestamp } from "firebase/firestore";
import type {
  PreparationItem,
  TripPlannerDoc,
  TripStatus,
} from "@/types/trip-planner";
import type { SavedLocation } from "@/hooks/useLocations";
import { tripDayCount } from "@/services/trip-planner";

export function formatTripDateRange(
  startDate: Timestamp,
  endDate: Timestamp
): string {
  const start = startDate.toDate();
  const end = endDate.toDate();
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth =
    sameYear && start.getMonth() === end.getMonth();

  const startFmt = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(start);

  const endFmt = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: sameMonth ? undefined : "long",
    year: "numeric",
  }).format(end);

  return `${startFmt}–${endFmt}`;
}

/** Hero subtitle: "12 — 17 October 2026" */
export function formatTripHeroDates(
  startDate: Timestamp,
  endDate: Timestamp
): string {
  const start = startDate.toDate();
  const end = endDate.toDate();
  const sameMonth =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth();

  if (sameMonth) {
    const monthYear = new Intl.DateTimeFormat("en-GB", {
      month: "long",
      year: "numeric",
    }).format(end);
    return `${start.getDate()} — ${end.getDate()} ${monthYear}`;
  }

  const startFmt = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(start);
  const endFmt = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(end);
  return `${startFmt} — ${endFmt}`;
}

/** Compact row: "12 Oct 2026 — 17 Oct 2026" */
export function formatTripCompactDateRange(
  startDate: Timestamp,
  endDate: Timestamp
): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${fmt.format(startDate.toDate())} — ${fmt.format(endDate.toDate())}`;
}

export function tripChecklistProgress(
  trip: TripPlannerDoc,
  locations: SavedLocation[]
): { completed: number; total: number } {
  const prep = preparationProgress(trip.preparation.items);
  const places = placesProgress(trip, locations);
  return {
    completed: prep.completed + places.visited,
    total: prep.total + places.total,
  };
}

export function formatCoordinates(
  lat: number,
  lon: number
): string {
  const latHem = lat >= 0 ? "N" : "S";
  const lonHem = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${latHem}, ${Math.abs(lon).toFixed(4)}° ${lonHem}`;
}

export function tripStatusLabel(status: TripStatus): string {
  switch (status) {
    case "planning":
      return "Planning";
    case "upcoming":
      return "Planned";
    case "ongoing":
      return "Ongoing";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
  }
}

export function currencySymbolForCode(code: string): string {
  try {
    const parts = new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
}

export function preparationProgress(items: PreparationItem[]): {
  completed: number;
  total: number;
  percent: number;
} {
  const total = items.length;
  const completed = items.filter((i) => i.completed).length;
  return {
    completed,
    total,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

export function placesProgress(
  trip: TripPlannerDoc,
  locations: SavedLocation[]
): { visited: number; total: number; percent: number } {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const savedPlaceIds = trip.savedPlaceIds ?? [];
  const total = savedPlaceIds.length;
  const itineraryPlaces = (trip.itinerary?.days ?? []).flatMap(
    (d) => d.places ?? []
  );
  let visited = 0;

  for (const id of savedPlaceIds) {
    const place = byId.get(id);
    const itineraryStatus = itineraryPlaces.find(
      (p) => p.locationId === id
    )?.status;
    if (itineraryStatus === "visited" || place?.status === "visited") {
      visited += 1;
    }
  }

  return {
    visited,
    total,
    percent: total === 0 ? 0 : Math.round((visited / total) * 100),
  };
}

/**
 * Overall trip progress blends preparation + places (equal weight when both exist).
 * Trip details count as complete once the document exists.
 */
export function overallTripProgress(
  trip: TripPlannerDoc,
  locations: SavedLocation[]
): number {
  const prep = preparationProgress(trip.preparation.items);
  const places = placesProgress(trip, locations);

  const parts: Array<{ weight: number; percent: number }> = [
    { weight: 1, percent: 100 },
  ];
  if (prep.total > 0) {
    parts.push({ weight: 2, percent: prep.percent });
  }
  if (places.total > 0) {
    parts.push({ weight: 2, percent: places.percent });
  }

  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  return Math.round(
    parts.reduce((sum, part) => sum + part.weight * part.percent, 0) /
      totalWeight
  );
}

export function tripMetaLine(
  trip: TripPlannerDoc,
  locations: SavedLocation[]
): string {
  const days = tripDayCount(trip.startDate, trip.endDate);
  const places = placesProgress(trip, locations);
  return `${days} day${days === 1 ? "" : "s"} · ${places.total} place${places.total === 1 ? "" : "s"}`;
}
