import {
  collection,
  doc,
  getDoc,
  getDocsFromCache,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
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
import type { SubscriptionPlan } from "@/types/user";
import {
  LOCATION_LIMITS,
  locationLimitForSubscription,
} from "@/features/profile/plans";
import {
  bumpLocationsSyncAt,
  getUserProfile,
} from "@/services/users";
import {
  readPersistedCollectionSync,
  timestampMillis,
  writePersistedCollectionSync,
} from "@/lib/firebase/collection-sync";

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

function isNotFoundError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: string }).code === "not-found"
  );
}

function isPermissionDeniedError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: string }).code === "permission-denied"
  );
}

/** Body safe for create/setDoc — strips id + Admin-only TI fields. */
function locationDocFromCache(loc: SavedLocation): Record<string, unknown> {
  const {
    id: _id,
    intelligenceContribution: _ic,
    aggregatedAt: _aa,
    deleted: _del,
    visitedAt,
    ...rest
  } = loc;
  const body: Record<string, unknown> = {
    ...rest,
    aggregated: false,
  };
  if (visitedAt != null) body.visitedAt = visitedAt;
  return body;
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

function updatedAtMillis(loc: SavedLocation): number {
  const ts = loc.updatedAt;
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

function locationsQuery(userId: string) {
  return query(
    locationsCollection(userId),
    orderBy("createdAt", "desc"),
    limit(LOCATIONS_PAGE_SIZE)
  );
}

/**
 * Merge a query snapshot into the shared cache.
 * Keeps newer in-memory status/edits over a stale IndexedDB / server page.
 */
function applyLocationsSnapshot(
  userId: string,
  pageItems: SavedLocation[],
  last: QueryDocumentSnapshot | undefined,
  syncedAtMillis?: number | null
): LocationsCacheState {
  const key = locationsKey(userId);
  const prev = locationsStore.get(key);

  const byId = new Map<string, SavedLocation>();
  for (const loc of pageItems) {
    if (!isActiveLocation(loc)) continue;
    const existing = prev?.items.find((l) => l.id === loc.id);
    // Prefer a newer in-memory patch (status update) over a stale query doc.
    const chosen =
      existing && updatedAtMillis(existing) > updatedAtMillis(loc)
        ? existing
        : loc;
    byId.set(chosen.id, chosen);
  }

  // Keep places just created/patched locally that are missing from this page
  // (pending serverTimestamp + orderBy gap, or in-flight soft overwrite).
  if (prev) {
    const now = Date.now();
    for (const loc of prev.items) {
      if (byId.has(loc.id)) continue;
      if (!isActiveLocation(loc)) continue;
      if (now - Math.max(createdAtMillis(loc), updatedAtMillis(loc)) < 60_000) {
        byId.set(loc.id, loc);
      }
    }
  }

  const items = sortByCreatedAtDesc([...byId.values()]);
  const hasMore = pageItems.length >= LOCATIONS_PAGE_SIZE;
  const nextSynced =
    syncedAtMillis !== undefined
      ? syncedAtMillis
      : (prev?.syncedAtMillis ??
        readPersistedCollectionSync("locations", userId));
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
    syncedAtMillis: nextSynced,
  };
  locationsStore.set(key, state);
  if (typeof nextSynced === "number" && nextSynced > 0) {
    writePersistedCollectionSync("locations", userId, nextSynced);
  }
  return state;
}

function markLocationsSynced(userId: string, millis: number): void {
  const key = locationsKey(userId);
  const prev = locationsStore.get(key);
  writePersistedCollectionSync("locations", userId, millis);
  if (!prev) return;
  if (prev.syncedAtMillis != null && prev.syncedAtMillis >= millis) return;
  locationsStore.set(key, { ...prev, syncedAtMillis: millis });
}

/** After a local write: bump profile watermark and mark cache as current. */
function noteLocationsLocalWrite(userId: string): void {
  void bumpLocationsSyncAt(userId)
    .then((millis) => markLocationsSynced(userId, millis))
    .catch(() => {
      markLocationsSynced(userId, Date.now());
    });
}

function queryLocationsFromServer(
  userId: string,
  syncedAtMillis?: number | null
): Promise<LocationsCacheState> {
  const key = locationsKey(userId);
  return locationsInFlight.run(`${key}:hard`, async () => {
    const snap = await getDocsCacheFirst(locationsQuery(userId), {
      forceServer: true,
    });
    const state = applyLocationsSnapshot(
      userId,
      snap.docs.map(mapDoc),
      snap.docs[snap.docs.length - 1],
      syncedAtMillis ?? Date.now()
    );
    if (state.hasMore) {
      void loadRemainingLocationPages(userId);
    }
    return state;
  });
}

/**
 * Refresh locations from the server only when the profile watermark moved
 * (or on first bootstrap when no watermark exists yet).
 */
function revalidateLocationsIfChanged(userId: string): void {
  void (async () => {
    try {
      const profile = await getUserProfile(userId);
      const remote = timestampMillis(profile?.locationsSyncAt);
      const state = locationsStore.get(locationsKey(userId));
      const local =
        state?.syncedAtMillis ??
        readPersistedCollectionSync("locations", userId);

      // Watermark unchanged → keep IndexedDB / memory (0 collection reads).
      if (remote != null && local != null && remote <= local) {
        if (state && state.syncedAtMillis == null) {
          markLocationsSynced(userId, local);
        }
        return;
      }

      if (remote != null && (local == null || remote > local)) {
        await queryLocationsFromServer(userId, remote);
        return;
      }

      // Legacy: no profile watermark yet — one server fetch, then bootstrap it.
      if (local == null) {
        await queryLocationsFromServer(userId, Date.now());
        void bumpLocationsSyncAt(userId)
          .then((millis) => markLocationsSynced(userId, millis))
          .catch(() => undefined);
      }
    } catch {
      // Offline / profile error — keep painted cache.
    }
  })();
}

/**
 * Ensure locations are loaded into the shared cache.
 * Soft (default): memory / IndexedDB paint, then refresh only if the
 * profile `locationsSyncAt` watermark advanced.
 * Hard: force server re-query from the start.
 */
export async function ensureLocations(
  userId: string,
  options?: { hard?: boolean }
): Promise<LocationsCacheState> {
  const key = locationsKey(userId);
  const hard = options?.hard === true;

  if (hard) {
    return queryLocationsFromServer(userId);
  }

  const mem = locationsStore.get(key);
  if (mem) {
    recordCacheHit();
    revalidateLocationsIfChanged(userId);
    return mem;
  }

  return locationsInFlight.run(`${key}:soft`, async () => {
    const current = locationsStore.get(key);
    if (current) {
      recordCacheHit();
      revalidateLocationsIfChanged(userId);
      return current;
    }

    try {
      const cached = await getDocsFromCache(locationsQuery(userId));
      if (!cached.empty) {
        recordCacheHit();
        const state = applyLocationsSnapshot(
          userId,
          cached.docs.map(mapDoc),
          cached.docs[cached.docs.length - 1],
          readPersistedCollectionSync("locations", userId)
        );
        if (state.hasMore) {
          void loadRemainingLocationPages(userId);
        }
        revalidateLocationsIfChanged(userId);
        return state;
      }
    } catch {
      // Persistence unavailable — fall through to server.
    }

    return queryLocationsFromServer(userId);
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
    for (const item of page) {
      const existing = byId.get(item.id);
      byId.set(
        item.id,
        existing && updatedAtMillis(existing) > updatedAtMillis(item)
          ? existing
          : item
      );
    }
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
      syncedAtMillis: current.syncedAtMillis ?? null,
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

export class LocationLimitError extends Error {
  readonly plan: SubscriptionPlan;
  readonly limit: number;

  constructor(plan: SubscriptionPlan, limit: number) {
    super(locationLimitMessage(plan, limit));
    this.name = "LocationLimitError";
    this.plan = plan;
    this.limit = limit;
  }
}

function locationLimitMessage(plan: SubscriptionPlan, limit: number): string {
  if (plan === "plus") {
    return `You've reached the Plus limit of ${limit} saved places. Upgrade to Pro to save up to ${LOCATION_LIMITS.pro}.`;
  }
  if (plan === "pro") {
    return `You've reached the Pro limit of ${limit} saved places.`;
  }
  return `You've reached the free limit of ${limit} saved places. Upgrade to Plus to save up to ${LOCATION_LIMITS.plus}.`;
}

function activeLocationCount(items: SavedLocation[]): number {
  return items.filter((location) => location.deleted !== true).length;
}

/**
 * Active locations in users/{uid}/locations.
 * A complete list cache is the count (0 reads). Otherwise the subcollection
 * is loaded into that cache, then counted.
 * When `atLeast` is set and the loaded prefix already reaches it, paging stops
 * and the return value is that prefix (enough to enforce a cap).
 */
export async function countUserLocations(
  userId: string,
  options?: { atLeast?: number }
): Promise<number> {
  const atLeast = options?.atLeast;
  const key = locationsKey(userId);
  const cached = locationsStore.get(key);
  if (cached?.complete) return activeLocationCount(cached.items);
  if (
    cached &&
    atLeast != null &&
    activeLocationCount(cached.items) >= atLeast
  ) {
    return activeLocationCount(cached.items);
  }

  // A single upsert can seed the store before a list query. That is not the
  // subcollection size (complete stays false and there is no page cursor).
  const needsFullLoad = !cached || (!cached.complete && !cached.hasMore);
  let state = needsFullLoad
    ? await ensureLocations(userId, { hard: Boolean(cached) })
    : cached;
  if (!state) return 0;

  if (atLeast != null && activeLocationCount(state.items) >= atLeast) {
    return activeLocationCount(state.items);
  }

  if (!state.complete) {
    await loadRemainingLocationPages(userId);
    state = locationsStore.get(key) ?? state;
  }

  return activeLocationCount(state.items);
}

/** Throws LocationLimitError when the plan cap is already reached. */
export async function assertCanAddLocation(userId: string): Promise<void> {
  const profile = await getUserProfile(userId);
  const { plan, limit } = locationLimitForSubscription(profile?.subscription);
  const count = await countUserLocations(userId, { atLeast: limit });
  if (count >= limit) throw new LocationLimitError(plan, limit);
}

/** Serializes creates so two parallel saves cannot both pass the same count. */
const locationCreateQueue = new Map<string, Promise<unknown>>();

function enqueueLocationCreate<T>(
  userId: string,
  task: () => Promise<T>
): Promise<T> {
  const previous = locationCreateQueue.get(userId) ?? Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.then(
    () => undefined,
    () => undefined
  );
  locationCreateQueue.set(userId, settled);
  void settled.finally(() => {
    if (locationCreateQueue.get(userId) === settled) {
      locationCreateQueue.delete(userId);
    }
  });
  return run;
}

export async function createUserLocation(
  userId: string,
  input: UserLocationCreateInput
): Promise<string> {
  return enqueueLocationCreate(userId, () =>
    writeUserLocation(userId, input)
  );
}

async function writeUserLocation(
  userId: string,
  input: UserLocationCreateInput
): Promise<string> {
  await assertCanAddLocation(userId);

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
  noteLocationsLocalWrite(userId);

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

  // Clear with deleteField — storing null has tripped rules diffs on some docs.
  const clearVisitedAt = payload.visitedAt === null;
  if (clearVisitedAt) {
    payload.visitedAt = deleteField();
  }

  const ref = locationRef(userId, locationId);
  const cachePatch = {
    ...omitUndefined(input as Record<string, unknown>),
    updatedAt: approxNowTimestamp(),
    ...(touchesAggregationFields(input) ? { aggregated: false } : {}),
    ...(clearVisitedAt ? { visitedAt: null } : {}),
  } as Partial<UserLocation>;

  try {
    await updateDoc(ref, payload);
  } catch (err) {
    // Stale client cache: place still listed but server doc was hard-deleted.
    // Recreate from cache so status/note edits keep working.
    if (isNotFoundError(err)) {
      const cached = getCachedLocation(userId, locationId);
      if (cached && cached.deleted !== true) {
        const body = locationDocFromCache(cached);
        for (const [key, value] of Object.entries(payload)) {
          if (key === "visitedAt" && clearVisitedAt) {
            delete body.visitedAt;
            continue;
          }
          body[key] = value;
        }
        body.aggregated = false;
        delete body.intelligenceContribution;
        delete body.aggregatedAt;
        delete body.deleted;
        if (!body.createdAt) body.createdAt = serverTimestamp();
        body.updatedAt = serverTimestamp();
        await setDoc(ref, body);
        patchLocationInCache(userId, locationId, cachePatch);
        noteLocationsLocalWrite(userId);
        return;
      }
      removeLocationFromCache(userId, locationId);
      throw new Error(
        "This place no longer exists on the server. Refresh the page and try again."
      );
    }
    if (isPermissionDeniedError(err)) {
      throw new Error(
        `Missing or insufficient permissions (locations/${locationId}).`
      );
    }
    throw err instanceof Error ? err : new Error("Failed to update place.");
  }

  patchLocationInCache(userId, locationId, cachePatch);
  noteLocationsLocalWrite(userId);
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
  noteLocationsLocalWrite(userId);
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
