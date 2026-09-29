"use client";

import { useEffect, useRef, useState } from "react";
import { devLog } from "@/lib/devLog";
import {
  CityStatusOverlayController,
  centerMapOnCoords,
  getBrowserCityCoords,
  googleMapsProvider,
  hasUsableMapCoords,
  isReusableMap,
  looksLikeGooglePlaceId,
  popCachedMap,
  pushCachedMap,
  resolveCoordsFromGooglePlaceId,
  resolveMapsMapId,
  type CityPlaceIdBackfill,
  type CityStatusLocation,
  type MapInstance,
  type MapMarkerHandle,
  type MapMarkerInput,
  type MarkerRecord,
} from "@/lib/maps";
import {
  LivingRoutesController,
  type LivingRouteLeg,
} from "@/features/map/livingRoutes";

const DEFAULT_CENTER = { lat: 20, lng: 0 };
const DEFAULT_ZOOM = 2;

export type MapInteractionMode = "browse" | "pick-place" | "pick-city";

export type { LivingRouteLeg };

interface TravelMapProps {
  className?: string;
  markers?: MapMarkerInput[];
  /** Locations used only for DDS city-boundary highlights (pins unchanged). */
  cityLocations?: CityStatusLocation[];
  /**
   * Living Travel Map — animated route for an upcoming trip
   * (from → destinations). Hidden while picking on the map.
   */
  livingRoutes?: LivingRouteLeg[];
  /**
   * When false (Planner/Profile/list), pause living-route animation.
   * Map stays mounted; default true.
   */
  livingRoutesActive?: boolean;
  /** Persist resolved locality Place IDs back onto location docs. */
  onCityPlaceIdResolved?: (batch: CityPlaceIdBackfill[]) => void;
  onMarkerSelect?: (id: string) => void;
  onMapReady?: (map: MapInstance) => void;
  onMapClick?: (coords: { lat: number; lng: number }) => void;
  /** @deprecated Prefer interactionMode="pick-place" */
  pickMode?: boolean;
  interactionMode?: MapInteractionMode;
  fitToMarkers?: boolean;
  /** Show a blue-dot marker for the device city (not street-level GPS). Default true. */
  showCurrentLocation?: boolean;
  /** Pan/zoom to the device city when the map first opens. Default true. */
  centerOnCurrentLocation?: boolean;
}

function livingRoutesSignature(legs: LivingRouteLeg[]): string {
  return legs
    .map(
      (l) =>
        `${l.id}:${l.from.lat}:${l.from.lon}:${l.to.lat}:${l.to.lon}:${l.style}`
    )
    .join("|");
}

function markersSignature(markers: MapMarkerInput[]): string {
  return markers
    .map(
      (m) =>
        `${m.id}:${m.lat}:${m.lon}:${m.googlePlaceId ?? ""}:${m.kind ?? "place"}:${m.status ?? ""}:${m.title ?? ""}`
    )
    .sort()
    .join("|");
}

function cityLocationsSignature(locations: CityStatusLocation[]): string {
  return locations
    .map(
      (l) =>
        `${l.id ?? ""}:${l.city.id}:${l.city.googlePlaceId ?? ""}:${l.country.id}:${l.status}:${l.lat}:${l.lon}`
    )
    .sort()
    .join("|");
}

/**
 * Fill Null Island / missing coords from googlePlaceId when present.
 * Drops markers that still have no usable position.
 */
async function hydrateMarkerCoords(
  markers: MapMarkerInput[]
): Promise<MapMarkerInput[]> {
  const resolved = await Promise.all(
    markers.map(async (marker) => {
      if (hasUsableMapCoords(marker.lat, marker.lon)) return marker;

      const placeId = marker.googlePlaceId?.trim();
      if (!looksLikeGooglePlaceId(placeId)) return null;

      const coords = await resolveCoordsFromGooglePlaceId(placeId!);
      if (!coords) return null;

      return { ...marker, lat: coords.lat, lon: coords.lon };
    })
  );

  return resolved.filter((m): m is MapMarkerInput => m != null);
}

function createMapHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.style.width = "100%";
  host.style.height = "100%";
  return host;
}

/**
 * Google Maps canvas — custom by design (not a Tremor concern).
 * Marker logic is unchanged; city boundaries use a separate DDS controller.
 * Map instances are cached and reattached so remounts do not bill another
 * Dynamic Maps load.
 */
export function TravelMap({
  className,
  markers = [],
  cityLocations = [],
  livingRoutes = [],
  livingRoutesActive = true,
  onCityPlaceIdResolved,
  onMarkerSelect,
  onMapReady,
  onMapClick,
  pickMode = false,
  interactionMode,
  fitToMarkers = true,
  showCurrentLocation = true,
  centerOnCurrentLocation = true,
}: TravelMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapInstance | null>(null);
  /** Maps API getDiv() is typed HTMLElement; hosts we create are HTMLDivElement. */
  const mapHostRef = useRef<HTMLElement | null>(null);
  const markerMapRef = useRef<Map<string, MarkerRecord>>(new Map());
  const markersRef = useRef(markers);
  const markersSyncGenRef = useRef(0);
  const currentLocationMarkerRef = useRef<MapMarkerHandle | null>(null);
  const cityOverlayRef = useRef<CityStatusOverlayController | null>(null);
  const livingRoutesRef = useRef<LivingRoutesController | null>(null);
  const livingRoutesLegsRef = useRef(livingRoutes);
  const onCityPlaceIdResolvedRef = useRef(onCityPlaceIdResolved);
  const clickListenerRef = useRef<{ remove: () => void } | null>(null);
  const onMarkerSelectRef = useRef(onMarkerSelect);
  const lastFitSignatureRef = useRef<string>("");
  const lastMarkersSignatureRef = useRef<string>("");
  const didCenterOnUserRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  markersRef.current = markers;
  livingRoutesLegsRef.current = livingRoutes;
  onMarkerSelectRef.current = onMarkerSelect;
  onCityPlaceIdResolvedRef.current = onCityPlaceIdResolved;

  const mode: MapInteractionMode =
    interactionMode ?? (pickMode ? "pick-place" : "browse");
  const clickEnabled = mode === "pick-place" || mode === "pick-city";
  const citySig = cityLocationsSignature(cityLocations);
  const livingSig = livingRoutesSignature(livingRoutes);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    let cancelled = false;
    const { mapId } = resolveMapsMapId();

    const recycleMap = (map: MapInstance) => {
      const host = map.getDiv();
      if (host.parentElement) host.remove();
      pushCachedMap(mapId, map);
    };

    const releaseUi = () => {
      setReady(false);
      const handles = Array.from(markerMapRef.current.values()).map(
        (r) => r.handle
      );
      googleMapsProvider.clearMarkers(handles);
      markerMapRef.current = new Map();
      lastMarkersSignatureRef.current = "";
      markersSyncGenRef.current += 1;
      if (currentLocationMarkerRef.current) {
        googleMapsProvider.clearMarkers([currentLocationMarkerRef.current]);
        currentLocationMarkerRef.current = null;
      }
      cityOverlayRef.current?.clear();
      cityOverlayRef.current = null;
      livingRoutesRef.current?.destroy();
      livingRoutesRef.current = null;
      clickListenerRef.current?.remove();
      clickListenerRef.current = null;
      const map = mapRef.current;
      mapRef.current = null;
      mapHostRef.current = null;
      if (map) recycleMap(map);
    };

    const attachControllers = (map: MapInstance) => {
      mapRef.current = map;
      map.setOptions({
        gestureHandling: "greedy",
        draggableCursor: null,
        draggingCursor: null,
      });
      cityOverlayRef.current = new CityStatusOverlayController(map, mapId, {
        onPlaceIdResolved: (batch) => {
          onCityPlaceIdResolvedRef.current?.(batch);
        },
      });
      livingRoutesRef.current = new LivingRoutesController(map);
      setReady(true);
      onMapReady?.(map);
    };

    const cached = popCachedMap(mapId);
    if (cached && isReusableMap(cached)) {
      const host = cached.getDiv();
      mapHostRef.current = host;
      container.appendChild(host);
      // Detach/reattach can collapse tile layout — nudge a camera update.
      const center = cached.getCenter();
      if (center) {
        window.setTimeout(() => {
          if (!cancelled && mapRef.current === cached) {
            cached.setCenter(center);
          }
        }, 0);
      }
      // Keep the reused camera; skip first device-city snap / fit-to-markers.
      didCenterOnUserRef.current = true;
      lastFitSignatureRef.current = "__reused_map__";
      lastMarkersSignatureRef.current = "";
      attachControllers(cached);
      return () => {
        cancelled = true;
        releaseUi();
      };
    }

    const host = createMapHost();
    mapHostRef.current = host;
    container.appendChild(host);

    googleMapsProvider
      .createMap({
        element: host,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
      })
      .then((map) => {
        if (cancelled) {
          // Strict Mode / fast unmount — keep the paid load for the next mount.
          recycleMap(map);
          return;
        }
        attachControllers(map);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Failed to load Google Maps.";
        setError(message);
      });

    return () => {
      cancelled = true;
      releaseUi();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!showCurrentLocation && !centerOnCurrentLocation) return;

    let cancelled = false;

    void (async () => {
      // Snap GPS to city center so the blue dot / initial view stay city-level.
      const coords = await getBrowserCityCoords({ timeoutMs: 10_000 });
      if (cancelled || !coords || !mapRef.current) return;

      if (showCurrentLocation) {
        currentLocationMarkerRef.current =
          await googleMapsProvider.setCurrentLocationMarker(
            mapRef.current,
            coords,
            currentLocationMarkerRef.current
          );
      }

      if (centerOnCurrentLocation && !didCenterOnUserRef.current) {
        centerMapOnCoords(mapRef.current, coords);
        didCenterOnUserRef.current = true;
        // Prefer device location over the initial fit-to-markers pass.
        if (lastFitSignatureRef.current === "") {
          lastFitSignatureRef.current = "__current_location__";
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, showCurrentLocation, centerOnCurrentLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const signature = markersSignature(markers);
    if (signature === lastMarkersSignatureRef.current) {
      return;
    }

    // Generation guard: overlapping hydrate/sync can mutate shared AdvancedMarker
    // handles, leaving a pin at stale coords while markerMapRef reflects a newer set.
    const syncGen = ++markersSyncGenRef.current;

    void (async () => {
      const snapshot = markersRef.current;
      const snapshotSig = markersSignature(snapshot);
      const hydrated = await hydrateMarkerCoords(snapshot);
      if (syncGen !== markersSyncGenRef.current || !mapRef.current) return;

      const { next, removed } = await googleMapsProvider.syncMarkers(
        mapRef.current,
        hydrated,
        new Map(markerMapRef.current),
        (id) => {
          onMarkerSelectRef.current?.(id);
        }
      );

      if (syncGen !== markersSyncGenRef.current) {
        // Drop only markers created by this stale sync.
        for (const [id, record] of next) {
          if (markerMapRef.current.get(id)?.handle !== record.handle) {
            record.handle.map = null;
          }
        }
        // syncMarkers already moved shared handles — restore current positions.
        for (const m of markersRef.current) {
          const record = markerMapRef.current.get(m.id);
          if (record && hasUsableMapCoords(m.lat, m.lon)) {
            record.handle.position = { lat: m.lat, lng: m.lon };
          }
        }
        return;
      }

      googleMapsProvider.clearMarkers(removed);
      markerMapRef.current = next;
      lastMarkersSignatureRef.current = snapshotSig;

      // Auto-fit only the first time markers appear (or after the map is
      // cleared back to empty). Do not re-fit when pick mode ends, city
      // intelligence opens, or a favorite pin is added — keep the viewport.
      // Also skip when we already centered on the device location / reused map.
      if (hydrated.length === 0) {
        if (
          lastFitSignatureRef.current !== "__current_location__" &&
          lastFitSignatureRef.current !== "__reused_map__"
        ) {
          lastFitSignatureRef.current = "";
        }
      } else if (fitToMarkers && lastFitSignatureRef.current === "") {
        googleMapsProvider.fitToMarkers(mapRef.current, hydrated);
        lastFitSignatureRef.current = snapshotSig;
      }
    })();
  }, [markers, ready, fitToMarkers]);

  // Keep backfill handler current without recreating the controller.
  useEffect(() => {
    cityOverlayRef.current?.setPlaceIdResolvedHandler((batch) => {
      onCityPlaceIdResolvedRef.current?.(batch);
    });
  }, [onCityPlaceIdResolved]);
  useEffect(() => {
    if (!ready) return;
    const controller = cityOverlayRef.current;
    if (!controller) return;
    void controller.sync(cityLocations).catch((err) => {
      devLog.error("[PinToTrip DDS] Failed to sync city boundary styles.", err);
    });
  }, [ready, citySig, cityLocations]);

  // Living Travel Map — sync by signature only (no fitBounds / no remount).
  useEffect(() => {
    if (!ready) return;
    const controller = livingRoutesRef.current;
    if (!controller) return;
    controller.setActive(livingRoutesActive);
    controller.setVisible(!clickEnabled);
    controller.sync(livingRoutesLegsRef.current);
  }, [ready, livingSig, livingRoutesActive, clickEnabled]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    if (clickEnabled) {
      map.setOptions({
        draggableCursor: "crosshair",
        draggingCursor: "crosshair",
      });
    } else {
      map.setOptions({
        draggableCursor: null,
        draggingCursor: null,
      });
    }

    clickListenerRef.current?.remove();
    clickListenerRef.current = null;

    if (!clickEnabled || !onMapClick) return;

    clickListenerRef.current = map.addListener(
      "click",
      (event: { latLng?: { lat: () => number; lng: () => number } | null }) => {
        const lat = event.latLng?.lat();
        const lng = event.latLng?.lng();
        if (lat == null || lng == null) return;
        onMapClick({ lat, lng });
      }
    );

    return () => {
      clickListenerRef.current?.remove();
      clickListenerRef.current = null;
    };
  }, [clickEnabled, onMapClick, ready, mode]);

  return (
    <div
      className={className ?? "relative h-full w-full"}
      style={clickEnabled ? { cursor: "crosshair" } : undefined}
    >
      {!ready && !error ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface text-sm text-text-secondary">
          Loading map…
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface px-6 text-center text-sm text-error">
          {error}
        </div>
      ) : null}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
