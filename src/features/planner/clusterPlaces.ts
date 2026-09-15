import { Timestamp } from "firebase/firestore";
import type { SavedLocation } from "@/hooks/useLocations";
import type {
  ItineraryDay,
  ItineraryDayWeather,
  TripDestinationStop,
  TripItinerary,
  TripPlannerDoc,
} from "@/types/trip-planner";
import {
  addUtcDays,
  startOfUtcDay,
  tripDayCount,
} from "@/services/trip-planner";
import {
  destinationCityKey,
  listTripDestinations,
  owningDestinationForDate,
  toIsoDate,
} from "./tripDestinations";

export type PlaceCluster = {
  id: string;
  title: string;
  centroid: { lat: number; lon: number };
  places: SavedLocation[];
};

const EARTH_RADIUS_KM = 6371;
/** Places within this distance (km) tend to share a day cluster. */
const CLUSTER_RADIUS_KM = 1.2;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine distance in kilometers. */
export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Greedy geographic clustering — nearby saved places share a group.
 * No AI / Cloud Function.
 */
export function clusterNearbyPlaces(
  places: SavedLocation[],
  radiusKm = CLUSTER_RADIUS_KM
): PlaceCluster[] {
  const remaining = [...places];
  const clusters: PlaceCluster[] = [];
  let clusterIndex = 0;

  while (remaining.length > 0) {
    const seed = remaining.shift()!;
    const members: SavedLocation[] = [seed];
    let latSum = seed.lat;
    let lonSum = seed.lon;

    for (let i = remaining.length - 1; i >= 0; i -= 1) {
      const candidate = remaining[i]!;
      const centroid = {
        lat: latSum / members.length,
        lon: lonSum / members.length,
      };
      if (distanceKm(centroid, candidate) <= radiusKm) {
        members.push(candidate);
        latSum += candidate.lat;
        lonSum += candidate.lon;
        remaining.splice(i, 1);
      }
    }

    const centroid = {
      lat: latSum / members.length,
      lon: lonSum / members.length,
    };

    clusters.push({
      id: `cluster-${clusterIndex++}`,
      title: clusterTitle(members),
      centroid,
      places: orderPlacesForWalk(members, centroid),
    });
  }

  return clusters.sort((a, b) => {
    if (a.centroid.lat !== b.centroid.lat) {
      return b.centroid.lat - a.centroid.lat;
    }
    return a.centroid.lon - b.centroid.lon;
  });
}

function clusterTitle(places: SavedLocation[]): string {
  const cityCounts = new Map<string, number>();
  for (const place of places) {
    const name = place.city.name || "Area";
    cityCounts.set(name, (cityCounts.get(name) ?? 0) + 1);
  }
  const top = [...cityCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (places.length === 1) return places[0]!.title;
  return top?.[0] ?? "Nearby places";
}

/** Nearest-neighbor order from centroid for a pleasant walking sequence. */
function orderPlacesForWalk(
  places: SavedLocation[],
  start: { lat: number; lon: number }
): SavedLocation[] {
  const leftover = [...places];
  const ordered: SavedLocation[] = [];
  let current = start;

  while (leftover.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < leftover.length; i += 1) {
      const d = distanceKm(current, leftover[i]!);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = leftover.splice(bestIdx, 1)[0]!;
    ordered.push(next);
    current = { lat: next.lat, lon: next.lon };
  }

  return ordered;
}

/**
 * Distribute clusters across trip days and build an itinerary.
 * Client-side planner — organizes the user's saved places only.
 */
export function planItineraryFromPlaces(input: {
  places: SavedLocation[];
  startDate: Date;
  dayCount: number;
}): TripItinerary {
  const { places, startDate, dayCount } = input;
  if (places.length === 0 || dayCount < 1) {
    return { status: "empty", days: [] };
  }

  const clusters = clusterNearbyPlaces(places);
  const days: ItineraryDay[] = [];
  const start = startOfUtcDay(startDate);

  for (let i = 0; i < dayCount; i += 1) {
    days.push({
      day: i + 1,
      date: Timestamp.fromDate(addUtcDays(start, i)),
      title: `Day ${i + 1}`,
      places: [],
    });
  }

  // Round-robin clusters across days, preferring emptier / earlier days.
  clusters.forEach((cluster, index) => {
    const day = days[index % dayCount]!;
    if (day.title.startsWith("Day ")) {
      day.title = cluster.title;
    } else if (!day.title.includes(cluster.title)) {
      day.title = `${day.title} & ${cluster.title}`;
    }
    for (const place of cluster.places) {
      day.places.push({
        locationId: place.id,
        order: day.places.length,
        status: place.status === "visited" ? "visited" : "planned",
      });
    }
  });

  // Drop empty trailing days only if we have fewer clusters than days.
  const nonEmpty = days.filter((d) => d.places.length > 0);
  const finalDays = nonEmpty.length > 0 ? nonEmpty : days;

  return {
    status: "generated",
    days: finalDays.map((d, i) => ({
      ...d,
      day: i + 1,
      date: Timestamp.fromDate(addUtcDays(start, i)),
    })),
  };
}

function placeMatchesDest(
  place: SavedLocation,
  dest: TripDestinationStop
): boolean {
  const destCity = destinationCityKey(dest.cityName, dest.cityId);
  const placeCity = destinationCityKey(place.city.name, place.city.id);
  if (destCity && placeCity && destCity === placeCity) return true;
  return (
    dest.cityName.trim().toLowerCase() === place.city.name.trim().toLowerCase()
  );
}

function slotFromPlace(place: SavedLocation, order: number) {
  return {
    locationId: place.id,
    order,
    status:
      place.status === "visited"
        ? ("visited" as const)
        : ("planned" as const),
  };
}

/**
 * Build one itinerary day per trip calendar day, assigning nearby saved
 * places to the city that owns that date when city dates exist.
 */
export function planItineraryForTrip(input: {
  trip: TripPlannerDoc;
  places: SavedLocation[];
  weatherByIsoDate?: Map<string, ItineraryDayWeather>;
}): TripItinerary {
  const { trip, places, weatherByIsoDate } = input;
  const active = places.filter((p) => p.status !== "cancelled");
  const dayCount = tripDayCount(trip.startDate, trip.endDate);
  if (dayCount < 1) return { status: "empty", days: [] };

  const start = startOfUtcDay(trip.startDate.toDate());
  const destinations = listTripDestinations(trip);
  const days: ItineraryDay[] = [];

  for (let i = 0; i < dayCount; i += 1) {
    const date = addUtcDays(start, i);
    const owner = owningDestinationForDate(destinations, date);
    const iso = toIsoDate(date);
    const weather = weatherByIsoDate?.get(iso);
    days.push({
      day: i + 1,
      date: Timestamp.fromDate(date),
      title: owner?.cityName || `Day ${i + 1}`,
      places: [],
      ...(weather ? { weather } : {}),
    });
  }

  if (active.length === 0) {
    return { status: "generated", days };
  }

  const assigned = new Set<string>();
  const hasCityDates = destinations.some((d) => d.startDate && d.endDate);

  if (hasCityDates) {
    for (const dest of destinations) {
      const destPlaces = active.filter(
        (place) => !assigned.has(place.id) && placeMatchesDest(place, dest)
      );
      const destDays = days.filter((day) => {
        const owner = owningDestinationForDate(destinations, day.date.toDate());
        return owner
          ? destinationCityKey(owner.cityName, owner.cityId) ===
              destinationCityKey(dest.cityName, dest.cityId)
          : false;
      });
      const targetDays = destDays.length > 0 ? destDays : days;
      distributeClusters(destPlaces, targetDays);
      for (const place of destPlaces) assigned.add(place.id);
    }
  }

  const leftover = active.filter((place) => !assigned.has(place.id));
  if (leftover.length > 0) {
    const emptyDays = days.filter((d) => d.places.length === 0);
    const targetDays = emptyDays.length > 0 ? emptyDays : days;
    const groups: SavedLocation[][] = [];
    const grouped = new Set<string>();
    for (const dest of destinations) {
      const group = leftover.filter(
        (place) => !grouped.has(place.id) && placeBelongsToDest(place, dest)
      );
      if (group.length === 0) continue;
      groups.push(group);
      for (const place of group) grouped.add(place.id);
    }
    const rest = leftover.filter((place) => !grouped.has(place.id));
    if (rest.length > 0) groups.push(rest);
    allocateDaySlices(groups, targetDays);
  }

  return {
    status: "generated",
    days,
  };
}

const GEO_NEAR_KM = 80;

function placeBelongsToDest(
  place: SavedLocation,
  dest: TripDestinationStop
): boolean {
  if (placeMatchesDest(place, dest)) return true;
  if (
    typeof dest.lat !== "number" ||
    typeof dest.lon !== "number" ||
    !Number.isFinite(dest.lat) ||
    !Number.isFinite(dest.lon)
  ) {
    return false;
  }
  return (
    distanceKm(
      { lat: place.lat, lon: place.lon },
      { lat: dest.lat, lon: dest.lon }
    ) <= GEO_NEAR_KM
  );
}

/** Contiguous day slices per destination so itineraries do not zigzag cities. */
function allocateDaySlices(
  groups: SavedLocation[][],
  days: ItineraryDay[]
): void {
  if (groups.length === 0 || days.length === 0) return;
  const total = groups.reduce((sum, group) => sum + group.length, 0) || 1;
  let offset = 0;
  groups.forEach((group, index) => {
    const remainingDays = days.length - offset;
    const remainingGroups = groups.length - index;
    if (remainingDays <= 0) {
      distributeClusters(group, days);
      return;
    }
    const ideal = Math.max(1, Math.round((group.length / total) * days.length));
    const share =
      index === groups.length - 1
        ? remainingDays
        : Math.min(remainingDays - (remainingGroups - 1), Math.max(1, ideal));
    const slice = days.slice(offset, offset + Math.max(1, share));
    distributeClusters(group, slice.length > 0 ? slice : days);
    offset += slice.length;
  });
}

function distributeClusters(
  places: SavedLocation[],
  days: ItineraryDay[]
): void {
  if (places.length === 0 || days.length === 0) return;
  const clusters = clusterNearbyPlaces(places);
  clusters.forEach((cluster, index) => {
    const day = days[index % days.length]!;
    if (day.title.startsWith("Day ")) {
      day.title = cluster.title;
    }
    for (const place of cluster.places) {
      if (day.places.some((p) => p.locationId === place.id)) continue;
      day.places.push(slotFromPlace(place, day.places.length));
    }
  });
}
