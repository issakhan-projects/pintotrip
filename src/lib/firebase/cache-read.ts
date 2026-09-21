import {
  getDocs,
  getDocsFromCache,
  getDoc,
  getDocFromCache,
  type Query,
  type DocumentReference,
  type QuerySnapshot,
  type DocumentSnapshot,
} from "firebase/firestore";
import {
  recordCacheHit,
  recordCacheMiss,
  recordFirestoreQuery,
  recordFirestoreRead,
} from "./debug";

export type CacheReadOptions = {
  /**
   * When true, skip cache and read from server.
   * Soft refresh should leave this false (0 extra reads if cache warm).
   */
  forceServer?: boolean;
};

/**
 * Cache-first query.
 * If IndexedDB/local cache has matching docs, return them and do NOT hit server.
 * Only falls through to getDocs when cache is empty / unavailable.
 * When offline, never force a server round-trip.
 */
export async function getDocsCacheFirst<T = unknown>(
  q: Query<T>,
  options?: CacheReadOptions
): Promise<QuerySnapshot<T>> {
  const forceServer =
    options?.forceServer === true &&
    !(typeof navigator !== "undefined" && navigator.onLine === false);

  if (!forceServer) {
    try {
      const cached = await getDocsFromCache(q);
      if (!cached.empty) {
        recordCacheHit();
        recordFirestoreQuery(0);
        return cached;
      }
      recordCacheMiss();
    } catch {
      recordCacheMiss();
    }
  } else {
    recordCacheMiss();
  }

  const snap = await getDocs(q);
  recordFirestoreQuery(snap.size);
  return snap;
}

/**
 * Cache-first document read.
 * When offline, never force a server round-trip.
 */
export async function getDocCacheFirst<T = unknown>(
  ref: DocumentReference<T>,
  options?: CacheReadOptions
): Promise<DocumentSnapshot<T>> {
  const forceServer =
    options?.forceServer === true &&
    !(typeof navigator !== "undefined" && navigator.onLine === false);

  if (!forceServer) {
    try {
      const cached = await getDocFromCache(ref);
      if (cached.exists()) {
        recordCacheHit();
        return cached;
      }
      recordCacheMiss();
    } catch {
      recordCacheMiss();
    }
  } else {
    recordCacheMiss();
  }

  const snap = await getDoc(ref);
  if (snap.exists()) recordFirestoreRead(1);
  else recordFirestoreRead(0);
  return snap;
}
