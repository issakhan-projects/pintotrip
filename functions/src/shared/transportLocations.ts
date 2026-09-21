/**
 * Firestore cache for city/region airports and train stations.
 * Avoids repeating Places Text Search across trips for the same location.
 *
 * Path: transportLocations/{countryId}/locations/{locationId}/transport/{transportId}
 * Admin SDK only — never client-readable.
 */

import { createHash } from "crypto";
import { logger } from "firebase-functions";
import { adminDb } from "./admin";
import type {
  TripDestinationTransport,
  TripTransportLocation,
} from "./transportDiscovery";

const ROOT = "transportLocations";

export type TransportLocationsInput = {
  cityName: string;
  countryName?: string;
  cityId?: string;
  countryId?: string;
};

export type TransportLocationIds = {
  countryId: string;
  locationId: string;
};

export type TransportLocationsEntry = {
  countryId: string;
  locationId: string;
  cityName?: string;
  countryName?: string;
  airports: TripTransportLocation[];
  trainStations: TripTransportLocation[];
  /** Places airport Text Search completed (even if zero results). */
  airportsChecked: boolean;
  /** Places train-station Text Search completed (even if zero results). */
  trainStationsChecked: boolean;
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
 * Stable ASCII id from preferred id, else slug, else hash of name.
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
 * Resolve countryId + locationId for the transportLocations hierarchy.
 * Prefer cityId/countryId; fall back to slugs from names.
 * Returns null when either id cannot be identified.
 */
export function resolveTransportLocationIds(
  input: TransportLocationsInput
): TransportLocationIds | null {
  const cityName =
    typeof input.cityName === "string" ? input.cityName.trim() : "";
  if (!cityName && !isAsciiSlug(input.cityId)) return null;

  const locationId = keyPart(input.cityId, cityName || input.cityId || "");
  if (!locationId) return null;

  const countryName =
    typeof input.countryName === "string" ? input.countryName.trim() : "";
  const countryId = keyPart(input.countryId, countryName);
  if (!countryId) return null;

  return { countryId, locationId };
}

function locationRef(countryId: string, locationId: string) {
  return adminDb().doc(
    `${ROOT}/${countryId}/locations/${locationId}`
  );
}

function transportCollection(countryId: string, locationId: string) {
  return locationRef(countryId, locationId).collection("transport");
}

function normalizeTransportDoc(
  raw: FirebaseFirestore.DocumentData
): TripTransportLocation | null {
  const placeId = typeof raw.placeId === "string" ? raw.placeId.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const type =
    raw.type === "airport" || raw.type === "train_station" ? raw.type : null;
  const loc = raw.location as { lat?: unknown; lon?: unknown } | undefined;
  const lat = typeof loc?.lat === "number" ? loc.lat : NaN;
  const lon = typeof loc?.lon === "number" ? loc.lon : NaN;
  if (
    !placeId ||
    !name ||
    !type ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  ) {
    return null;
  }

  const iata =
    raw.iataCode === null
      ? null
      : typeof raw.iataCode === "string"
        ? raw.iataCode.trim().toUpperCase()
        : undefined;

  return {
    placeId,
    name,
    type,
    ...(type === "airport" && iata !== undefined
      ? {
          iataCode:
            iata === null || /^[A-Z]{3}$/.test(iata) ? iata : null,
        }
      : {}),
    location: { lat, lon },
    ...(typeof raw.address === "string" && raw.address.trim()
      ? { address: raw.address.trim() }
      : {}),
    ...(Array.isArray(raw.types)
      ? {
          types: raw.types.filter(
            (t): t is string => typeof t === "string" && Boolean(t)
          ),
        }
      : {}),
    ...(typeof raw.googleMapsUri === "string" && raw.googleMapsUri.trim()
      ? { googleMapsUri: raw.googleMapsUri.trim() }
      : {}),
  };
}

function preferredTransportId(
  place: TripTransportLocation,
  locationId: string
): string {
  if (
    place.type === "airport" &&
    typeof place.iataCode === "string" &&
    /^[A-Z]{3}$/.test(place.iataCode)
  ) {
    return `${place.iataCode.toLowerCase()}_airport`;
  }

  const slug = asciiSlug(place.name);
  if (slug && slug !== "unknown") return slug;

  const suffix = createHash("sha256")
    .update(place.placeId)
    .digest("hex")
    .slice(0, 8);
  return `${locationId}_${place.type === "train_station" ? "station" : "airport"}_${suffix}`;
}

function allocateTransportId(
  place: TripTransportLocation,
  locationId: string,
  usedIds: Set<string>,
  placeIdToDocId: Map<string, string>
): string {
  const existing = placeIdToDocId.get(place.placeId);
  if (existing) return existing;

  const base = preferredTransportId(place, locationId);
  if (!usedIds.has(base)) return base;

  const suffix = createHash("sha256")
    .update(place.placeId)
    .digest("hex")
    .slice(0, 6);
  const candidate = `${base}_${suffix}`;
  if (!usedIds.has(candidate)) return candidate;

  return `${base}_${createHash("sha256").update(place.placeId).digest("hex").slice(0, 12)}`;
}

function toTransportPayload(
  place: TripTransportLocation,
  now: number
): Record<string, unknown> {
  return {
    placeId: place.placeId,
    name: place.name,
    type: place.type,
    ...(place.type === "airport" && place.iataCode !== undefined
      ? { iataCode: place.iataCode }
      : {}),
    location: {
      lat: place.location.lat,
      lon: place.location.lon,
    },
    ...(place.address ? { address: place.address } : {}),
    ...(place.types && place.types.length > 0 ? { types: place.types } : {}),
    ...(place.googleMapsUri ? { googleMapsUri: place.googleMapsUri } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Load cached transport for a country/location.
 * Returns null when the location doc is missing (cache miss).
 * Empty airports with airportsChecked=true is a valid hit (Places already ran).
 */
export async function getTransportLocations(
  ids: TransportLocationIds
): Promise<TransportLocationsEntry | null> {
  try {
    const locSnap = await locationRef(ids.countryId, ids.locationId).get();
    if (!locSnap.exists) return null;

    const data = locSnap.data() || {};
    const airportsChecked = Boolean(data.airportsChecked);
    if (!airportsChecked) return null;

    const transportSnap = await transportCollection(
      ids.countryId,
      ids.locationId
    ).get();

    const airports: TripTransportLocation[] = [];
    const trainStations: TripTransportLocation[] = [];

    for (const doc of transportSnap.docs) {
      const normalized = normalizeTransportDoc(doc.data());
      if (!normalized) continue;
      if (normalized.type === "airport") airports.push(normalized);
      else trainStations.push(normalized);
    }

    return {
      countryId: ids.countryId,
      locationId: ids.locationId,
      ...(typeof data.cityName === "string" && data.cityName.trim()
        ? { cityName: data.cityName.trim() }
        : {}),
      ...(typeof data.countryName === "string" && data.countryName.trim()
        ? { countryName: data.countryName.trim() }
        : {}),
      airports,
      trainStations,
      airportsChecked: true,
      trainStationsChecked: Boolean(data.trainStationsChecked),
    };
  } catch (err) {
    logger.warn("transportLocations get failed", {
      countryId: ids.countryId,
      locationId: ids.locationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export type SetTransportLocationsParams = {
  ids: TransportLocationIds;
  input: TransportLocationsInput;
  airports: TripTransportLocation[];
  trainStations?: TripTransportLocation[];
  airportsChecked: boolean;
  trainStationsChecked?: boolean;
};

/**
 * Upsert location meta + transport docs.
 * Dedupes by placeId — existing docs are left unchanged.
 * Creates the location document when missing.
 */
export async function setTransportLocations(
  params: SetTransportLocationsParams
): Promise<void> {
  const { ids } = params;
  const now = Date.now();
  const cityName = params.input.cityName.trim();
  const countryName = params.input.countryName?.trim();
  const cityId = isAsciiSlug(params.input.cityId)
    ? params.input.cityId!.trim().toLowerCase()
    : undefined;

  try {
    const locRef = locationRef(ids.countryId, ids.locationId);
    const existingLoc = await locRef.get();
    const createdAt =
      existingLoc.exists && typeof existingLoc.data()?.createdAt === "number"
        ? (existingLoc.data()!.createdAt as number)
        : now;

    await locRef.set(
      {
        countryId: ids.countryId,
        locationId: ids.locationId,
        ...(cityName ? { cityName } : {}),
        ...(countryName ? { countryName } : {}),
        ...(cityId ? { cityId } : {}),
        airportsChecked: params.airportsChecked,
        ...(params.trainStationsChecked != null
          ? { trainStationsChecked: params.trainStationsChecked }
          : {}),
        createdAt,
        updatedAt: now,
      },
      { merge: true }
    );

    const col = transportCollection(ids.countryId, ids.locationId);
    const existingSnap = await col.get();
    const placeIdToDocId = new Map<string, string>();
    const usedIds = new Set<string>();

    for (const doc of existingSnap.docs) {
      usedIds.add(doc.id);
      const placeId =
        typeof doc.data().placeId === "string"
          ? doc.data().placeId.trim()
          : "";
      if (placeId) placeIdToDocId.set(placeId, doc.id);
    }

    const toWrite: TripTransportLocation[] = [
      ...params.airports,
      ...(params.trainStations ?? []),
    ];

    const batch = adminDb().batch();
    let writes = 0;

    for (const place of toWrite) {
      if (!place.placeId || placeIdToDocId.has(place.placeId)) continue;

      const transportId = allocateTransportId(
        place,
        ids.locationId,
        usedIds,
        placeIdToDocId
      );
      usedIds.add(transportId);
      placeIdToDocId.set(place.placeId, transportId);
      batch.set(col.doc(transportId), toTransportPayload(place, now), {
        merge: false,
      });
      writes += 1;
    }

    if (writes > 0) {
      await batch.commit();
    }
  } catch (err) {
    logger.warn("transportLocations set failed", {
      countryId: ids.countryId,
      locationId: ids.locationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Convert a cache entry into the trip.transport shape. */
export function transportFromLocationsEntry(
  entry: TransportLocationsEntry,
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
    lastCheckedAt: new Date().toISOString(),
  };
}
