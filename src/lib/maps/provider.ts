/**
 * Thin Google Maps provider surface for the map screen.
 * Keeps map construction out of UI components.
 */

import type { LocationStatus } from "@/types/location";
import { devLog } from "@/lib/devLog";
import { getGoogleMapsConfig } from "./config";
import { DEMO_MAP_ID } from "./ddsCapabilities";
import { hasUsableMapCoords } from "./geocode";
import { loadMapsLibrary, loadMarkerLibrary } from "./loader";

export interface MapMarkerInput {
  id: string;
  lat: number;
  lon: number;
  title?: string;
  status?: LocationStatus;
  /** Place pins use status colors; city/stay/airport pins use fixed brand accents. */
  kind?: "place" | "city" | "stay" | "airport";
  /**
   * Visit order shown on place pins (1, 2, 3…).
   * Only applied to `kind: "place"` markers.
   */
  order?: number;
  /** Emphasize the pin when the matching itinerary row is selected. */
  selected?: boolean;
  /**
   * Google Place ID fallback when lat/lon are missing or Null Island (0,0).
   * TravelMap resolves geometry before placing the pin.
   */
  googlePlaceId?: string;
  /**
   * Favorite-city travel chips (shown above city pins when present).
   * Sourced from `users/{uid}/favoriteCities`.
   */
  safeRate?: { score: number; outOf?: number };
  currency?: string;
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
  const safe =
    m.safeRate && Number.isFinite(m.safeRate.score)
      ? `${m.safeRate.score}/${m.safeRate.outOf ?? 10}`
      : "";
  return `${m.kind ?? "place"}:${m.status ?? "planned"}:${m.title ?? ""}:${m.order ?? ""}:${m.selected ? "1" : "0"}:${safe}:${m.currency ?? ""}`;
}

const STATUS_HEX: Record<LocationStatus, string> = {
  want_to_visit: "#CA8A04",
  planned: "#2563EB",
  visited: "#16A34A",
  cancelled: "#DC2626",
};

const CITY_PIN_HEX = "#6D28D9";
/** Accommodation / trip-essentials stay pin — distinct from place + city. */
const STAY_PIN_HEX = "#0F766E";
/** Arrival airport pin from trip-essentials flights. */
const AIRPORT_PIN_HEX = "#C2410C";
/** Selected itinerary pin — brand primary. */
const SELECTED_PIN_HEX = "#42005E";

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

function pinSvg(color: string, order?: number, selected = false): string {
  const label =
    typeof order === "number" && Number.isFinite(order) && order > 0
      ? String(Math.floor(order))
      : "";
  const fontSize = label.length >= 3 ? 8 : label.length === 2 ? 9.5 : 11;
  const body = label
    ? `<text x="14" y="16.5" text-anchor="middle" fill="#fff" font-size="${fontSize}" font-weight="700" font-family="system-ui,-apple-system,sans-serif">${label}</text>`
    : `<circle cx="14" cy="13" r="4.5" fill="#fff"/>`;
  if (selected) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44">
      <ellipse cx="17" cy="41" rx="7" ry="2.2" fill="rgba(66,0,94,0.28)"/>
      <path fill="${color}" stroke="#fff" stroke-width="2.5" d="M17 2C9.8 2 4 7.8 4 15c0 9.2 11.2 22.2 12.2 23.3a1.3 1.3 0 0 0 2 0C19.2 37.2 30 24.2 30 15 30 7.8 24.2 2 17 2z"/>
      ${
        label
          ? `<text x="17" y="18.5" text-anchor="middle" fill="#fff" font-size="${fontSize + 1}" font-weight="700" font-family="system-ui,-apple-system,sans-serif">${label}</text>`
          : `<circle cx="17" cy="15" r="5" fill="#fff"/>`
      }
    </svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
    <path fill="${color}" stroke="#fff" stroke-width="2" d="M14 1C7.4 1 2 6.4 2 13c0 8.4 10.2 20.3 11.1 21.3a1.2 1.2 0 0 0 1.8 0C15.8 33.3 26 21.4 26 13 26 6.4 20.6 1 14 1z"/>
    ${body}
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

/** Rounded “bed” badge pin for trip-essentials accommodation. */
function stayPinSvg(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="40" viewBox="0 0 34 40">
    <path fill="${color}" stroke="#fff" stroke-width="2" d="M17 1C9.3 1 3 7.3 3 15c0 10 12 22.5 13.1 23.6a1.3 1.3 0 0 0 1.8 0C19 37.5 31 25 31 15 31 7.3 24.7 1 17 1z"/>
    <rect x="9" y="11" width="16" height="11" rx="2.5" fill="#fff"/>
    <rect x="10.5" y="12.5" width="5" height="4" rx="1" fill="${color}"/>
    <path fill="${color}" d="M10.5 18.5h13v2.2c0 .7-.6 1.3-1.3 1.3h-10.4c-.7 0-1.3-.6-1.3-1.3v-2.2z"/>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/** Plane badge pin for trip-essentials arrival airports. */
function airportPinSvg(color: string): string {
  // Pin tip + white badge with Lucide Plane glyph (rotated for map readability).
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="40" viewBox="0 0 34 40">
    <path fill="${color}" stroke="#fff" stroke-width="2" d="M17 1C9.3 1 3 7.3 3 15c0 10 12 22.5 13.1 23.6a1.3 1.3 0 0 0 1.8 0C19 37.5 31 25 31 15 31 7.3 24.7 1 17 1z"/>
    <circle cx="17" cy="15" r="8.25" fill="#fff"/>
    <g transform="translate(17 15) rotate(-45) scale(0.68) translate(-12 -12)">
      <path fill="${color}" d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>
    </g>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

type MarkerKind = NonNullable<MapMarkerInput["kind"]>;

function pinColorFor(
  kind: MarkerKind,
  status?: LocationStatus,
  selected = false
): string {
  if (selected) return SELECTED_PIN_HEX;
  if (kind === "city") return CITY_PIN_HEX;
  if (kind === "stay") return STAY_PIN_HEX;
  if (kind === "airport") return AIRPORT_PIN_HEX;
  return STATUS_HEX[status ?? "planned"];
}

function formatSafeRateScore(score: number): string {
  if (!Number.isFinite(score)) return "";
  const rounded = Math.round(score * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Same bands as CityIntelligenceResultsView `safeRateTone`. */
function safeRateChipTone(normalized: number): {
  color: string;
  soft: string;
  accent: string;
} {
  if (normalized >= 0.8) {
    return { color: "#15803d", soft: "#d1fae5", accent: "#22c55e" };
  }
  if (normalized >= 0.6) {
    return { color: "#047857", soft: "#a7f3d0", accent: "#10b981" };
  }
  if (normalized >= 0.4) {
    return { color: "#b45309", soft: "#fde68a", accent: "#f59e0b" };
  }
  if (normalized >= 0.2) {
    return { color: "#c2410c", soft: "#fed7aa", accent: "#f97316" };
  }
  return { color: "#b91c1c", soft: "#fecaca", accent: "#ef4444" };
}

function shieldIconSvg(color: string): string {
  return `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3 5 6v5c0 5 3.2 8.6 7 10 3.8-1.4 7-5 7-10V6l-7-3z" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
  </svg>`;
}

function createCityTravelChip(parts: {
  safeRate?: { score: number; outOf?: number };
  currency?: string;
}): HTMLElement | null {
  const currency = parts.currency?.trim().toUpperCase();
  const hasSafe =
    Boolean(parts.safeRate) && Number.isFinite(parts.safeRate!.score);
  if (!hasSafe && !currency) return null;

  const wrap = document.createElement("div");
  wrap.setAttribute("aria-hidden", "true");
  wrap.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "gap:0",
    "pointer-events:none",
    "filter:drop-shadow(0 2px 6px rgba(17,24,39,0.18))",
  ].join(";");

  const chip = document.createElement("div");
  chip.style.cssText = [
    "display:flex",
    "align-items:center",
    "gap:6px",
    "padding:4px 5px 4px 4px",
    "border-radius:14px",
    "background:rgba(255,255,255,0.96)",
    "border:1px solid rgba(232,228,236,0.95)",
    "backdrop-filter:blur(8px)",
    "-webkit-backdrop-filter:blur(8px)",
    "font-family:var(--font-montserrat),system-ui,-apple-system,sans-serif",
    "white-space:nowrap",
  ].join(";");

  if (hasSafe && parts.safeRate) {
    const outOf =
      parts.safeRate.outOf && Number.isFinite(parts.safeRate.outOf)
        ? parts.safeRate.outOf
        : 10;
    const normalized =
      outOf > 0
        ? Math.min(1, Math.max(0, parts.safeRate.score / outOf))
        : 0;
    const tone = safeRateChipTone(normalized);

    const safeBadge = document.createElement("span");
    safeBadge.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "gap:4px",
      "padding:3px 7px 3px 5px",
      "border-radius:10px",
      `background:${tone.soft}`,
      `color:${tone.color}`,
      "box-shadow:inset 0 0 0 1px rgba(255,255,255,0.55)",
    ].join(";");

    const icon = document.createElement("span");
    icon.style.cssText =
      "display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;";
    icon.innerHTML = shieldIconSvg(tone.color);
    safeBadge.appendChild(icon);

    const scoreWrap = document.createElement("span");
    scoreWrap.style.cssText =
      "display:inline-flex;align-items:baseline;gap:1px;line-height:1;";

    const scoreEl = document.createElement("span");
    scoreEl.style.cssText =
      "font-size:12px;font-weight:700;letter-spacing:-0.02em;";
    scoreEl.textContent = formatSafeRateScore(parts.safeRate.score);

    const outEl = document.createElement("span");
    outEl.style.cssText =
      "font-size:9px;font-weight:600;opacity:0.7;letter-spacing:0;";
    outEl.textContent = `/${outOf}`;

    scoreWrap.appendChild(scoreEl);
    scoreWrap.appendChild(outEl);
    safeBadge.appendChild(scoreWrap);
    chip.appendChild(safeBadge);

    if (currency) {
      const curEl = document.createElement("span");
      curEl.style.cssText = [
        "padding-right:4px",
        "font-size:10px",
        "font-weight:700",
        "letter-spacing:0.04em",
        "color:#6b7280",
      ].join(";");
      curEl.textContent = currency;
      chip.appendChild(curEl);
    }
  } else if (currency) {
    chip.style.padding = "5px 10px";
    const curEl = document.createElement("span");
    curEl.style.cssText =
      "font-size:11px;font-weight:700;letter-spacing:0.04em;color:#374151;";
    curEl.textContent = currency;
    chip.appendChild(curEl);
  }

  const caret = document.createElement("div");
  caret.style.cssText = [
    "width:0",
    "height:0",
    "margin-top:-1px",
    "border-left:5px solid transparent",
    "border-right:5px solid transparent",
    "border-top:6px solid rgba(255,255,255,0.96)",
    "filter:drop-shadow(0 1px 0 rgba(232,228,236,0.95))",
  ].join(";");

  wrap.appendChild(chip);
  wrap.appendChild(caret);
  return wrap;
}

function createPinContent(
  color: string,
  title?: string,
  kind: MarkerKind = "place",
  order?: number,
  selected = false,
  travel?: { safeRate?: MapMarkerInput["safeRate"]; currency?: string }
): HTMLElement {
  const img = document.createElement("img");
  img.src =
    kind === "city"
      ? cityPinSvg(color)
      : kind === "stay"
        ? stayPinSvg(color)
        : kind === "airport"
          ? airportPinSvg(color)
          : pinSvg(color, order, selected);
  const placeSelected = kind === "place" && selected;
  img.width = placeSelected ? 34 : kind === "place" ? 28 : kind === "city" ? 32 : 34;
  img.height = placeSelected ? 44 : kind === "place" ? 36 : 40;
  const orderSuffix =
    kind === "place" &&
    typeof order === "number" &&
    Number.isFinite(order) &&
    order > 0
      ? ` (${Math.floor(order)})`
      : "";
  const travelBits: string[] = [];
  if (kind === "city" && travel?.safeRate && Number.isFinite(travel.safeRate.score)) {
    travelBits.push(
      `safety ${formatSafeRateScore(travel.safeRate.score)}/${travel.safeRate.outOf ?? 10}`
    );
  }
  if (kind === "city" && travel?.currency?.trim()) {
    travelBits.push(travel.currency.trim().toUpperCase());
  }
  img.alt =
    (title ??
      (kind === "city"
        ? "City"
        : kind === "stay"
          ? "Accommodation"
          : kind === "airport"
            ? "Airport"
            : "Place")) +
    orderSuffix +
    (travelBits.length ? ` — ${travelBits.join(", ")}` : "");
  img.draggable = false;
  img.style.display = "block";

  if (kind === "city") {
    const chip = createCityTravelChip({
      safeRate: travel?.safeRate,
      currency: travel?.currency,
    });
    if (chip) {
      const wrap = document.createElement("div");
      wrap.style.cssText =
        "display:flex;flex-direction:column;align-items:center;gap:1px;pointer-events:none;";
      wrap.appendChild(chip);
      wrap.appendChild(img);
      // AdvancedMarkerElement anchors custom HTML at the bottom center (pin tip).
      return wrap;
    }
  }

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

const CURRENT_LOCATION_ZOOM = 5;

export const googleMapsProvider: MapProvider = {
  async createMap({ element, center, zoom = 3, mapId, gestureHandling }) {
    const { Map } = await loadMapsLibrary();
    const resolved = resolveMapsMapId(mapId);

    if (resolved.usingDemo) {
      devLog.error(
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
      if (!hasUsableMapCoords(m.lat, m.lon)) continue;

      const visualKey = markerVisualKey(m);
      const prev = existing.get(m.id);

      if (prev) {
        prev.handle.position = { lat: m.lat, lng: m.lon };
        prev.handle.title = m.title ?? "";
        prev.handle.map = map;
        prev.handle.zIndex = m.selected ? 1000 : undefined;
        if (prev.visualKey !== visualKey) {
          const kind = m.kind ?? "place";
          const color = pinColorFor(kind, m.status, m.selected);
          prev.handle.content = createPinContent(
            color,
            m.title,
            kind,
            m.order,
            m.selected,
            { safeRate: m.safeRate, currency: m.currency }
          );
          prev.visualKey = visualKey;
        }
        next.set(m.id, prev);
        existing.delete(m.id);
        continue;
      }

      const kind = m.kind ?? "place";
      const color = pinColorFor(kind, m.status, m.selected);
      const marker = new AdvancedMarkerElement({
        map,
        position: { lat: m.lat, lng: m.lon },
        title: m.title,
        content: createPinContent(color, m.title, kind, m.order, m.selected, {
          safeRate: m.safeRate,
          currency: m.currency,
        }),
        zIndex: m.selected ? 1000 : undefined,
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
    const usable = markers.filter((m) => hasUsableMapCoords(m.lat, m.lon));
    if (usable.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    for (const m of usable) {
      bounds.extend({ lat: m.lat, lng: m.lon });
    }
    map.fitBounds(bounds, 64);
    if (usable.length === 1) {
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
