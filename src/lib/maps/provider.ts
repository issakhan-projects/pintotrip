/**
 * Thin Google Maps provider surface for the map screen.
 * Keeps map construction out of UI components.
 */

import type { LocationStatus } from "@/types/location";
import { getGoogleMapsConfig } from "./config";
import { DEMO_MAP_ID } from "./ddsCapabilities";
import { loadMapsLibrary, loadMarkerLibrary } from "./loader";

export interface MapMarkerInput {
  id: string;
  lat: number;
  lon: number;
  title?: string;
  status?: LocationStatus;
  /** Place pins use status colors; city pins use brand primary. */
  kind?: "place" | "city";
}

export interface CreateMapOptions {
  element: HTMLElement;
  center: { lat: number; lng: number };
  zoom?: number;
  mapId?: string;
  gestureHandling?: string;
}

export type MapMarkerHandle = google.maps.marker.AdvancedMarkerElement;

/** Browser Google Map instance (avoids leaking the `google` namespace into UI files). */
export type MapInstance = google.maps.Map;

export type MarkerRecord = {
  handle: MapMarkerHandle;
  /** Content identity — recreate pin HTML when this changes. */
  visualKey: string;
};

export interface MapProvider {
  createMap(options: CreateMapOptions): Promise<google.maps.Map>;
  setMarkers(
    map: google.maps.Map,
    markers: MapMarkerInput[],
    onSelect?: (id: string) => void
  ): Promise<MapMarkerHandle[]>;
  /**
   * Incremental marker sync: add/update/remove only what changed.
   * Avoids wiping every AdvancedMarkerElement on each locations update.
   * Caller applies `removed` only when the sync is still current.
   */
  syncMarkers(
    map: google.maps.Map,
    markers: MapMarkerInput[],
    existing: Map<string, MarkerRecord>,
    onSelect?: (id: string) => void
  ): Promise<{ next: Map<string, MarkerRecord>; removed: MapMarkerHandle[] }>;
  clearMarkers(markers: MapMarkerHandle[]): void;
  fitToMarkers(map: google.maps.Map, markers: MapMarkerInput[]): void;
  setCurrentLocationMarker(
    map: google.maps.Map,
    coords: { lat: number; lon: number },
    existing?: MapMarkerHandle | null
  ): Promise<MapMarkerHandle>;
}

function markerVisualKey(m: MapMarkerInput): string {
  return `${m.kind ?? "place"}:${m.status ?? "planned"}:${m.title ?? ""}`;
}

const STATUS_HEX: Record<LocationStatus, string> = {
  planned: "#2563EB",
  visited: "#16A34A",
  cancelled: "#DC2626",
};

const CITY_PIN_HEX = "#6D28D9";

export { DEMO_MAP_ID };

/** Resolve Map ID used for createMap (env → explicit → DEMO fallback). */
export function resolveMapsMapId(explicit?: string): {
  mapId: string;
  fromEnv: boolean;
  usingDemo: boolean;
} {
  const config = getGoogleMapsConfig();
  const envMapId = config.mapId?.trim() || "";
  const explicitId = explicit?.trim() || "";
  const fromEnv = Boolean(envMapId);
  const mapId = explicitId || envMapId || DEMO_MAP_ID;
  return {
    mapId,
    fromEnv,
    usingDemo: mapId === DEMO_MAP_ID,
  };
}

function pinSvg(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
    <path fill="${color}" stroke="#fff" stroke-width="2" d="M14 1C7.4 1 2 6.4 2 13c0 8.4 10.2 20.3 11.1 21.3a1.2 1.2 0 0 0 1.8 0C15.8 33.3 26 21.4 26 13 26 6.4 20.6 1 14 1z"/>
    <circle cx="14" cy="13" r="4.5" fill="#fff"/>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function cityPinSvg(color: string): string {
  // Slightly larger pin with a star-dot so city favorites read differently from places.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
    <path fill="${color}" stroke="#fff" stroke-width="2" d="M16 1C8.3 1 2 7.3 2 15c0 10 12 22.5 13.1 23.6a1.3 1.3 0 0 0 1.8 0C18 37.5 30 25 30 15 30 7.3 23.7 1 16 1z"/>
    <circle cx="16" cy="15" r="5.5" fill="#fff"/>
    <path fill="${color}" d="M16 10.2l1.1 2.3 2.5.4-1.8 1.8.4 2.5-2.2-1.2-2.2 1.2.4-2.5-1.8-1.8 2.5-.4z"/>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function createPinContent(
  color: string,
  title?: string,
  kind: "place" | "city" = "place"
): HTMLElement {
  const img = document.createElement("img");
  img.src = kind === "city" ? cityPinSvg(color) : pinSvg(color);
  img.width = kind === "city" ? 32 : 28;
  img.height = kind === "city" ? 40 : 36;
  img.alt = title ?? (kind === "city" ? "City" : "Place");
  img.draggable = false;
  img.style.display = "block";
  // AdvancedMarkerElement anchors custom HTML at the bottom center (pin tip).
  return img;
}

/** Google-style blue accuracy/dot for the device location. */
function createCurrentLocationContent(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText =
    "position:relative;width:18px;height:18px;pointer-events:none;";
  wrap.innerHTML = `<span style="
      position:absolute;inset:-10px;border-radius:9999px;
      background:rgba(66,133,244,0.2);
    "></span>
    <span style="
      position:absolute;inset:0;border-radius:9999px;
      background:#4285F4;border:2.5px solid #fff;
      box-shadow:0 1px 4px rgba(0,0,0,0.35);
    "></span>`;
  return wrap;
}

const CURRENT_LOCATION_ZOOM = 13;

export const googleMapsProvider: MapProvider = {
  async createMap({ element, center, zoom = 3, mapId, gestureHandling }) {
    const { Map } = await loadMapsLibrary();
    const resolved = resolveMapsMapId(mapId);

    if (resolved.usingDemo) {
      console.error(
        "[PinToTrip DDS] NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID is missing or empty in .env.local. " +
          "Pins still work via DEMO_MAP_ID, but city boundaries require a Cloud Console " +
          "JavaScript VECTOR Map ID with the LOCALITY feature layer enabled. " +
          "Set the value, then restart `npm run dev`."
      );
    }

    return new Map(element, {
      center,
      zoom,
      mapId: resolved.mapId,
      disableDefaultUI: false,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      zoomControl: true,
      gestureHandling: gestureHandling ?? "greedy",
      clickableIcons: false,
    });
  },

  async setMarkers(map, markers, onSelect) {
    const { next, removed } = await this.syncMarkers(
      map,
      markers,
      new Map(),
      onSelect
    );
    this.clearMarkers(removed);
    return Array.from(next.values()).map((r) => r.handle);
  },

  async syncMarkers(map, markers, existing, onSelect) {
    const { AdvancedMarkerElement } = await loadMarkerLibrary();
    const next = new Map<string, MarkerRecord>();
    const removed: MapMarkerHandle[] = [];

    for (const m of markers) {
      const visualKey = markerVisualKey(m);
      const prev = existing.get(m.id);

      if (prev) {
        prev.handle.position = { lat: m.lat, lng: m.lon };
        prev.handle.title = m.title ?? "";
        prev.handle.map = map;
        if (prev.visualKey !== visualKey) {
          const kind = m.kind ?? "place";
          const color =
            kind === "city" ? CITY_PIN_HEX : STATUS_HEX[m.status ?? "planned"];
          prev.handle.content = createPinContent(color, m.title, kind);
          prev.visualKey = visualKey;
        }
        next.set(m.id, prev);
        existing.delete(m.id);
        continue;
      }

      const kind = m.kind ?? "place";
      const color =
        kind === "city" ? CITY_PIN_HEX : STATUS_HEX[m.status ?? "planned"];
      const marker = new AdvancedMarkerElement({
        map,
        position: { lat: m.lat, lng: m.lon },
        title: m.title,
        content: createPinContent(color, m.title, kind),
        gmpClickable: Boolean(onSelect),
      });

      if (onSelect) {
        marker.addEventListener("gmp-click", () => onSelect(m.id));
      }

      next.set(m.id, { handle: marker, visualKey });
    }

    for (const [, record] of existing) {
      removed.push(record.handle);
    }

    return { next, removed };
  },

  clearMarkers(markers) {
    for (const marker of markers) {
      marker.map = null;
    }
  },

  fitToMarkers(map, markers) {
    if (markers.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    for (const m of markers) {
      bounds.extend({ lat: m.lat, lng: m.lon });
    }
    map.fitBounds(bounds, 64);
    if (markers.length === 1) {
      map.setZoom(Math.min(map.getZoom() ?? 12, 12));
    }
  },

  async setCurrentLocationMarker(map, coords, existing) {
    if (existing) {
      existing.position = { lat: coords.lat, lng: coords.lon };
      existing.map = map;
      return existing;
    }

    const { AdvancedMarkerElement } = await loadMarkerLibrary();
    return new AdvancedMarkerElement({
      map,
      position: { lat: coords.lat, lng: coords.lon },
      title: "Current location",
      content: createCurrentLocationContent(),
      zIndex: 999,
      gmpClickable: false,
    });
  },
};

export function centerMapOnCoords(
  map: google.maps.Map,
  coords: { lat: number; lon: number },
  zoom = CURRENT_LOCATION_ZOOM
): void {
  map.panTo({ lat: coords.lat, lng: coords.lon });
  map.setZoom(zoom);
}
