"use client";

import { useEffect, useRef, useState } from "react";
import { devLog } from "@/lib/devLog";
import {
  CityStatusOverlayController,
  centerMapOnCoords,
  getBrowserCityCoords,
  googleMapsProvider,
  hasUsableMapCoords,
  looksLikeGooglePlaceId,
  resolveCoordsFromGooglePlaceId,
  resolveMapsMapId,
  type CityPlaceIdBackfill,
  type CityStatusLocation,
  type MapInstance,
  type MapMarkerHandle,
  type MapMarkerInput,
  type MarkerRecord,
} from "@/lib/maps";

const DEFAULT_CENTER = { lat: 20, lng: 0 };
const DEFAULT_ZOOM = 2;

export type MapInteractionMode = "browse" | "pick-place" | "pick-city";

interface TravelMapProps {
  className?: string;
  markers?: MapMarkerInput[];
  /** Locations used only for DDS city-boundary highlights (pins unchanged). */
  cityLocations?: CityStatusLocation[];
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

/**
 * Google Maps canvas — custom by design (not a Tremor concern).
 * Marker logic is unchanged; city boundaries use a separate DDS controller.
 */
export function TravelMap({
  className,
  markers = [],
  cityLocations = [],
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
  const markerMapRef = useRef<Map<string, MarkerRecord>>(new Map());
  const currentLocationMarkerRef = useRef<MapMarkerHandle | null>(null);
  const cityOverlayRef = useRef<CityStatusOverlayController | null>(null);
  const onCityPlaceIdResolvedRef = useRef(onCityPlaceIdResolved);
  const clickListenerRef = useRef<{ remove: () => void } | null>(null);
  const onMarkerSelectRef = useRef(onMarkerSelect);
  const lastFitSignatureRef = useRef<string>("");
  const lastMarkersSignatureRef = useRef<string>("");
  const didCenterOnUserRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  onMarkerSelectRef.current = onMarkerSelect;
  onCityPlaceIdResolvedRef.current = onCityPlaceIdResolved;

  const mode: MapInteractionMode =
    interactionMode ?? (pickMode ? "pick-place" : "browse");
  const clickEnabled = mode === "pick-place" || mode === "pick-city";
  const citySig = cityLocationsSignature(cityLocations);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || mapRef.current) return;

    let cancelled = false;
    const { mapId } = resolveMapsMapId();

    googleMapsProvider
      .createMap({
        element,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
      })
      .then((map) => {
        if (cancelled) return;
        mapRef.current = map;
        cityOverlayRef.current = new CityStatusOverlayController(map, mapId, {
          onPlaceIdResolved: (batch) => {
            onCityPlaceIdResolvedRef.current?.(batch);
          },
        });
        setReady(true);
        onMapReady?.(map);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Failed to load Google Maps.";
        setError(message);
      });

    return () => {
      cancelled = true;
      const handles = Array.from(markerMapRef.current.values()).map(
        (r) => r.handle
      );
      googleMapsProvider.clearMarkers(handles);
      markerMapRef.current = new Map();
      if (currentLocationMarkerRef.current) {
        googleMapsProvider.clearMarkers([currentLocationMarkerRef.current]);
        currentLocationMarkerRef.current = null;
      }
      cityOverlayRef.current?.clear();
      cityOverlayRef.current = null;
      clickListenerRef.current?.remove();
      mapRef.current = null;
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

    let cancelled = false;
    const signature = markersSignature(markers);
    if (signature === lastMarkersSignatureRef.current) {
      return;
    }

    const existingCopy = new Map(markerMapRef.current);

    void (async () => {
      const hydrated = await hydrateMarkerCoords(markers);
      if (cancelled || !mapRef.current) return;

      const { next, removed } = await googleMapsProvider.syncMarkers(
        mapRef.current,
        hydrated,
        existingCopy,
        (id) => {
          onMarkerSelectRef.current?.(id);
        }
      );

      if (cancelled) {
        // Drop only markers created by this stale sync.
        for (const [id, record] of next) {
          if (markerMapRef.current.get(id)?.handle !== record.handle) {
            record.handle.map = null;
          }
        }
        return;
      }

      googleMapsProvider.clearMarkers(removed);
      markerMapRef.current = next;
      lastMarkersSignatureRef.current = signature;

      // Auto-fit only the first time markers appear (or after the map is
      // cleared back to empty). Do not re-fit when pick mode ends, city
      // intelligence opens, or a favorite pin is added — keep the viewport.
      // Also skip when we already centered on the device location.
      if (hydrated.length === 0) {
        if (lastFitSignatureRef.current !== "__current_location__") {
          lastFitSignatureRef.current = "";
        }
      } else if (fitToMarkers && lastFitSignatureRef.current === "") {
        googleMapsProvider.fitToMarkers(mapRef.current, hydrated);
        lastFitSignatureRef.current = signature;
      }
    })();

    return () => {
      cancelled = true;
    };
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
