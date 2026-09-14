import { Timestamp } from "firebase/firestore";
import type { SavedLocation } from "@/hooks/useLocations";
import type { ItineraryDay, TripItinerary } from "@/types/trip-planner";
import { addUtcDays, startOfUtcDay } from "@/services/trip-planner";

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
