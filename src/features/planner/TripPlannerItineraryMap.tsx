"use client";

/**
 * Single reusable Google Map for Trip Planner itinerary days.
 * Mount once at the Places step — update markers/routes when the active day changes.
 * Reuses the shared Maps loader + mapInstanceCache (no second API load).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  centerMapOnCoords,
  googleMapsProvider,
  hasUsableMapCoords,
  isReusableMap,
  popCachedMap,
  pushCachedMap,
  resolveMapsMapId,
  type MapInstance,
  type MapMarkerInput,
  type MarkerRecord,
} from "@/lib/maps";
import { hasGoogleMapsConfigured } from "@/lib/env";
import type { TripRouteTransport } from "@/types/trip-planner";
import { Maximize2 } from "lucide-react";
import { cx } from "@/lib/utils";

const FLIGHT_TRANSPORTS = new Set<TripRouteTransport>(["flight"]);

export type ItineraryMapLeg = {
  id: string;
  transport: TripRouteTransport;
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
};

function createMapHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.style.width = "100%";
  host.style.height = "100%";
  return host;
}

function markersSignature(markers: MapMarkerInput[]): string {
  return markers
    .map(
      (m) =>
        `${m.id}:${m.lat}:${m.lon}:${m.kind ?? "place"}:${m.status ?? ""}:${m.order ?? ""}:${m.selected ? "1" : "0"}:${m.title ?? ""}`
    )
    .join("|");
}

function legsSignature(legs: ItineraryMapLeg[]): string {
  return legs
    .map(
      (l) =>
        `${l.id}:${l.transport}:${l.from.lat}:${l.from.lon}:${l.to.lat}:${l.to.lon}`
    )
    .join("|");
}

function arcMidpoint(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): { lat: number; lng: number } {
  const midLat = (a.lat + b.lat) / 2;
  const midLng = (a.lon + b.lon) / 2;
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  const offset = 0.12;
  return {
    lat: midLat + dx * offset,
    lng: midLng - dy * offset,
  };
}

function resizeMap(map: MapInstance) {
  const center = map.getCenter();
  google.maps.event.trigger(map, "resize");
  if (center) map.setCenter(center);
}

export function TripPlannerItineraryMap({
  markers,
  legs = [],
  selectedMarkerId = null,
  onMarkerSelect,
  fitToken = 0,
  className,
  emptyLabel = "No locations to show on the map",
}: {
  markers: MapMarkerInput[];
  /** Existing trip route legs (and optional place-to-place connections). */
  legs?: ItineraryMapLeg[];
  selectedMarkerId?: string | null;
  onMarkerSelect?: (id: string) => void;
  /** Increment to refit the camera to the current day's markers. */
  fitToken?: number;
  className?: string;
  emptyLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const markerMapRef = useRef<Map<string, MarkerRecord>>(new Map());
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const onMarkerSelectRef = useRef(onMarkerSelect);
  const lastMarkersSigRef = useRef("");
  const lastLegsSigRef = useRef("");
  const lastFitTokenRef = useRef(-1);
  const lastFocusIdRef = useRef<string | null>(null);
  const lastSizeKeyRef = useRef("");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const configured = hasGoogleMapsConfigured();
  onMarkerSelectRef.current = onMarkerSelect;

  const markersWithSelection = useMemo(
    () =>
      markers.map((m) => ({
        ...m,
        selected:
          selectedMarkerId != null &&
          (m.id === selectedMarkerId ||
            m.id.startsWith(`${selectedMarkerId}:`)),
      })),
    [markers, selectedMarkerId]
  );

  const mappableCount = useMemo(
    () =>
      markersWithSelection.filter((m) => hasUsableMapCoords(m.lat, m.lon))
        .length,
    [markersWithSelection]
  );

  // Mount / recycle one map instance for this component lifetime.
  useEffect(() => {
    if (!configured) return;
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    let cancelled = false;
    const { mapId } = resolveMapsMapId();

    const recycleMap = (map: MapInstance) => {
      const host = map.getDiv();
      if (host.parentElement) host.remove();
      pushCachedMap(mapId, map);
    };

    const release = () => {
      for (const line of polylinesRef.current) line.setMap(null);
      polylinesRef.current = [];
      const handles = Array.from(markerMapRef.current.values()).map(
        (r) => r.handle
      );
      googleMapsProvider.clearMarkers(handles);
      markerMapRef.current = new Map();
      lastMarkersSigRef.current = "";
      lastLegsSigRef.current = "";
      const map = mapRef.current;
      mapRef.current = null;
      if (map) recycleMap(map);
    };

    const attach = (map: MapInstance) => {
      mapRef.current = map;
      map.setOptions({ gestureHandling: "cooperative" });
      setReady(true);
    };

    const cached = popCachedMap(mapId);
    if (cached && isReusableMap(cached)) {
      container.appendChild(cached.getDiv());
      const center = cached.getCenter();
      if (center) {
        window.setTimeout(() => {
          if (!cancelled && mapRef.current === cached) {
            cached.setCenter(center);
          }
        }, 0);
      }
      attach(cached);
      return () => {
        cancelled = true;
        setReady(false);
        release();
      };
    }

    const host = createMapHost();
    container.appendChild(host);

    googleMapsProvider
      .createMap({
        element: host,
        center: { lat: 20, lng: 0 },
        zoom: 2,
        mapId,
        gestureHandling: "cooperative",
      })
      .then((map) => {
        if (cancelled) {
          recycleMap(map);
          return;
        }
        attach(map);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load map.");
      });

    return () => {
      cancelled = true;
      setReady(false);
      release();
    };
  }, [configured]);

  // Keep tiles correct when the shell toggles between sticky column / fullscreen
  // or when the host goes from 0×0 → real size (mobile PWA closed → open).
  useEffect(() => {
    const container = containerRef.current;
    const map = mapRef.current;
    if (!ready || !container || !map) return;

    const applySize = (width: number, height: number) => {
      if (width < 2 || height < 2) {
        lastSizeKeyRef.current = "";
        return;
      }
      const key = `${Math.round(width)}x${Math.round(height)}`;
      const wasCollapsed = lastSizeKeyRef.current === "";
      if (key === lastSizeKeyRef.current) return;
      lastSizeKeyRef.current = key;
      resizeMap(map);
      // Only auto-fit when the host first gains a real size (e.g. mobile open).
      if (!wasCollapsed) return;
      const usable = markersWithSelection.filter((m) =>
        hasUsableMapCoords(m.lat, m.lon)
      );
      if (usable.length > 0) {
        googleMapsProvider.fitToMarkers(map, usable);
      }
    };

    applySize(container.clientWidth, container.clientHeight);

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || mapRef.current !== map) return;
      const { width, height } = entry.contentRect;
      applySize(width, height);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [ready, markersWithSelection]);

  // Keep tiles correct when fitToken / className changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    window.setTimeout(() => {
      if (mapRef.current !== map) return;
      resizeMap(map);
    }, 0);
  }, [ready, className, fitToken]);

  // Sync markers (incremental) when the active day's data changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;

    const signature = markersSignature(markersWithSelection);
    if (signature === lastMarkersSigRef.current) return;

    let cancelled = false;

    void (async () => {
      const { next, removed } = await googleMapsProvider.syncMarkers(
        map,
        markersWithSelection,
        new Map(markerMapRef.current),
        (id) => onMarkerSelectRef.current?.(id)
      );
      if (cancelled || !mapRef.current) {
        for (const record of next.values()) record.handle.map = null;
        return;
      }
      googleMapsProvider.clearMarkers(removed);
      markerMapRef.current = next;
      lastMarkersSigRef.current = signature;
    })();

    return () => {
      cancelled = true;
    };
  }, [markersWithSelection, ready]);

  // Sync route / connection polylines.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;

    const signature = legsSignature(legs);
    if (signature === lastLegsSigRef.current) return;
    lastLegsSigRef.current = signature;

    for (const line of polylinesRef.current) line.setMap(null);
    polylinesRef.current = [];

    const lines: google.maps.Polyline[] = [];
    for (const leg of legs) {
      if (
        !hasUsableMapCoords(leg.from.lat, leg.from.lon) ||
        !hasUsableMapCoords(leg.to.lat, leg.to.lon)
      ) {
        continue;
      }
      const flight = FLIGHT_TRANSPORTS.has(leg.transport);
      const isOrderLink = leg.id.startsWith("connect:");
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

      lines.push(
        new google.maps.Polyline({
          path,
          geodesic: !flight,
          map,
          strokeColor: flight ? "#6D28D9" : isOrderLink ? "#9CA3AF" : "#4B5563",
          strokeOpacity: flight ? 0 : isOrderLink ? 0 : 0.7,
          strokeWeight: flight || isOrderLink ? 0 : 3,
          ...((flight || isOrderLink)
            ? {
                icons: [
                  {
                    icon: {
                      path: "M 0,-1 0,1",
                      strokeOpacity: flight ? 0.85 : 0.55,
                      strokeColor: flight ? "#6D28D9" : "#9CA3AF",
                      scale: flight ? 3 : 2,
                    },
                    offset: "0",
                    repeat: flight ? "12px" : "10px",
                  },
                ],
              }
            : {}),
        })
      );
    }
    polylinesRef.current = lines;
  }, [legs, ready]);

  // Fit camera when the day changes or the user requests fit-to-day.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (fitToken === lastFitTokenRef.current) return;
    lastFitTokenRef.current = fitToken;
    lastFocusIdRef.current = null;

    const usable = markersWithSelection.filter((m) =>
      hasUsableMapCoords(m.lat, m.lon)
    );
    if (usable.length === 0) return;

    window.setTimeout(() => {
      if (mapRef.current !== map) return;
      resizeMap(map);
      googleMapsProvider.fitToMarkers(map, usable);
    }, 40);
  }, [fitToken, ready, markersWithSelection]);

  // Focus selected marker without refitting the whole day.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !selectedMarkerId) return;
    if (lastFocusIdRef.current === selectedMarkerId) return;
    lastFocusIdRef.current = selectedMarkerId;

    const marker =
      markersWithSelection.find((m) => m.id === selectedMarkerId) ??
      markersWithSelection.find((m) =>
        m.id.startsWith(`${selectedMarkerId}:`)
      );
    if (!marker || !hasUsableMapCoords(marker.lat, marker.lon)) return;

    centerMapOnCoords(map, { lat: marker.lat, lon: marker.lon }, 14);
  }, [selectedMarkerId, ready, markersWithSelection]);

  if (!configured) {
    return (
      <div
        className={cx(
          "flex h-full items-center justify-center bg-surface px-4 text-center text-sm text-text-secondary",
          className
        )}
      >
        Map is unavailable.
      </div>
    );
  }

  return (
    <div className={cx("relative h-full w-full", className)}>
      {!ready && !error ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface text-sm text-text-secondary">
          Loading map…
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface px-4 text-center text-sm text-error">
          {error}
        </div>
      ) : null}
      {ready && mappableCount === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-surface/80 px-6 text-center text-sm text-text-secondary">
          {emptyLabel}
        </div>
      ) : null}
      {ready && mappableCount > 0 ? (
        <button
          type="button"
          onClick={() => {
            lastFitTokenRef.current = -1;
            const map = mapRef.current;
            if (!map) return;
            const usable = markersWithSelection.filter((m) =>
              hasUsableMapCoords(m.lat, m.lon)
            );
            googleMapsProvider.fitToMarkers(map, usable);
          }}
          className="absolute bottom-3 right-3 z-20 inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated/95 px-2.5 py-2 text-xs font-medium text-text shadow-sm backdrop-blur-sm hover:bg-surface"
          aria-label="Fit map to day"
          title="Fit to day"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Fit day
        </button>
      ) : null}
      <div ref={containerRef} className="h-full w-full" role="img" aria-label="Itinerary day map" />
    </div>
  );
}
