/**
 * Firestore cache for suggested trip places (coords from Google Places).
 * Avoids repeating Places Text Search across trips for the same place.
 *
 * Path: placesLocation/{countryId}/locations/{cityId}/places/{placeDocId}
 * Admin SDK only — never client-readable.
 *
 * Matching (machine IDs only — never localized title/cityName/countryName):
 * - countryId: ISO 3166-1 alpha-2 lowercase (e.g. "ru")
 * - cityId / locationId: English ASCII city slug (e.g. "moscow")
 * - placeDocId / id: English ASCII place slug from AI (e.g. "red-square")
 * - placeId: Google Places resource id when known (secondary match)
 *
 * Display fields (title, cityName, countryName, titleEn) may be any language.
 */

import { createHash } from "crypto";
import { logger } from "firebase-functions";
import { adminDb } from "./admin";
import {
  resolveTransportLocationIds,
  type TransportLocationIds,
  type TransportLocationsInput,
} from "./transportLocations";

const ROOT = "placesLocation";

export type PlacesLocationIds = TransportLocationIds;

export type PlacesLocationInput = TransportLocationsInput & {
  /**
   * English/ASCII place slug (AI `place.id`). Preferred placeDocId.
   * Not the localized display title.
   */
  placeSlug?: string;
  /** Localized display title (any language). */
  title: string;
};

/** Cached adult ticket / entry / typical meal price from GPT web search. */
export type PlacesLocationPrice = {
  amount: number;
  /** ISO 4217 uppercase. */
  currency: string;
  label?: string;
  /** Ticket/booking URL when known. */
  link?: string;
  /** Epoch ms when looked up. */
  pricedAt: number;
  source: "web_search";
};

export type PlacesLocationEntry = {
  countryId: string;
  /** Same as path locationId — English ASCII city slug. */
  cityId: string;
  locationId: string;
  placeDocId: string;
  /** English/ASCII place slug used for primary cache match. */
  id: string;
  /** Google Places resource id when known (secondary match). */
  placeId?: string;
  /** Localized display title (may be Russian, etc.). */
  title: string;
  /** English title from Places API (languageCode=en), when known. */
  titleEn?: string;
  displayName?: string;
  location: { lat: number; lon: number };
  address?: string;
  /** Localized city display name. */
  cityName?: string;
  /** Localized country display name. */
  countryName?: string;
  /** Adult ticket / entry price when looked up. */
  price?: PlacesLocationPrice;
};

/** In-memory city cache with lookup by ascii id and Google placeId. */
export type PlacesCityCache = {
  byDocId: Map<string, PlacesLocationEntry>;
  byPlaceId: Map<string, PlacesLocationEntry>;
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

/** Google Places ids are ASCII (e.g. ChIJ…) — safe as secondary Firestore keys. */
function isGooglePlaceId(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  return trimmed.length >= 8 && /^[A-Za-z0-9_\-]+$/.test(trimmed);
}

/**
 * Resolve placeDocId for cache path.
 * Prefer English/ASCII `place.id` — never slugify localized titles for matching.
 * Fallbacks: Google placeId → hash of title (last resort, language-specific).
 */
export function resolvePlaceDocId(input: {
  placeSlug?: string;
  placeId?: string;
  title?: string;
}): string | null {
  if (isAsciiSlug(input.placeSlug)) {
    return input.placeSlug.trim().toLowerCase();
  }
  if (isGooglePlaceId(input.placeId)) {
    return input.placeId.trim();
  }
  const title = input.title?.trim();
  if (!title) return null;
  const slug = asciiSlug(title);
  if (slug && slug !== "unknown") return slug;
  return createHash("sha256")
    .update(title.toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

export function resolvePlacesLocationIds(
  input: TransportLocationsInput
): PlacesLocationIds | null {
  return resolveTransportLocationIds(input);
}

function locationRef(countryId: string, locationId: string) {
  return adminDb().doc(`${ROOT}/${countryId}/locations/${locationId}`);
}

function placesCollection(countryId: string, locationId: string) {
  return locationRef(countryId, locationId).collection("places");
}

function placeRef(
  countryId: string,
  locationId: string,
  placeDocId: string
) {
  return placesCollection(countryId, locationId).doc(placeDocId);
}

function normalizePlaceDoc(
  raw: FirebaseFirestore.DocumentData,
  ids: PlacesLocationIds,
  placeDocId: string
): PlacesLocationEntry | null {
  const loc = raw.location as { lat?: unknown; lon?: unknown } | undefined;
  const lat = typeof loc?.lat === "number" ? loc.lat : NaN;
  const lon = typeof loc?.lon === "number" ? loc.lon : NaN;
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return null;
  }

  const idRaw =
    (typeof raw.id === "string" && raw.id.trim()) ||
    (isAsciiSlug(placeDocId) ? placeDocId : "");
  const id = isAsciiSlug(idRaw) ? idRaw.trim().toLowerCase() : placeDocId;

  const title =
    (typeof raw.title === "string" && raw.title.trim()) ||
    (typeof raw.titleEn === "string" && raw.titleEn.trim()) ||
    (typeof raw.displayName === "string" && raw.displayName.trim()) ||
    id;
  if (!title) return null;

  const cityId =
    (typeof raw.cityId === "string" && isAsciiSlug(raw.cityId)
      ? raw.cityId.trim().toLowerCase()
      : null) || ids.locationId;

  const price = normalizePrice(raw.price);

  return {
    countryId: ids.countryId,
    cityId,
    locationId: ids.locationId,
    placeDocId,
    id,
    title,
    location: { lat, lon },
    ...(typeof raw.placeId === "string" && raw.placeId.trim()
      ? { placeId: raw.placeId.trim() }
      : {}),
    ...(typeof raw.titleEn === "string" && raw.titleEn.trim()
      ? { titleEn: raw.titleEn.trim() }
      : {}),
    ...(typeof raw.displayName === "string" && raw.displayName.trim()
      ? { displayName: raw.displayName.trim() }
      : {}),
    ...(typeof raw.address === "string" && raw.address.trim()
      ? { address: raw.address.trim() }
      : {}),
    ...(typeof raw.cityName === "string" && raw.cityName.trim()
      ? { cityName: raw.cityName.trim() }
      : {}),
    ...(typeof raw.countryName === "string" && raw.countryName.trim()
      ? { countryName: raw.countryName.trim() }
      : {}),
    ...(price ? { price } : {}),
  };
}

function normalizePrice(raw: unknown): PlacesLocationPrice | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const amount =
    typeof row.amount === "number" && Number.isFinite(row.amount) && row.amount >= 0
      ? row.amount
      : null;
  const currency =
    typeof row.currency === "string" && /^[A-Za-z]{3}$/.test(row.currency.trim())
      ? row.currency.trim().toUpperCase()
      : null;
  if (amount == null || !currency) return undefined;
  const pricedAt =
    typeof row.pricedAt === "number" && Number.isFinite(row.pricedAt)
      ? row.pricedAt
      : 0;
  const label =
    typeof row.label === "string" && row.label.trim()
      ? row.label.trim()
      : undefined;
  const link =
    typeof row.link === "string" && /^https:\/\//i.test(row.link.trim())
      ? row.link.trim()
      : undefined;
  return {
    amount,
    currency,
    pricedAt,
    source: "web_search",
    ...(label ? { label } : {}),
    ...(link ? { link } : {}),
  };
}

/** True when cached price is present and fresher than TTL (default 180 days). */
export function hasFreshCachedPrice(
  entry: PlacesLocationEntry | null | undefined,
  ttlMs = 180 * 24 * 60 * 60 * 1000
): entry is PlacesLocationEntry & { price: PlacesLocationPrice } {
  if (!entry?.price) return false;
  if (
    typeof entry.price.amount !== "number" ||
    !Number.isFinite(entry.price.amount) ||
    entry.price.amount < 0
  ) {
    return false;
  }
  if (!/^[A-Z]{3}$/.test(entry.price.currency)) return false;
  if (!entry.price.pricedAt || entry.price.pricedAt <= 0) return true;
  return Date.now() - entry.price.pricedAt <= ttlMs;
}

function indexEntry(
  cache: PlacesCityCache,
  entry: PlacesLocationEntry
): void {
  cache.byDocId.set(entry.placeDocId, entry);
  if (entry.id && entry.id !== entry.placeDocId) {
    cache.byDocId.set(entry.id, entry);
  }
  if (entry.placeId) {
    cache.byPlaceId.set(entry.placeId, entry);
  }
}

/**
 * Find a cached place by English/ASCII place slug and/or Google placeId.
 * Does not use localized title.
 */
export function findCachedPlace(
  cache: PlacesCityCache,
  input: { placeDocId?: string; placeId?: string }
): PlacesLocationEntry | null {
  if (input.placeDocId) {
    const byId = cache.byDocId.get(input.placeDocId);
    if (byId) return byId;
  }
  if (input.placeId) {
    const byPlaceId = cache.byPlaceId.get(input.placeId);
    if (byPlaceId) return byPlaceId;
  }
  return null;
}

/**
 * Load one cached place by country/city + English place slug (or Google placeId doc).
 */
export async function getPlaceLocation(
  ids: PlacesLocationIds,
  placeDocId: string
): Promise<PlacesLocationEntry | null> {
  try {
    const snap = await placeRef(ids.countryId, ids.locationId, placeDocId).get();
    if (!snap.exists) return null;
    return normalizePlaceDoc(snap.data() || {}, ids, placeDocId);
  } catch (err) {
    logger.warn("placesLocation get failed", {
      countryId: ids.countryId,
      locationId: ids.locationId,
      placeDocId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Load all cached places for a city (batch lookup during planTrip).
 * Indexed by ascii placeDocId/id and Google placeId.
 */
export async function getPlacesForLocation(
  ids: PlacesLocationIds
): Promise<PlacesCityCache> {
  const cache: PlacesCityCache = {
    byDocId: new Map(),
    byPlaceId: new Map(),
  };
  try {
    const snap = await placesCollection(ids.countryId, ids.locationId).get();
    for (const doc of snap.docs) {
      const entry = normalizePlaceDoc(doc.data(), ids, doc.id);
      if (entry) indexEntry(cache, entry);
    }
  } catch (err) {
    logger.warn("placesLocation list failed", {
      countryId: ids.countryId,
      locationId: ids.locationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return cache;
}

export type SetPlaceLocationParams = {
  ids: PlacesLocationIds;
  placeDocId: string;
  input: PlacesLocationInput;
  place: {
    /** English/ASCII slug (AI place.id). */
    id: string;
    /** Localized display title. */
    title: string;
    location: { lat: number; lon: number };
    placeId?: string;
    titleEn?: string;
    displayName?: string;
    address?: string;
  };
};

/**
 * Upsert city meta + place coords doc.
 * Match fields written: countryId, cityId, id, placeId.
 * Display fields (title, cityName, countryName) are not used for lookup.
 */
export async function setPlaceLocation(
  params: SetPlaceLocationParams
): Promise<void> {
  const { ids, placeDocId, place } = params;
  const now = Date.now();
  const cityName = params.input.cityName.trim();
  const countryName = params.input.countryName?.trim();
  const cityId = isAsciiSlug(params.input.cityId)
    ? params.input.cityId!.trim().toLowerCase()
    : ids.locationId;
  const placeAsciiId = isAsciiSlug(place.id)
    ? place.id.trim().toLowerCase()
    : placeDocId;

  try {
    const locRef = locationRef(ids.countryId, ids.locationId);
    const existingLoc = await locRef.get();
    const locCreatedAt =
      existingLoc.exists && typeof existingLoc.data()?.createdAt === "number"
        ? (existingLoc.data()!.createdAt as number)
        : now;

    await locRef.set(
      {
        countryId: ids.countryId,
        locationId: ids.locationId,
        cityId,
        ...(cityName ? { cityName } : {}),
        ...(countryName ? { countryName } : {}),
        createdAt: locCreatedAt,
        updatedAt: now,
      },
      { merge: true }
    );

    const pRef = placeRef(ids.countryId, ids.locationId, placeDocId);
    const existingPlace = await pRef.get();
    const placeCreatedAt =
      existingPlace.exists &&
      typeof existingPlace.data()?.createdAt === "number"
        ? (existingPlace.data()!.createdAt as number)
        : now;

    await pRef.set(
      {
        // --- match keys (English/ASCII) ---
        id: placeAsciiId,
        cityId,
        countryId: ids.countryId,
        ...(place.placeId ? { placeId: place.placeId } : {}),
        // --- display (any language) ---
        title: place.title.trim(),
        ...(place.titleEn ? { titleEn: place.titleEn } : {}),
        ...(place.displayName ? { displayName: place.displayName } : {}),
        ...(place.address ? { address: place.address } : {}),
        ...(cityName ? { cityName } : {}),
        ...(countryName ? { countryName } : {}),
        location: {
          lat: place.location.lat,
          lon: place.location.lon,
        },
        createdAt: placeCreatedAt,
        updatedAt: now,
      },
      { merge: true }
    );
  } catch (err) {
    logger.warn("placesLocation set failed", {
      countryId: ids.countryId,
      locationId: ids.locationId,
      placeDocId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export type SetPlaceLocationPriceParams = {
  ids: PlacesLocationIds;
  placeDocId: string;
  price: Omit<PlacesLocationPrice, "source"> & { source?: "web_search" };
  /** Used when the place doc does not exist yet (coords enrich missed). */
  stub?: {
    id: string;
    title: string;
    location: { lat: number; lon: number };
    cityName?: string;
    countryName?: string;
    cityId?: string;
  };
};

/**
 * Merge adult ticket/entry price onto a placesLocation place doc.
 * Does not call Google — GPT web-search results only.
 */
export async function setPlaceLocationPrice(
  params: SetPlaceLocationPriceParams
): Promise<void> {
  const { ids, placeDocId, price, stub } = params;
  const now = Date.now();
  const currency = price.currency.trim().toUpperCase();
  if (
    !Number.isFinite(price.amount) ||
    price.amount < 0 ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    return;
  }

  const priceDoc: PlacesLocationPrice = {
    amount: price.amount,
    currency,
    pricedAt: price.pricedAt > 0 ? price.pricedAt : now,
    source: "web_search",
    ...(price.label?.trim() ? { label: price.label.trim() } : {}),
    ...(price.link && /^https:\/\//i.test(price.link.trim())
      ? { link: price.link.trim() }
      : {}),
  };

  try {
    const pRef = placeRef(ids.countryId, ids.locationId, placeDocId);
    const existing = await pRef.get();
    const placeCreatedAt =
      existing.exists && typeof existing.data()?.createdAt === "number"
        ? (existing.data()!.createdAt as number)
        : now;

    const cityId = isAsciiSlug(stub?.cityId)
      ? stub!.cityId!.trim().toLowerCase()
      : ids.locationId;
    const placeAsciiId = isAsciiSlug(stub?.id)
      ? stub!.id.trim().toLowerCase()
      : isAsciiSlug(placeDocId)
        ? placeDocId
        : placeDocId;

    if (!existing.exists && stub) {
      const locRef = locationRef(ids.countryId, ids.locationId);
      const existingLoc = await locRef.get();
      const locCreatedAt =
        existingLoc.exists && typeof existingLoc.data()?.createdAt === "number"
          ? (existingLoc.data()!.createdAt as number)
          : now;
      await locRef.set(
        {
          countryId: ids.countryId,
          locationId: ids.locationId,
          cityId,
          ...(stub.cityName?.trim() ? { cityName: stub.cityName.trim() } : {}),
          ...(stub.countryName?.trim()
            ? { countryName: stub.countryName.trim() }
            : {}),
          createdAt: locCreatedAt,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    await pRef.set(
      {
        ...(existing.exists
          ? {}
          : {
              id: placeAsciiId,
              cityId,
              countryId: ids.countryId,
              title: stub?.title.trim() || placeDocId,
              ...(stub
                ? {
                    location: {
                      lat: stub.location.lat,
                      lon: stub.location.lon,
                    },
                  }
                : {}),
              ...(stub?.cityName?.trim()
                ? { cityName: stub.cityName.trim() }
                : {}),
              ...(stub?.countryName?.trim()
                ? { countryName: stub.countryName.trim() }
                : {}),
            }),
        price: priceDoc,
        createdAt: placeCreatedAt,
        updatedAt: now,
      },
      { merge: true }
    );
  } catch (err) {
    logger.warn("placesLocation price set failed", {
      countryId: ids.countryId,
      locationId: ids.locationId,
      placeDocId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
