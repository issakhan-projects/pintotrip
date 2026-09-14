import {
  collection,
  doc,
  query,
  orderBy,
  limit,
  startAfter,
  where,
  Timestamp,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getFirestoreDb, FirestorePaths } from "@/lib/firebase/firestore";
import { getDocsCacheFirst, getDocCacheFirst } from "@/lib/firebase/cache-read";
import { recordCacheHit } from "@/lib/firebase/debug";
import {
  travelIntelCitiesStore,
  travelIntelCountriesStore,
  travelIntelDailyStore,
  travelIntelInFlight,
  travelIntelPlacesStore,
} from "@/lib/firebase/data-cache";
import type {
  TravelIntelligenceCity,
  TravelIntelligenceCountry,
  TravelIntelligenceDaily,
  TravelIntelligencePlace,
} from "@/types/travel-intelligence";

/** Travel Intelligence is mostly stable — longer soft TTL. */
export const TRAVEL_INTEL_TTL_MS = 30 * 60 * 1000;

const DEFAULT_TOP_N = 20;

type CacheMeta = { fetchedAt: number };

const placesMeta = new Map<string, CacheMeta>();
const citiesMeta = new Map<string, CacheMeta>();
const countriesMeta = new Map<string, CacheMeta>();
const dailyMeta = new Map<string, CacheMeta>();

function isFresh(meta: CacheMeta | undefined, ttl = TRAVEL_INTEL_TTL_MS): boolean {
  if (!meta) return false;
  return Date.now() - meta.fetchedAt < ttl;
}

function cacheKey(sort: string, topN: number): string {
  return `${sort}:${topN}`;
}

/**
 * Top N places by popularity or trending — never the full collection.
 */
export async function listTopTravelPlaces(options?: {
  sortBy?: "popularityScore" | "trendingScore";
  limit?: number;
  hard?: boolean;
}): Promise<Array<TravelIntelligencePlace & { id: string }>> {
  const sortBy = options?.sortBy ?? "trendingScore";
  const topN = options?.limit ?? DEFAULT_TOP_N;
  const key = cacheKey(sortBy, topN);
  const hard = options?.hard === true;

  if (!hard) {
    const mem = travelIntelPlacesStore.get(key);
    if (mem && isFresh(placesMeta.get(key))) {
      recordCacheHit();
      return mem;
    }
  }

  return travelIntelInFlight.run(
    `places:${key}:${hard ? "hard" : "soft"}`,
    async () => {
      if (!hard) {
        const mem = travelIntelPlacesStore.get(key);
        if (mem && isFresh(placesMeta.get(key))) {
          recordCacheHit();
          return mem;
        }
      }

      const q = query(
        collection(getFirestoreDb(), FirestorePaths.travelIntelligencePlaces),
        orderBy(sortBy, "desc"),
        limit(topN)
      );
      const snap = await getDocsCacheFirst(q, { forceServer: hard });
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as TravelIntelligencePlace),
      }));
      travelIntelPlacesStore.set(key, items);
      placesMeta.set(key, { fetchedAt: Date.now() });
      return items;
    }
  ) as Promise<Array<TravelIntelligencePlace & { id: string }>>;
}

export async function listTopTravelCities(options?: {
  sortBy?: "popularityScore" | "trendingScore";
  limit?: number;
  hard?: boolean;
}): Promise<Array<TravelIntelligenceCity & { id: string }>> {
  const sortBy = options?.sortBy ?? "trendingScore";
  const topN = options?.limit ?? DEFAULT_TOP_N;
  const key = cacheKey(sortBy, topN);
  const hard = options?.hard === true;

  if (!hard) {
    const mem = travelIntelCitiesStore.get(key);
    if (mem && isFresh(citiesMeta.get(key))) {
      recordCacheHit();
      return mem;
    }
  }

  return travelIntelInFlight.run(
    `cities:${key}:${hard ? "hard" : "soft"}`,
    async () => {
      if (!hard) {
        const mem = travelIntelCitiesStore.get(key);
        if (mem && isFresh(citiesMeta.get(key))) {
          recordCacheHit();
          return mem;
        }
      }

      const q = query(
        collection(getFirestoreDb(), FirestorePaths.travelIntelligenceCities),
        orderBy(sortBy, "desc"),
        limit(topN)
      );
      const snap = await getDocsCacheFirst(q, { forceServer: hard });
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as TravelIntelligenceCity),
      }));
      travelIntelCitiesStore.set(key, items);
      citiesMeta.set(key, { fetchedAt: Date.now() });
      return items;
    }
  ) as Promise<Array<TravelIntelligenceCity & { id: string }>>;
}

export async function listTopTravelCountries(options?: {
  sortBy?: "popularityScore" | "trendingScore";
  limit?: number;
  hard?: boolean;
}): Promise<Array<TravelIntelligenceCountry & { id: string }>> {
  const sortBy = options?.sortBy ?? "trendingScore";
  const topN = options?.limit ?? DEFAULT_TOP_N;
  const key = cacheKey(sortBy, topN);
  const hard = options?.hard === true;

  if (!hard) {
    const mem = travelIntelCountriesStore.get(key);
    if (mem && isFresh(countriesMeta.get(key))) {
      recordCacheHit();
      return mem;
    }
  }

  return travelIntelInFlight.run(
    `countries:${key}:${hard ? "hard" : "soft"}`,
    async () => {
      if (!hard) {
        const mem = travelIntelCountriesStore.get(key);
        if (mem && isFresh(countriesMeta.get(key))) {
          recordCacheHit();
          return mem;
        }
      }

      const q = query(
        collection(
          getFirestoreDb(),
          FirestorePaths.travelIntelligenceCountries
        ),
        orderBy(sortBy, "desc"),
        limit(topN)
      );
      const snap = await getDocsCacheFirst(q, { forceServer: hard });
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as TravelIntelligenceCountry),
      }));
      travelIntelCountriesStore.set(key, items);
      countriesMeta.set(key, { fetchedAt: Date.now() });
      return items;
    }
  ) as Promise<Array<TravelIntelligenceCountry & { id: string }>>;
}

/**
 * Daily aggregates for a bounded date range (inclusive), e.g. last 7 / 30 days.
 * Never loads full history.
 */
export async function listTravelIntelligenceDaily(options: {
  startDate: string;
  endDate: string;
  hard?: boolean;
}): Promise<Array<TravelIntelligenceDaily & { id: string }>> {
  const { startDate, endDate } = options;
  const key = `daily:${startDate}:${endDate}`;
  const hard = options.hard === true;

  if (!hard) {
    const mem = travelIntelDailyStore.get(key);
    if (mem && isFresh(dailyMeta.get(key))) {
      recordCacheHit();
      return mem;
    }
  }

  return travelIntelInFlight.run(
    `${key}:${hard ? "hard" : "soft"}`,
    async () => {
      if (!hard) {
        const mem = travelIntelDailyStore.get(key);
        if (mem && isFresh(dailyMeta.get(key))) {
          recordCacheHit();
          return mem;
        }
      }

      const constraints: QueryConstraint[] = [
        where("date", ">=", startDate),
        where("date", "<=", endDate),
        orderBy("date", "desc"),
      ];
      const q = query(
        collection(getFirestoreDb(), FirestorePaths.travelIntelligenceDaily),
        ...constraints
      );
      const snap = await getDocsCacheFirst(q, { forceServer: hard });
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as TravelIntelligenceDaily),
      }));
      travelIntelDailyStore.set(key, items);
      dailyMeta.set(key, { fetchedAt: Date.now() });
      return items;
    }
  ) as Promise<Array<TravelIntelligenceDaily & { id: string }>>;
}

/** Convenience: last N calendar days of daily intel (UTC dates YYYY-MM-DD). */
export async function listTravelIntelligenceLastDays(
  days: 7 | 30,
  options?: { hard?: boolean }
): Promise<Array<TravelIntelligenceDaily & { id: string }>> {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return listTravelIntelligenceDaily({
    startDate: fmt(start),
    endDate: fmt(end),
    hard: options?.hard,
  });
}

export async function getTravelIntelligencePlace(
  placeId: string,
  options?: { hard?: boolean }
): Promise<(TravelIntelligencePlace & { id: string }) | null> {
  const snap = await getDocCacheFirst(
    doc(getFirestoreDb(), FirestorePaths.travelIntelligencePlace(placeId)),
    { forceServer: options?.hard }
  );
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as TravelIntelligencePlace) };
}

/**
 * Cursor pagination for travel intelligence lists when Top N is not enough.
 */
export async function listTravelPlacesPage(options: {
  sortBy?: "popularityScore" | "trendingScore";
  pageSize?: number;
  afterId?: string;
  hard?: boolean;
}): Promise<{
  items: Array<TravelIntelligencePlace & { id: string }>;
  lastId: string | null;
  hasMore: boolean;
}> {
  const sortBy = options.sortBy ?? "trendingScore";
  const pageSize = options.pageSize ?? DEFAULT_TOP_N;
  const constraints: QueryConstraint[] = [
    orderBy(sortBy, "desc"),
    limit(pageSize),
  ];

  if (options.afterId) {
    const cursorSnap = await getDocCacheFirst(
      doc(
        getFirestoreDb(),
        FirestorePaths.travelIntelligencePlace(options.afterId)
      )
    );
    if (cursorSnap.exists()) {
      constraints.splice(1, 0, startAfter(cursorSnap as QueryDocumentSnapshot));
    }
  }

  const q = query(
    collection(getFirestoreDb(), FirestorePaths.travelIntelligencePlaces),
    ...constraints
  );
  const snap = await getDocsCacheFirst(q, { forceServer: options.hard });
  const items = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as TravelIntelligencePlace),
  }));
  const last = snap.docs[snap.docs.length - 1];
  return {
    items,
    lastId: last?.id ?? null,
    hasMore: snap.docs.length >= pageSize,
  };
}

/** ISO date helper for range queries keyed by updatedAt. */
export function timestampDaysAgo(days: number): Timestamp {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return Timestamp.fromDate(d);
}
