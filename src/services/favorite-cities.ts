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
import { countryIdFromParts, isAsciiId, slugifyId } from "@/lib/utils";
import { resolveCountryCode } from "@/lib/countries";
import { resolveEnglishPlaceIds, englishPlaceIdsFromNames } from "@/lib/maps";
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

/**
 * Stable Firestore doc id: `{countryId}_{cityId}` (e.g. `sa_jeddah`).
 * Prefer resolved English/ASCII parts — never persist `unknown_*` from localized names.
 */
export function favoriteCityIdFromParts(
  countryId: string,
  cityId: string
): string | null {
  const country = countryId.trim().toLowerCase();
  const city = cityId.trim().toLowerCase();
  if (!isAsciiId(country) || !isAsciiId(city)) return null;
  return `${country}_${city}`;
}

/**
 * @deprecated Prefer {@link resolveFavoriteCityId} — slugifying localized names yields `unknown_*`.
 */
export function favoriteCityId(cityName: string, country: string): string {
  return `${slugifyId(country)}_${slugifyId(cityName)}`;
}

/**
 * Resolve an English/ASCII favorite doc id from coordinates (+ display-name fallbacks).
 * Returns null when ids cannot be resolved without producing `unknown`.
 */
export async function resolveFavoriteCityId(input: {
  cityName: string;
  country: string;
  lat: number;
  lon: number;
}): Promise<string | null> {
  const englishIds =
    englishPlaceIdsFromNames(
      input.cityName,
      input.country,
      resolveCountryCode(input.country) || undefined
    ) ?? (await resolveEnglishPlaceIds(input.lat, input.lon));
  if (englishIds) {
    const fromCoords = favoriteCityIdFromParts(
      englishIds.countryId,
      englishIds.cityId
    );
    if (fromCoords) return fromCoords;
  }

  const countryCode =
    englishIds?.countryCode ||
    resolveCountryCode(input.country) ||
    undefined;
  const countryId = countryIdFromParts(
    englishIds?.countryNameEn || input.country,
    countryCode
  );
  const citySlug = slugifyId(
    englishIds?.cityNameEn || input.cityName
  );
  return favoriteCityIdFromParts(countryId, citySlug);
}

/** Match a favorite by id, display names, or nearby coordinates. */
export function findFavoriteCity(
  favorites: SavedFavoriteCity[],
  input: {
    cityName: string;
    country: string;
    lat?: number;
    lon?: number;
    cityId?: string | null;
  }
): SavedFavoriteCity | undefined {
  const name = input.cityName.trim().toLowerCase();
  const country = input.country.trim().toLowerCase();
  const legacyId = favoriteCityId(input.cityName, input.country);
  const resolvedId = input.cityId?.trim().toLowerCase() || null;

  return favorites.find((c) => {
    if (resolvedId && (c.cityId === resolvedId || c.id === resolvedId)) {
      return true;
    }
    if (c.cityId === legacyId || c.id === legacyId) return true;
    if (
      c.cityName.trim().toLowerCase() === name &&
      c.country.trim().toLowerCase() === country
    ) {
      return true;
    }
    if (
      input.lat != null &&
      input.lon != null &&
      Number.isFinite(input.lat) &&
      Number.isFinite(input.lon) &&
      Math.abs(c.lat - input.lat) < 0.05 &&
      Math.abs(c.lon - input.lon) < 0.05
    ) {
      return true;
    }
    return false;
  });
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

  let data: FavoriteCity | undefined;
  try {
    const snap = await getDocCacheFirst(ref, { forceServer: true });
    if (!snap.exists()) {
      removeFavoriteFromCache(userId, cityId);
      return;
    }
    data = snap.data() as FavoriteCity;
  } catch {
    const mem = favoriteCitiesStore
      .get(favoriteCitiesKey(userId))
      ?.items.find((c) => c.id === cityId || c.cityId === cityId);
    data = mem as FavoriteCity | undefined;
    if (!data) {
      removeFavoriteFromCache(userId, cityId);
      return;
    }
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
