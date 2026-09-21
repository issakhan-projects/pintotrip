/**
 * Localhost-only Google Places API request counter.
 * Logs every network call (and cache hits) via devLog for realtime billing insight.
 */

import { devLog, isDevLoggingEnabled } from "@/lib/devLog";

export type PlacesApiKind =
  | "textSearch"
  | "placeDetails"
  | "placePhotos"
  | "autocomplete"
  | "other";

export type PlacesApiUsageSnapshot = {
  /** Billable / network Places API calls this page session. */
  network: number;
  /** Served from in-memory cache (no new Places request). */
  cacheHits: number;
  byKind: Record<PlacesApiKind, { network: number; cacheHits: number }>;
  lastAt: number | null;
  lastKind: PlacesApiKind | null;
  lastSource: string | null;
};

type TrackInput = {
  kind: PlacesApiKind;
  /** Call site label, e.g. "add-place/search", "cityPlaceId". */
  source: string;
  detail?: Record<string, unknown>;
};

const emptyByKind = (): PlacesApiUsageSnapshot["byKind"] => ({
  textSearch: { network: 0, cacheHits: 0 },
  placeDetails: { network: 0, cacheHits: 0 },
  placePhotos: { network: 0, cacheHits: 0 },
  autocomplete: { network: 0, cacheHits: 0 },
  other: { network: 0, cacheHits: 0 },
});

const state: PlacesApiUsageSnapshot = {
  network: 0,
  cacheHits: 0,
  byKind: emptyByKind(),
  lastAt: null,
  lastKind: null,
  lastSource: null,
};

type Listener = (snapshot: PlacesApiUsageSnapshot) => void;
const listeners = new Set<Listener>();

function snapshot(): PlacesApiUsageSnapshot {
  return {
    network: state.network,
    cacheHits: state.cacheHits,
    byKind: {
      textSearch: { ...state.byKind.textSearch },
      placeDetails: { ...state.byKind.placeDetails },
      placePhotos: { ...state.byKind.placePhotos },
      autocomplete: { ...state.byKind.autocomplete },
      other: { ...state.byKind.other },
    },
    lastAt: state.lastAt,
    lastKind: state.lastKind,
    lastSource: state.lastSource,
  };
}

function notify(): void {
  const next = snapshot();
  for (const listener of listeners) {
    try {
      listener(next);
    } catch {
      // ignore subscriber errors
    }
  }
  exposeOnWindow(next);
}

function exposeOnWindow(next: PlacesApiUsageSnapshot): void {
  if (typeof window === "undefined" || !isDevLoggingEnabled()) return;
  (
    window as Window & {
      __PIN_TO_TRIP_PLACES_API__?: PlacesApiUsageSnapshot & {
        reset: () => void;
      };
    }
  ).__PIN_TO_TRIP_PLACES_API__ = {
    ...next,
    reset: resetPlacesApiUsage,
  };
}

function logLine(
  event: "NETWORK" | "CACHE",
  input: TrackInput,
  totals: PlacesApiUsageSnapshot
): void {
  const detail =
    input.detail && Object.keys(input.detail).length > 0
      ? input.detail
      : undefined;
  devLog.info(
    `[Places API] ${event} #${
      event === "NETWORK" ? totals.network : totals.cacheHits
    }`,
    {
      kind: input.kind,
      source: input.source,
      network: totals.network,
      cacheHits: totals.cacheHits,
      byKind: totals.byKind[input.kind],
      ...(detail ? { detail } : {}),
    }
  );
}

/** Record a real Places API network request (billable). */
export function trackPlacesApiNetwork(input: TrackInput): void {
  if (!isDevLoggingEnabled()) return;
  state.network += 1;
  state.byKind[input.kind].network += 1;
  state.lastAt = Date.now();
  state.lastKind = input.kind;
  state.lastSource = input.source;
  const next = snapshot();
  logLine("NETWORK", input, next);
  notify();
}

/** Record a Places lookup served from cache (not billable). */
export function trackPlacesApiCacheHit(input: TrackInput): void {
  if (!isDevLoggingEnabled()) return;
  state.cacheHits += 1;
  state.byKind[input.kind].cacheHits += 1;
  state.lastAt = Date.now();
  state.lastKind = input.kind;
  state.lastSource = input.source;
  const next = snapshot();
  logLine("CACHE", input, next);
  notify();
}

export function getPlacesApiUsage(): PlacesApiUsageSnapshot {
  return snapshot();
}

export function resetPlacesApiUsage(): void {
  state.network = 0;
  state.cacheHits = 0;
  state.byKind = emptyByKind();
  state.lastAt = null;
  state.lastKind = null;
  state.lastSource = null;
  notify();
  devLog.info("[Places API] counters reset", snapshot());
}

/** Subscribe to realtime counter updates (dev only). */
export function subscribePlacesApiUsage(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
}

if (typeof window !== "undefined" && isDevLoggingEnabled()) {
  exposeOnWindow(snapshot());
}
