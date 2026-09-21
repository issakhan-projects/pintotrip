/**
 * Shared Firestore cache for city airports / train stations.
 * Avoids repeating Places Text Search across trips for the same city.
 *
 * Path: cityTransportCache/{cacheKey}
 * Admin SDK only — never client-readable.
 */

import { createHash } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { adminDb } from "./admin";
import type {
  TripAirport,
  TripDestinationTransport,
  TripTransportLocation,
} from "./transportDiscovery";

const COLLECTION = "cityTransportCache";

/** Airports / stations change rarely — long TTL to cut Places spend. */
export const CITY_TRANSPORT_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export type CityTransportCacheInput = {
  cityName: string;
  countryName?: string;
  cityId?: string;
  countryId?: string;
};

export type CityTransportCacheEntry = {
  cacheKey: string;
  cityName: string;
  countryName?: string;
  cityId?: string;
  countryId?: string;
  airports: TripAirport[];
  trainStations?: TripTransportLocation[];
  /** Places airport Text Search completed (even if zero results). */
  airportsChecked: boolean;
  /** Places train-station Text Search completed (even if zero results). */
  trainStationsChecked?: boolean;
  lastCheckedAt: string;
  expiresAt: FirebaseFirestore.Timestamp;
  updatedAt?: FirebaseFirestore.Timestamp;
};

function asciiSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isAsciiSlug(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === "unknown") return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed);
}

/**
 * Stable ASCII cache key part from preferred id, else slug, else hash of name.
 * Never stores localized script in the Firestore doc id.
 */
function keyPart(preferredId: string | undefined, name: string): string | null {
  if (isAsciiSlug(preferredId)) return preferredId.trim().toLowerCase();
  const slug = asciiSlug(name);
  if (slug && slug !== "unknown") return slug;
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/**
 * Prefer cityId+countryId; fall back to cityName+countryName.
 * Returns null when city cannot be identified.
 */
export function cityTransportCacheKey(
  input: CityTransportCacheInput
): string | null {
  const cityName =
    typeof input.cityName === "string" ? input.cityName.trim() : "";
  if (!cityName && !isAsciiSlug(input.cityId)) return null;

  const city = keyPart(input.cityId, cityName || input.cityId || "");
  if (!city) return null;

  const countryName =
    typeof input.countryName === "string" ? input.countryName.trim() : "";
  const country = keyPart(input.countryId, countryName);

  return country ? `${city}__${country}` : city;
}

function cacheRef(cacheKey: string) {
  return adminDb().doc(`${COLLECTION}/${cacheKey}`);
}

function isExpired(expiresAt: FirebaseFirestore.Timestamp | undefined): boolean {
  if (!expiresAt || typeof expiresAt.toMillis !== "function") return true;
  return expiresAt.toMillis() < Date.now();
}

function normalizeCachedAirports(raw: unknown): TripAirport[] {
  if (!Array.isArray(raw)) return [];
  const out: TripAirport[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const a = row as Record<string, unknown>;
    const placeId = typeof a.placeId === "string" ? a.placeId.trim() : "";
    const name = typeof a.name === "string" ? a.name.trim() : "";
    const loc = a.location as { lat?: unknown; lon?: unknown } | undefined;
    const lat = typeof loc?.lat === "number" ? loc.lat : NaN;
    const lon = typeof loc?.lon === "number" ? loc.lon : NaN;
    if (!placeId || !name || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }
    const iata =
      a.iataCode === null
        ? null
        : typeof a.iataCode === "string"
          ? a.iataCode.trim().toUpperCase()
          : undefined;
    out.push({
      placeId,
      name,
      type: "airport",
      ...(iata !== undefined
        ? {
            iataCode:
              iata === null || /^[A-Z]{3}$/.test(iata) ? iata : null,
          }
        : {}),
      location: { lat, lon },
      ...(typeof a.address === "string" && a.address.trim()
        ? { address: a.address.trim() }
        : {}),
      ...(Array.isArray(a.types)
        ? {
            types: a.types.filter(
              (t): t is string => typeof t === "string" && Boolean(t)
            ),
          }
        : {}),
    });
  }
  return out;
}

function normalizeCachedStations(raw: unknown): TripTransportLocation[] {
  if (!Array.isArray(raw)) return [];
  const out: TripTransportLocation[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const s = row as Record<string, unknown>;
    const placeId = typeof s.placeId === "string" ? s.placeId.trim() : "";
    const name = typeof s.name === "string" ? s.name.trim() : "";
    const loc = s.location as { lat?: unknown; lon?: unknown } | undefined;
    const lat = typeof loc?.lat === "number" ? loc.lat : NaN;
    const lon = typeof loc?.lon === "number" ? loc.lon : NaN;
    if (!placeId || !name || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }
    out.push({
      placeId,
      name,
      type: "train_station",
      location: { lat, lon },
      ...(typeof s.address === "string" && s.address.trim()
        ? { address: s.address.trim() }
        : {}),
      ...(Array.isArray(s.types)
        ? {
            types: s.types.filter(
              (t): t is string => typeof t === "string" && Boolean(t)
            ),
          }
        : {}),
      ...(typeof s.googleMapsUri === "string" && s.googleMapsUri.trim()
        ? { googleMapsUri: s.googleMapsUri.trim() }
        : {}),
    });
  }
  return out;
}

export async function getCityTransportCache(
  cacheKey: string
): Promise<CityTransportCacheEntry | null> {
  try {
    const snap = await cacheRef(cacheKey).get();
    if (!snap.exists) return null;
    const data = snap.data() as CityTransportCacheEntry;
    if (isExpired(data.expiresAt)) return null;
    if (!data.airportsChecked) return null;

    return {
      ...data,
      cacheKey,
      airports: normalizeCachedAirports(data.airports),
      trainStations: data.trainStationsChecked
        ? normalizeCachedStations(data.trainStations)
        : data.trainStations
          ? normalizeCachedStations(data.trainStations)
          : undefined,
      airportsChecked: true,
      trainStationsChecked: Boolean(data.trainStationsChecked),
      lastCheckedAt:
        typeof data.lastCheckedAt === "string" && data.lastCheckedAt
          ? data.lastCheckedAt
          : new Date().toISOString(),
    };
  } catch (err) {
    logger.warn("cityTransportCache get failed", {
      cacheKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export type SetCityTransportCacheParams = {
  cacheKey: string;
  input: CityTransportCacheInput;
  airports: TripAirport[];
  trainStations?: TripTransportLocation[];
  airportsChecked: boolean;
  trainStationsChecked?: boolean;
  lastCheckedAt: string;
  ttlMs?: number;
};

export async function setCityTransportCache(
  params: SetCityTransportCacheParams
): Promise<void> {
  const ttlMs = params.ttlMs ?? CITY_TRANSPORT_CACHE_TTL_MS;
  const expiresAt = Timestamp.fromMillis(Date.now() + ttlMs);
  const cityName = params.input.cityName.trim();
  const countryName = params.input.countryName?.trim();
  const cityId = isAsciiSlug(params.input.cityId)
    ? params.input.cityId!.trim().toLowerCase()
    : undefined;
  const countryId = isAsciiSlug(params.input.countryId)
    ? params.input.countryId!.trim().toLowerCase()
    : undefined;

  try {
    await cacheRef(params.cacheKey).set(
      {
        cacheKey: params.cacheKey,
        cityName,
        ...(countryName ? { countryName } : {}),
        ...(cityId ? { cityId } : {}),
        ...(countryId ? { countryId } : {}),
        airports: params.airports,
        ...(params.trainStationsChecked
          ? { trainStations: params.trainStations ?? [] }
          : params.trainStations && params.trainStations.length > 0
            ? { trainStations: params.trainStations }
            : {}),
        airportsChecked: params.airportsChecked,
        ...(params.trainStationsChecked != null
          ? { trainStationsChecked: params.trainStationsChecked }
          : {}),
        lastCheckedAt: params.lastCheckedAt,
        expiresAt,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    logger.warn("cityTransportCache set failed", {
      cacheKey: params.cacheKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Convert a cache entry into the trip.transport shape. */
export function transportFromCacheEntry(
  entry: CityTransportCacheEntry,
  options: { includeTrainStations: boolean }
): TripDestinationTransport | undefined {
  const hasAirports = entry.airports.length > 0;
  const stations =
    options.includeTrainStations && entry.trainStationsChecked
      ? entry.trainStations
      : undefined;
  const hasStations = Boolean(stations && stations.length > 0);

  if (!hasAirports && !hasStations) {
    // Checked empty — nothing to attach on the trip.
    return undefined;
  }

  return {
    airports: entry.airports,
    ...(options.includeTrainStations && stations
      ? { trainStations: stations }
      : {}),
    lastCheckedAt: entry.lastCheckedAt,
  };
}
