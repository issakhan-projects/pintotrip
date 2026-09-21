import {
  collection,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  limit,
  startAfter,
  Timestamp,
  type DocumentReference,
  type CollectionReference,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getFirestoreDb, FirestorePaths } from "@/lib/firebase/firestore";
import { getDocsCacheFirst, getDocCacheFirst } from "@/lib/firebase/cache-read";
import { recordCacheHit, recordFirestoreRead } from "@/lib/firebase/debug";
import {
  approxNowTimestamp,
  getCachedLocation,
  locationsInFlight,
  locationsKey,
  locationsStore,
  patchLocationInCache,
  removeLocationFromCache,
  upsertLocationInCache,
  type LocationsCacheState,
  type SavedLocation,
} from "@/lib/firebase/data-cache";
import type {
  UserLocation,
  UserLocationCreateInput,
  UserLocationUpdateInput,
} from "@/types/location";
import { LOCATION_AGGREGATION_FIELDS } from "@/types/location";

/** Initial / page size for locations (map + list share this cache). */
export const LOCATIONS_PAGE_SIZE = 40;

function locationsCollection(userId: string): CollectionReference {
  return collection(getFirestoreDb(), FirestorePaths.locations(userId));
}

function locationRef(userId: string, locationId: string): DocumentReference {
  return doc(getFirestoreDb(), FirestorePaths.location(userId, locationId));
}

function isActiveLocation(data: UserLocation): boolean {
  return data.deleted !== true;
}

function mapDoc(d: QueryDocumentSnapshot): SavedLocation {
  return {
    id: d.id,
    ...(d.data() as UserLocation),
  };
}

function createdAtMillis(loc: SavedLocation): number {
  const ts = loc.createdAt;
  if (ts && typeof (ts as Timestamp).toMillis === "function") {
    return (ts as Timestamp).toMillis();
  }
  return 0;
}

function sortByCreatedAtDesc(items: SavedLocation[]): SavedLocation[] {
  return [...items].sort(
    (a, b) => createdAtMillis(b) - createdAtMillis(a)
  );
}

/**
 * Ensure locations are loaded into the shared cache.
 * Soft (default): memory → IndexedDB cache → server first page (no server if cache warm).
 * Hard: force server re-query from the start.
 */
export async function ensureLocations(
  userId: string,
  options?: { hard?: boolean }
): Promise<LocationsCacheState> {
  const key = locationsKey(userId);
  const hard = options?.hard === true;

  if (!hard) {
    const mem = locationsStore.get(key);
    if (mem) {
      recordCacheHit();
      return mem;
    }
  }

  return locationsInFlight.run(`${key}:${hard ? "hard" : "soft"}`, async () => {
    if (!hard) {
      const mem = locationsStore.get(key);
      if (mem) {
        recordCacheHit();
        return mem;
      }
    }

    const base = query(
      locationsCollection(userId),
      orderBy("createdAt", "desc"),
      limit(LOCATIONS_PAGE_SIZE)
    );

    const snap = await getDocsCacheFirst(base, { forceServer: hard });
    const items = sortByCreatedAtDesc(
      snap.docs.map(mapDoc).filter((d) => isActiveLocation(d))
    );
    const last = snap.docs[snap.docs.length - 1];
    const hasMore = snap.docs.length >= LOCATIONS_PAGE_SIZE;
    const state: LocationsCacheState = {
      items,
      complete: !hasMore,
      hasMore,
      cursor: last
        ? {
            id: last.id,
            createdAtMillis: createdAtMillis(mapDoc(last)),
          }
        : null,
    };
    locationsStore.set(key, state);

    // Warm remaining pages into the shared cache without blocking callers on
    // the full collection (map/list share progressive results).
    if (hasMore) {
      void loadRemainingLocationPages(userId);
    }

    return state;
  });
}

/**
 * Load the next page into the shared cache (cursor pagination).
 */
export async function loadMoreLocations(
  userId: string
): Promise<LocationsCacheState> {
  const key = locationsKey(userId);
  const prev = locationsStore.get(key);
  if (!prev?.hasMore || !prev.cursor) {
    return (
      prev ?? {
        items: [],
        complete: true,
        hasMore: false,
        cursor: null,
      }
    );
  }

  return locationsInFlight.run(`${key}:more:${prev.cursor.id}`, async () => {
    const current = locationsStore.get(key) ?? prev;
    if (!current.hasMore || !current.cursor) return current;

    const cursorRef = locationRef(userId, current.cursor.id);
    let cursorSnap;
    try {
      cursorSnap = await getDocCacheFirst(cursorRef);
    } catch {
      cursorSnap = await getDoc(cursorRef);
      recordFirestoreRead(cursorSnap.exists() ? 1 : 0);
    }

    if (!cursorSnap.exists()) {
      const done = { ...current, hasMore: false, complete: true, cursor: null };
      locationsStore.set(key, done);
      return done;
    }

    const q = query(
      locationsCollection(userId),
      orderBy("createdAt", "desc"),
      startAfter(cursorSnap),
      limit(LOCATIONS_PAGE_SIZE)
    );
    // Pagination pages intentionally hit server (or SDK cache for that query).
    const snap = await getDocsCacheFirst(q);
    const page = snap.docs.map(mapDoc).filter((d) => isActiveLocation(d));
    const byId = new Map(current.items.map((l) => [l.id, l]));
    for (const item of page) byId.set(item.id, item);
    const items = sortByCreatedAtDesc([...byId.values()]);
    const last = snap.docs[snap.docs.length - 1];
    const hasMore = snap.docs.length >= LOCATIONS_PAGE_SIZE;
    const state: LocationsCacheState = {
      items,
      complete: !hasMore,
      hasMore,
      cursor: last
        ? { id: last.id, createdAtMillis: createdAtMillis(mapDoc(last)) }
        : null,
    };
    locationsStore.set(key, state);
    return state;
  });
}

async function loadRemainingLocationPages(userId: string): Promise<void> {
  const key = locationsKey(userId);
  // Cap defensive loops.
  for (let i = 0; i < 50; i++) {
    const state = locationsStore.get(key);
    if (!state?.hasMore) return;
    await loadMoreLocations(userId);
  }
}

/** @deprecated Prefer ensureLocations — kept for call sites expecting an array. */
export async function listUserLocations(
  userId: string,
  options?: { hard?: boolean }
): Promise<SavedLocation[]> {
  const state = await ensureLocations(userId, options);
  return state.items;
}

export async function getUserLocation(
  userId: string,
  locationId: string,
  options?: { hard?: boolean }
): Promise<SavedLocation | null> {
  const cached = getCachedLocation(userId, locationId);
  if (cached && !options?.hard) {
    recordCacheHit();
    return cached;
  }

  const snap = await getDocCacheFirst(locationRef(userId, locationId), {
    forceServer: options?.hard,
  });
  if (!snap.exists()) return null;
  const data = snap.data() as UserLocation;
  if (!isActiveLocation(data)) return null;
  const loc = { id: snap.id, ...data };
  upsertLocationInCache(userId, loc);
  return loc;
}

function omitUndefined<T extends Record<string, unknown>>(
  value: T
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as { [K in keyof T]?: Exclude<T[K], undefined> };
}

function touchesAggregationFields(
  input: UserLocationUpdateInput
): boolean {
  for (const field of LOCATION_AGGREGATION_FIELDS) {
    if (field in input && input[field] !== undefined) return true;
  }
  return false;
}

export async function createUserLocation(
  userId: string,
  input: UserLocationCreateInput
): Promise<string> {
  const ref = await addDoc(locationsCollection(userId), {
    ...omitUndefined(input as Record<string, unknown>),
    aggregated: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const now = approxNowTimestamp();
  upsertLocationInCache(userId, {
    id: ref.id,
    ...(omitUndefined(input as Record<string, unknown>) as unknown as UserLocation),
    aggregated: false,
    createdAt: now,
    updatedAt: now,
  } as SavedLocation);

  return ref.id;
}

export async function updateUserLocation(
  userId: string,
  locationId: string,
  input: UserLocationUpdateInput
): Promise<void> {
  const payload: Record<string, unknown> = {
    ...omitUndefined(input as Record<string, unknown>),
    updatedAt: serverTimestamp(),
  };

  if (touchesAggregationFields(input)) {
    payload.aggregated = false;
  }

  delete payload.intelligenceContribution;
  delete payload.aggregatedAt;

  await updateDoc(locationRef(userId, locationId), payload);

  patchLocationInCache(userId, locationId, {
    ...omitUndefined(input as Record<string, unknown>),
    updatedAt: approxNowTimestamp(),
    ...(touchesAggregationFields(input) ? { aggregated: false } : {}),
  } as Partial<UserLocation>);
}

/** Persist a locality Google Place ID without overwriting other city fields. */
export async function updateLocationCityGooglePlaceId(
  userId: string,
  locationId: string,
  googlePlaceId: string
): Promise<void> {
  const trimmed = googlePlaceId.trim();
  if (!trimmed) return;
  await updateDoc(locationRef(userId, locationId), {
    "city.googlePlaceId": trimmed,
    updatedAt: serverTimestamp(),
  });

  const cached = getCachedLocation(userId, locationId);
  if (cached) {
    upsertLocationInCache(userId, {
      ...cached,
      city: { ...cached.city, googlePlaceId: trimmed },
      updatedAt: approxNowTimestamp(),
    });
  }
}

/**
 * Soft-delete when the location was already aggregated so Travel Intelligence
 * can reverse its contribution. Otherwise hard-delete.
 */
export async function deleteUserLocation(
  userId: string,
  locationId: string
): Promise<void> {
  const ref = locationRef(userId, locationId);

  // Prefer server truth for the soft-vs-hard decision — memory cache can lag
  // behind Travel Intelligence aggregation writes.
  let data: UserLocation | undefined;
  try {
    const snap = await getDocCacheFirst(ref, { forceServer: true });
    if (!snap.exists()) {
      removeLocationFromCache(userId, locationId);
      return;
    }
    data = snap.data() as UserLocation;
  } catch {
    const cached = getCachedLocation(userId, locationId);
    data = cached as UserLocation | undefined;
    if (!data) {
      removeLocationFromCache(userId, locationId);
      return;
    }
  }

  const needsReversal =
    data.aggregated === true || data.intelligenceContribution != null;

  if (needsReversal) {
    await updateDoc(ref, {
      deleted: true,
      aggregated: false,
      updatedAt: serverTimestamp(),
    });
  } else {
    await deleteDoc(ref);
  }

  removeLocationFromCache(userId, locationId);
}

export function subscribeLocationsCache(
  userId: string,
  listener: (state: LocationsCacheState | undefined) => void
): () => void {
  return locationsStore.subscribe(locationsKey(userId), listener);
}

export function getLocationsCache(
  userId: string
): LocationsCacheState | undefined {
  return locationsStore.get(locationsKey(userId));
}
