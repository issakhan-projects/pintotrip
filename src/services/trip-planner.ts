import {
  collection,
  doc,
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
import { recordCacheHit } from "@/lib/firebase/debug";
import {
  approxNowTimestamp,
  patchTripInCache,
  removeTripFromListCache,
  tripDetailInFlight,
  tripDetailKey,
  tripDetailStore,
  tripsInFlight,
  tripsKey,
  tripsStore,
  upsertTripInListCache,
  type TripsCacheState,
} from "@/lib/firebase/data-cache";
import type {
  TripPlanner,
  TripPlannerCreateInput,
  TripPlannerDoc,
  TripPlannerUpdateInput,
} from "@/types/trip-planner";

export const TRIPS_PAGE_SIZE = 30;

function tripsCollection(userId: string): CollectionReference {
  return collection(getFirestoreDb(), FirestorePaths.tripPlanner(userId));
}

function tripRef(userId: string, tripId: string): DocumentReference {
  return doc(getFirestoreDb(), FirestorePaths.trip(userId, tripId));
}

function mapDoc(d: QueryDocumentSnapshot): TripPlannerDoc {
  return {
    id: d.id,
    ...(d.data() as TripPlanner),
  };
}

function createdAtMillis(trip: TripPlannerDoc): number {
  const ts = trip.createdAt;
  if (ts && typeof ts.toMillis === "function") return ts.toMillis();
  return 0;
}

export async function ensureTrips(
  userId: string,
  options?: { hard?: boolean }
): Promise<TripsCacheState> {
  const key = tripsKey(userId);
  const hard = options?.hard === true;

  if (!hard) {
    const mem = tripsStore.get(key);
    // Trust only lists that came from a real query (or are still paginating).
    // A detail-page upsert used to seed { complete:false, hasMore:false, cursor:null }.
    if (mem && isTrustedTripsCache(mem)) {
      recordCacheHit();
      return mem;
    }
  }

  return tripsInFlight.run(`${key}:${hard ? "hard" : "soft"}`, async () => {
    if (!hard) {
      const mem = tripsStore.get(key);
      if (mem && isTrustedTripsCache(mem)) {
        recordCacheHit();
        return mem;
      }
    }

    const q = query(
      tripsCollection(userId),
      orderBy("createdAt", "desc"),
      limit(TRIPS_PAGE_SIZE)
    );
    const snap = await getDocsCacheFirst(q, { forceServer: hard });
    const items = snap.docs.map(mapDoc);
    const last = snap.docs[snap.docs.length - 1];
    const hasMore = snap.docs.length >= TRIPS_PAGE_SIZE;
    const state: TripsCacheState = {
      items,
      complete: !hasMore,
      hasMore,
      cursor: last
        ? { id: last.id, createdAtMillis: createdAtMillis(mapDoc(last)) }
        : null,
    };
    tripsStore.set(key, state);

    // Hydrate detail cache for listed trips (no extra reads — reuse list docs).
    for (const trip of items) {
      tripDetailStore.set(tripDetailKey(userId, trip.id), trip);
    }

    if (hasMore) {
      void loadRemainingTripPages(userId);
    }

    return state;
  });
}

/** True when cache was produced by ensureTrips / pagination, not a detail upsert. */
function isTrustedTripsCache(mem: TripsCacheState): boolean {
  if (mem.complete) return true;
  if (mem.hasMore && mem.cursor) return true;
  // Untrusted seed: one-or-more items with no pagination metadata.
  return false;
}

export async function loadMoreTrips(
  userId: string
): Promise<TripsCacheState> {
  const key = tripsKey(userId);
  const prev = tripsStore.get(key);
  if (!prev?.hasMore || !prev.cursor) {
    return (
      prev ?? { items: [], complete: true, hasMore: false, cursor: null }
    );
  }

  return tripsInFlight.run(`${key}:more:${prev.cursor.id}`, async () => {
    const current = tripsStore.get(key) ?? prev;
    if (!current.hasMore || !current.cursor) return current;

    const cursorSnap = await getDocCacheFirst(
      tripRef(userId, current.cursor.id)
    );
    if (!cursorSnap.exists()) {
      const done = { ...current, hasMore: false, complete: true, cursor: null };
      tripsStore.set(key, done);
      return done;
    }

    const q = query(
      tripsCollection(userId),
      orderBy("createdAt", "desc"),
      startAfter(cursorSnap),
      limit(TRIPS_PAGE_SIZE)
    );
    const snap = await getDocsCacheFirst(q);
    const page = snap.docs.map(mapDoc);
    const byId = new Map(current.items.map((t) => [t.id, t]));
    for (const trip of page) {
      byId.set(trip.id, trip);
      tripDetailStore.set(tripDetailKey(userId, trip.id), trip);
    }
    const last = snap.docs[snap.docs.length - 1];
    const hasMore = snap.docs.length >= TRIPS_PAGE_SIZE;
    const state: TripsCacheState = {
      items: [...byId.values()].sort(
        (a, b) => createdAtMillis(b) - createdAtMillis(a)
      ),
      complete: !hasMore,
      hasMore,
      cursor: last
        ? { id: last.id, createdAtMillis: createdAtMillis(mapDoc(last)) }
        : null,
    };
    tripsStore.set(key, state);
    return state;
  });
}

async function loadRemainingTripPages(userId: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const state = tripsStore.get(tripsKey(userId));
    if (!state?.hasMore) return;
    await loadMoreTrips(userId);
  }
}

export async function listUserTrips(
  userId: string,
  options?: { hard?: boolean }
): Promise<TripPlannerDoc[]> {
  const state = await ensureTrips(userId, options);
  return state.items;
}

export async function getTrip(
  userId: string,
  tripId: string,
  options?: { hard?: boolean }
): Promise<TripPlannerDoc | null> {
  const detailKey = tripDetailKey(userId, tripId);
  const hard = options?.hard === true;

  if (!hard) {
    const mem = tripDetailStore.get(detailKey);
    if (mem) {
      recordCacheHit();
      return mem;
    }
    const fromList = tripsStore
      .get(tripsKey(userId))
      ?.items.find((t) => t.id === tripId);
    if (fromList) {
      recordCacheHit();
      tripDetailStore.set(detailKey, fromList);
      return fromList;
    }
  }

  return tripDetailInFlight.run(
    `${detailKey}:${hard ? "hard" : "soft"}`,
    async () => {
      if (!hard) {
        const mem = tripDetailStore.get(detailKey);
        if (mem) {
          recordCacheHit();
          return mem;
        }
      }

      const snap = await getDocCacheFirst(tripRef(userId, tripId), {
        forceServer: hard,
      });
      if (!snap.exists()) return null;
      const trip = { id: snap.id, ...(snap.data() as TripPlanner) };
      tripDetailStore.set(detailKey, trip);
      upsertTripInListCache(userId, trip);
      return trip;
    }
  );
}

export async function createTrip(
  input: TripPlannerCreateInput
): Promise<string> {
  const ref = await addDoc(tripsCollection(input.userId), {
    status: "planning",
    cityIntelligence: { status: "pending" },
    preparation: { items: [] },
    savedPlaceIds: [],
    itinerary: { status: "empty", days: [] },
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const now = approxNowTimestamp();
  const trip: TripPlannerDoc = {
    id: ref.id,
    status: "planning",
    cityIntelligence: { status: "pending" },
    preparation: { items: [] },
    savedPlaceIds: [],
    itinerary: { status: "empty", days: [] },
    ...input,
    createdAt: now,
    updatedAt: now,
  };
  tripDetailStore.set(tripDetailKey(input.userId, ref.id), trip);
  const listKey = tripsKey(input.userId);
  if (tripsStore.get(listKey)) {
    upsertTripInListCache(input.userId, trip);
  } else {
    // List was never loaded — fetch it so the panel isn't stuck on one trip.
    await ensureTrips(input.userId, { hard: true });
    upsertTripInListCache(input.userId, trip);
  }

  return ref.id;
}

export async function updateTrip(
  userId: string,
  tripId: string,
  input: TripPlannerUpdateInput
): Promise<void> {
  await updateDoc(tripRef(userId, tripId), {
    ...input,
    updatedAt: serverTimestamp(),
  });

  patchTripInCache(userId, tripId, {
    ...input,
    updatedAt: approxNowTimestamp(),
  } as Partial<TripPlannerDoc>);
}

export async function deleteTrip(
  userId: string,
  tripId: string
): Promise<void> {
  await deleteDoc(tripRef(userId, tripId));
  removeTripFromListCache(userId, tripId);
}

export function subscribeTripsCache(
  userId: string,
  listener: (state: TripsCacheState | undefined) => void
): () => void {
  return tripsStore.subscribe(tripsKey(userId), listener);
}

export function subscribeTripDetailCache(
  userId: string,
  tripId: string,
  listener: (trip: TripPlannerDoc | undefined) => void
): () => void {
  return tripDetailStore.subscribe(tripDetailKey(userId, tripId), listener);
}

/** Inclusive day count between two Firestore timestamps. */
export function tripDayCount(
  startDate: Timestamp,
  endDate: Timestamp
): number {
  const start = startOfUtcDay(startDate.toDate());
  const end = startOfUtcDay(endDate.toDate());
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.floor(ms / 86_400_000) + 1);
}

export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
}

export function addUtcDays(date: Date, days: number): Date {
  const next = startOfUtcDay(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function timestampFromDate(date: Date): Timestamp {
  return Timestamp.fromDate(startOfUtcDay(date));
}
