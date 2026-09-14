import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  limit,
  startAfter,
  type CollectionReference,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getFirestoreDb, FirestorePaths } from "@/lib/firebase/firestore";
import { getDocsCacheFirst, getDocCacheFirst } from "@/lib/firebase/cache-read";
import { recordCacheHit } from "@/lib/firebase/debug";
import { slugifyId } from "@/lib/utils";
import {
  approxNowTimestamp,
  favoriteCitiesInFlight,
  favoriteCitiesKey,
  favoriteCitiesStore,
  removeFavoriteFromCache,
  upsertFavoriteInCache,
  type FavoriteCitiesCacheState,
  type SavedFavoriteCity,
} from "@/lib/firebase/data-cache";
import type { FavoriteCity, FavoriteCityCreateInput } from "@/types/favorite-city";

export const FAVORITE_CITIES_PAGE_SIZE = 50;

function favoriteCitiesCollection(userId: string): CollectionReference {
  return collection(getFirestoreDb(), FirestorePaths.favoriteCities(userId));
}

/** Stable Firestore doc id for a city + country pair. */
export function favoriteCityId(cityName: string, country: string): string {
  return `${slugifyId(country)}_${slugifyId(cityName)}`;
}

function isActiveFavorite(data: FavoriteCity): boolean {
  return data.deleted !== true;
}

function mapDoc(d: QueryDocumentSnapshot): SavedFavoriteCity {
  return {
    id: d.id,
    ...(d.data() as FavoriteCity),
  };
}

export async function ensureFavoriteCities(
  userId: string,
  options?: { hard?: boolean }
): Promise<FavoriteCitiesCacheState> {
  const key = favoriteCitiesKey(userId);
  const hard = options?.hard === true;

  if (!hard) {
    const mem = favoriteCitiesStore.get(key);
    if (mem) {
      recordCacheHit();
      return mem;
    }
  }

  return favoriteCitiesInFlight.run(
    `${key}:${hard ? "hard" : "soft"}`,
    async () => {
      if (!hard) {
        const mem = favoriteCitiesStore.get(key);
        if (mem) {
          recordCacheHit();
          return mem;
        }
      }

      // Prefer ordered pagination when createdAt exists; fall back to unbounded
      // cache-first read only for the first page-sized slice via limit.
      const q = query(
        favoriteCitiesCollection(userId),
        orderBy("createdAt", "desc"),
        limit(FAVORITE_CITIES_PAGE_SIZE)
      );

      let snap;
      try {
        snap = await getDocsCacheFirst(q, { forceServer: hard });
      } catch {
        // Legacy docs may lack createdAt — fall back to collection read with limit.
        const fallback = query(
          favoriteCitiesCollection(userId),
          limit(FAVORITE_CITIES_PAGE_SIZE)
        );
        snap = await getDocsCacheFirst(fallback, { forceServer: hard });
      }

      const items = snap.docs
        .map(mapDoc)
        .filter((d) => isActiveFavorite(d));
      const last = snap.docs[snap.docs.length - 1];
      const hasMore = snap.docs.length >= FAVORITE_CITIES_PAGE_SIZE;
      const state: FavoriteCitiesCacheState = {
        items,
        complete: !hasMore,
        hasMore,
        cursor: last ? { id: last.id } : null,
      };
      favoriteCitiesStore.set(key, state);

      if (hasMore) {
        void loadRemainingFavoritePages(userId);
      }

      return state;
    }
  );
}

export async function loadMoreFavoriteCities(
  userId: string
): Promise<FavoriteCitiesCacheState> {
  const key = favoriteCitiesKey(userId);
  const prev = favoriteCitiesStore.get(key);
  if (!prev?.hasMore || !prev.cursor) {
    return (
      prev ?? { items: [], complete: true, hasMore: false, cursor: null }
    );
  }

  return favoriteCitiesInFlight.run(
    `${key}:more:${prev.cursor.id}`,
    async () => {
      const current = favoriteCitiesStore.get(key) ?? prev;
      if (!current.hasMore || !current.cursor) return current;

      const cursorRef = doc(
        getFirestoreDb(),
        FirestorePaths.favoriteCity(userId, current.cursor.id)
      );
      const cursorSnap = await getDocCacheFirst(cursorRef);
      if (!cursorSnap.exists()) {
        const done = {
          ...current,
          hasMore: false,
          complete: true,
          cursor: null,
        };
        favoriteCitiesStore.set(key, done);
        return done;
      }

      let snap;
      try {
        const q = query(
          favoriteCitiesCollection(userId),
          orderBy("createdAt", "desc"),
          startAfter(cursorSnap),
          limit(FAVORITE_CITIES_PAGE_SIZE)
        );
        snap = await getDocsCacheFirst(q);
      } catch {
        const q = query(
          favoriteCitiesCollection(userId),
          startAfter(cursorSnap),
          limit(FAVORITE_CITIES_PAGE_SIZE)
        );
        snap = await getDocsCacheFirst(q);
      }

      const page = snap.docs.map(mapDoc).filter((d) => isActiveFavorite(d));
      const byId = new Map(current.items.map((c) => [c.id, c]));
      for (const item of page) byId.set(item.id, item);
      const last = snap.docs[snap.docs.length - 1];
      const hasMore = snap.docs.length >= FAVORITE_CITIES_PAGE_SIZE;
      const state: FavoriteCitiesCacheState = {
        items: [...byId.values()],
        complete: !hasMore,
        hasMore,
        cursor: last ? { id: last.id } : null,
      };
      favoriteCitiesStore.set(key, state);
      return state;
    }
  );
}

async function loadRemainingFavoritePages(userId: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const state = favoriteCitiesStore.get(favoriteCitiesKey(userId));
    if (!state?.hasMore) return;
    await loadMoreFavoriteCities(userId);
  }
}

export async function listFavoriteCities(
  userId: string,
  options?: { hard?: boolean }
): Promise<SavedFavoriteCity[]> {
  const state = await ensureFavoriteCities(userId, options);
  return state.items;
}

export async function upsertFavoriteCity(
  userId: string,
  input: FavoriteCityCreateInput
): Promise<void> {
  const ref = doc(
    getFirestoreDb(),
    FirestorePaths.favoriteCity(userId, input.cityId)
  );
  await setDoc(
    ref,
    {
      ...input,
      aggregated: false,
      deleted: false,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  upsertFavoriteInCache(userId, {
    id: input.cityId,
    ...input,
    aggregated: false,
    deleted: false,
    createdAt: approxNowTimestamp(),
  });
}

/**
 * Soft-delete when the favorite was already aggregated so Travel Intelligence
 * can reverse its contribution. Otherwise hard-delete.
 */
export async function removeFavoriteCity(
  userId: string,
  cityId: string
): Promise<void> {
  const ref = doc(
    getFirestoreDb(),
    FirestorePaths.favoriteCity(userId, cityId)
  );

  const mem = favoriteCitiesStore
    .get(favoriteCitiesKey(userId))
    ?.items.find((c) => c.id === cityId || c.cityId === cityId);

  let data = mem as FavoriteCity | undefined;
  if (!data) {
    const snap = await getDocCacheFirst(ref);
    if (!snap.exists()) {
      removeFavoriteFromCache(userId, cityId);
      return;
    }
    data = snap.data() as FavoriteCity;
  }

  const needsReversal =
    data.aggregated === true || data.intelligenceContribution != null;

  if (needsReversal) {
    await updateDoc(ref, {
      deleted: true,
      aggregated: false,
    });
  } else {
    await deleteDoc(ref);
  }

  removeFavoriteFromCache(userId, cityId);
}

export function subscribeFavoriteCitiesCache(
  userId: string,
  listener: (state: FavoriteCitiesCacheState | undefined) => void
): () => void {
  return favoriteCitiesStore.subscribe(favoriteCitiesKey(userId), listener);
}
