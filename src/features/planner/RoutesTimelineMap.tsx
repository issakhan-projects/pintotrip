"use client";

/**
 * Compact route map for Timeline — reuses Google Maps provider.
 * Flights: curved/dashed geodesic. Ground: solid geodesic.
 * Pins: every route hub + trip place with coordinates.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  googleMapsProvider,
  resolveMapsMapId,
  type MapInstance,
  type MapMarkerHandle,
  type MapMarkerInput,
} from "@/lib/maps";
import { hasGoogleMapsConfigured } from "@/lib/env";
import type { TripRouteTransport } from "@/types/trip-planner";
import type { TimelineMapLeg, TimelineMapPoint } from "./timelineHelpers";

const FLIGHT_TRANSPORTS = new Set<TripRouteTransport>(["flight"]);

function isFlight(transport: TripRouteTransport): boolean {
  return FLIGHT_TRANSPORTS.has(transport);
}

/** Midpoint offset for a soft arc between two points (visual only). */
function arcMidpoint(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): { lat: number; lng: number } {
  const midLat = (a.lat + b.lat) / 2;
  const midLng = (a.lon + b.lon) / 2;
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  // Perpendicular offset ~12% of segment length.
  const offset = 0.12;
  return {
    lat: midLat + dx * offset,
    lng: midLng - dy * offset,
  };
}

function pointsToMarkers(points: TimelineMapPoint[]): MapMarkerInput[] {
  return points.map((point) => ({
    id: point.id,
    lat: point.lat,
    lon: point.lon,
    title: point.label,
    kind: point.kind,
    ...(point.status ? { status: point.status } : {}),
  }));
}

/** Fallback when caller only passes legs (no explicit points). */
function markersFromLegs(legs: TimelineMapLeg[]): MapMarkerInput[] {
  const markers: MapMarkerInput[] = [];
  const seen = new Set<string>();
  for (const leg of legs) {
    const fromKey = `${leg.from.lat.toFixed(4)},${leg.from.lon.toFixed(4)}`;
    const toKey = `${leg.to.lat.toFixed(4)},${leg.to.lon.toFixed(4)}`;
    if (!seen.has(fromKey)) {
      seen.add(fromKey);
      markers.push({
        id: `from:${leg.id}`,
        lat: leg.from.lat,
        lon: leg.from.lon,
        title: leg.from.label,
        kind: isFlight(leg.transport) ? "airport" : "city",
      });
    }
    if (!seen.has(toKey)) {
      seen.add(toKey);
      markers.push({
        id: `to:${leg.id}`,
        lat: leg.to.lat,
        lon: leg.to.lon,
        title: leg.to.label,
        kind: isFlight(leg.transport) ? "airport" : "city",
      });
    }
  }
  return markers;
}

export function RoutesTimelineMap({
  legs,
  points,
  className,
}: {
  legs: TimelineMapLeg[];
  /** All pins to show (routes + places). Falls back to leg endpoints. */
  points?: TimelineMapPoint[];
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const markersRef = useRef<MapMarkerHandle[]>([]);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const configured = hasGoogleMapsConfigured();
  const markers = useMemo(
    () =>
      points && points.length > 0
        ? pointsToMarkers(points)
        : markersFromLegs(legs),
    [points, legs]
  );
  const hasContent = markers.length > 0 || legs.length > 0;

  useEffect(() => {
    if (!configured) return;
    const element = containerRef.current;
    if (!element || mapRef.current) return;

    let cancelled = false;
    const { mapId } = resolveMapsMapId();

    googleMapsProvider
      .createMap({
        element,
        center: { lat: 20, lng: 0 },
        zoom: 2,
        mapId,
        gestureHandling: "cooperative",
      })
      .then((map) => {
        if (cancelled) return;
        mapRef.current = map;
        setReady(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load map."
        );
      });

    return () => {
      cancelled = true;
      for (const line of polylinesRef.current) line.setMap(null);
      polylinesRef.current = [];
      googleMapsProvider.clearMarkers(markersRef.current);
      markersRef.current = [];
      mapRef.current = null;
    };
  }, [configured]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;

    let cancelled = false;

    async function draw() {
      for (const line of polylinesRef.current) line.setMap(null);
      polylinesRef.current = [];
      googleMapsProvider.clearMarkers(markersRef.current);
      markersRef.current = [];

      if (markers.length === 0 && legs.length === 0) return;

      if (cancelled || !mapRef.current) return;

      if (markers.length > 0) {
        markersRef.current = await googleMapsProvider.setMarkers(
          mapRef.current,
          markers
        );
        googleMapsProvider.fitToMarkers(mapRef.current, markers);
      }

      const lines: google.maps.Polyline[] = [];
      for (const leg of legs) {
        const flight = isFlight(leg.transport);
        const path: google.maps.LatLngLiteral[] = flight
          ? [
              { lat: leg.from.lat, lng: leg.from.lon },
              arcMidpoint(leg.from, leg.to),
              { lat: leg.to.lat, lng: leg.to.lon },
            ]
          : [
              { lat: leg.from.lat, lng: leg.from.lon },
              { lat: leg.to.lat, lng: leg.to.lon },
            ];

        const polyline = new google.maps.Polyline({
          path,
          geodesic: !flight,
          map: mapRef.current,
          strokeColor: flight ? "#6D28D9" : "#4B5563",
          strokeOpacity: flight ? 0 : 0.75,
          strokeWeight: flight ? 0 : 3,
          ...(flight
            ? {
                icons: [
                  {
                    icon: {
                      path: "M 0,-1 0,1",
                      strokeOpacity: 0.85,
                      strokeColor: "#6D28D9",
                      scale: 3,
                    },
                    offset: "0",
                    repeat: "12px",
                  },
                ],
              }
            : {}),
        });
        lines.push(polyline);
      }
      if (cancelled) {
        for (const line of lines) line.setMap(null);
        return;
      }
      polylinesRef.current = lines;
    }

    void draw();
    return () => {
      cancelled = true;
    };
  }, [legs, markers, ready]);

  if (!configured) return null;

  if (error) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-border bg-surface px-4 text-center text-sm text-text-secondary">
        {error}
      </div>
    );
  }

  if (!hasContent) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border bg-surface/60 px-4 text-center text-sm text-text-secondary">
        Add coordinates to your routes or places to see them on the map.
      </div>
    );
  }

  return (
    <div
      className={className}
      ref={containerRef}
      role="img"
      aria-label="Route map"
    />
  );
}
