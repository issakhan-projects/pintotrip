/**
 * Living Travel Map — animated route overlay for an upcoming trip.
 * Draws a curved/geodesic path with a throttled marching-dash animation.
 *
 * Product note: new trips are stored as status `"planning"`. Treat “upcoming”
 * like the Planner Active tab — future/current trips by dates, not only the
 * rarely-used `"upcoming"` / `"ongoing"` enum values.
 */

import type { TripPlannerDoc } from "@/types/trip-planner";
import { hasUsableMapCoords } from "@/lib/maps";
import { listTripDestinations } from "@/features/planner/tripDestinations";

export type LivingRoutePoint = {
  lat: number;
  lon: number;
  label?: string;
};

export type LivingRouteLeg = {
  id: string;
  tripId: string;
  tripName?: string;
  from: LivingRoutePoint;
  to: LivingRoutePoint;
  /** Curved dashed arc vs solid ground line. */
  style: "flight" | "ground";
};

const PRIMARY = "#6D28D9";
const PRIMARY_SOFT = "#8B5CF6";
/** Treat longer hops as flights for the arc + dash treatment. */
const FLIGHT_DISTANCE_KM = 400;
const CURVE_SAMPLES = 48;

function startOfLocalDay(d = new Date()): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Active = not completed/cancelled and end date is still today or later. */
function isActiveTrip(trip: TripPlannerDoc, today = startOfLocalDay()): boolean {
  if (trip.status === "completed" || trip.status === "cancelled") return false;
  return trip.endDate.toDate() >= today;
}

function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Midpoint offset for a soft visual arc (same idea as RoutesTimelineMap). */
function arcMidpoint(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): { lat: number; lng: number } {
  const midLat = (a.lat + b.lat) / 2;
  const midLng = (a.lon + b.lon) / 2;
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  const offset = 0.14;
  return {
    lat: midLat + dx * offset,
    lng: midLng - dy * offset,
  };
}

function quadraticBezierPath(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  samples = CURVE_SAMPLES
): google.maps.LatLngLiteral[] {
  const mid = arcMidpoint(a, b);
  const path: google.maps.LatLngLiteral[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const u = 1 - t;
    path.push({
      lat: u * u * a.lat + 2 * u * t * mid.lat + t * t * b.lat,
      lng: u * u * a.lon + 2 * u * t * mid.lng + t * t * b.lon,
    });
  }
  return path;
}

function livingRoutesSignature(legs: LivingRouteLeg[]): string {
  return legs
    .map(
      (l) =>
        `${l.id}:${l.from.lat}:${l.from.lon}:${l.to.lat}:${l.to.lon}:${l.style}`
    )
    .join("|");
}

function hubsForTrip(trip: TripPlannerDoc): LivingRoutePoint[] {
  const hubs: LivingRoutePoint[] = [];
  if (hasUsableMapCoords(trip.from.lat, trip.from.lon)) {
    hubs.push({
      lat: trip.from.lat!,
      lon: trip.from.lon!,
      label: trip.from.cityName || trip.from.countryName,
    });
  }
  for (const dest of listTripDestinations(trip)) {
    if (!hasUsableMapCoords(dest.lat, dest.lon)) continue;
    hubs.push({
      lat: dest.lat!,
      lon: dest.lon!,
      label: dest.cityName,
    });
  }
  return hubs;
}

function legsFromHubs(
  trip: TripPlannerDoc,
  hubs: LivingRoutePoint[]
): LivingRouteLeg[] {
  const legs: LivingRouteLeg[] = [];
  for (let i = 0; i < hubs.length - 1; i++) {
    const from = hubs[i]!;
    const to = hubs[i + 1]!;
    const km = haversineKm(from, to);
    if (km < 1) continue;
    legs.push({
      id: `${trip.id}:leg:${i}`,
      tripId: trip.id,
      tripName: trip.name,
      from,
      to,
      style: km >= FLIGHT_DISTANCE_KM ? "flight" : "ground",
    });
  }
  return legs;
}

/**
 * Nearest active trip as city-to-city living route legs.
 * Prefer soonest not-yet-started trip, else currently-running, else soonest
 * active `"planning"` trip. Needs usable lat/lon on from + at least one dest.
 */
export function buildLivingRoutesFromTrips(
  trips: TripPlannerDoc[]
): LivingRouteLeg[] {
  const today = startOfLocalDay();
  const active = trips
    .filter((t) => isActiveTrip(t, today))
    .sort((a, b) => a.startDate.toMillis() - b.startDate.toMillis());

  const notStarted = active.filter((t) => t.startDate.toDate() >= today);
  const inProgress = active.filter((t) => {
    const start = t.startDate.toDate();
    const end = t.endDate.toDate();
    return start < today && end >= today;
  });

  const ordered = [...notStarted, ...inProgress, ...active];
  const seen = new Set<string>();

  for (const trip of ordered) {
    if (seen.has(trip.id)) continue;
    seen.add(trip.id);
    const hubs = hubsForTrip(trip);
    if (hubs.length < 2) continue;
    const legs = legsFromHubs(trip, hubs);
    if (legs.length > 0) return legs;
  }

  return [];
}

type ActiveLeg = {
  line: google.maps.Polyline;
  dashIcon: google.maps.Symbol;
};

/** Dash spacing — offset animates within this period for a marching effect. */
const DASH_REPEAT_PX = 16;
/** Update every Nth frame (~20fps at 60Hz) instead of every paint. */
const FRAME_STRIDE = 3;
const ANIM_MS_PER_LOOP = 2_400;

/**
 * Owns Google Maps polylines + throttled dash-march animation.
 * Call `sync` when legs change; `clear` / `destroy` on teardown.
 * Does not call fitBounds (avoids tile reload storms).
 */
export class LivingRoutesController {
  private map: google.maps.Map;
  private legs: ActiveLeg[] = [];
  private rafId: number | null = null;
  private startMs = 0;
  private frame = 0;
  private lastSignature = "";
  private reducedMotion = false;
  /** False when Map tab is hidden — stop rAF entirely. */
  private active = true;
  /** False in pick mode — hide lines without dropping the signature. */
  private visible = true;
  private onVisibility: (() => void) | null = null;

  constructor(map: google.maps.Map) {
    this.map = map;
    if (typeof window !== "undefined") {
      this.reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      this.onVisibility = () => {
        this.reconcileAnimation();
      };
      document.addEventListener("visibilitychange", this.onVisibility);
    }
  }

  /** Pause animation when the map surface is not shown (Planner/Profile/etc.). */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.reconcileAnimation();
  }

  /** Hide/show overlays without destroying them (pick mode). */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    for (const leg of this.legs) {
      leg.line.setMap(visible ? this.map : null);
    }
    this.reconcileAnimation();
  }

  sync(input: LivingRouteLeg[]): void {
    const signature = livingRoutesSignature(input);
    if (signature === this.lastSignature) {
      this.reconcileAnimation();
      return;
    }
    this.lastSignature = signature;
    this.clearPolylines();

    if (input.length === 0) {
      this.stopAnimation();
      return;
    }

    const next: ActiveLeg[] = [];
    for (const leg of input) {
      const flight = leg.style === "flight";
      const path = flight
        ? quadraticBezierPath(leg.from, leg.to)
        : [
            { lat: leg.from.lat, lng: leg.from.lon },
            { lat: leg.to.lat, lng: leg.to.lon },
          ];

      const dashIcon: google.maps.Symbol = {
        path: "M 0,-1 0,1",
        strokeOpacity: flight ? 0.8 : 0.7,
        strokeColor: flight ? PRIMARY_SOFT : PRIMARY,
        scale: flight ? 3.5 : 3,
      };

      const line = new google.maps.Polyline({
        path,
        geodesic: !flight,
        map: this.visible ? this.map : null,
        strokeOpacity: 0,
        strokeWeight: 0,
        clickable: false,
        zIndex: 2,
        icons: [
          {
            icon: dashIcon,
            offset: "0",
            repeat: `${DASH_REPEAT_PX}px`,
          },
        ],
      });

      next.push({ line, dashIcon });
    }

    this.legs = next;
    this.startMs = performance.now();
    this.frame = 0;

    if (this.reducedMotion) {
      this.applyDashOffset(0);
    } else {
      this.reconcileAnimation();
    }
  }

  clear(): void {
    this.lastSignature = "";
    this.clearPolylines();
    this.stopAnimation();
  }

  destroy(): void {
    this.clear();
    if (this.onVisibility) {
      document.removeEventListener("visibilitychange", this.onVisibility);
      this.onVisibility = null;
    }
  }

  private shouldAnimate(): boolean {
    return (
      this.active &&
      this.visible &&
      !this.reducedMotion &&
      this.legs.length > 0 &&
      (typeof document === "undefined" || !document.hidden)
    );
  }

  private reconcileAnimation(): void {
    if (this.shouldAnimate()) {
      if (this.rafId == null) this.startAnimation();
    } else {
      this.stopAnimation();
    }
  }

  private clearPolylines(): void {
    for (const leg of this.legs) {
      leg.line.setMap(null);
    }
    this.legs = [];
  }

  private stopAnimation(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private startAnimation(): void {
    this.stopAnimation();
    this.startMs = performance.now();
    this.frame = 0;
    const tick = (now: number) => {
      if (!this.shouldAnimate()) {
        this.rafId = null;
        return;
      }
      this.rafId = requestAnimationFrame(tick);
      this.frame += 1;
      if (this.frame % FRAME_STRIDE !== 0) return;
      const elapsed = now - this.startMs;
      const t = (elapsed % ANIM_MS_PER_LOOP) / ANIM_MS_PER_LOOP;
      this.applyDashOffset(t);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /** March dashes along the path — reuses Symbol objects, only offset changes. */
  private applyDashOffset(t: number): void {
    const offsetPx = `${(t * DASH_REPEAT_PX).toFixed(1)}px`;
    for (const leg of this.legs) {
      leg.line.set("icons", [
        {
          icon: leg.dashIcon,
          offset: offsetPx,
          repeat: `${DASH_REPEAT_PX}px`,
        },
      ]);
    }
  }
}
