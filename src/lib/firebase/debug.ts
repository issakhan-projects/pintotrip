/**
 * Development-only Firestore cost counters.
 * Never logs private user data.
 */

export type FirestoreDebugCounters = {
  reads: number;
  queries: number;
  cacheHits: number;
  cacheMisses: number;
  deduplicatedRequests: number;
  listenerAttach: number;
  listenerDetach: number;
};

const emptyCounters = (): FirestoreDebugCounters => ({
  reads: 0,
  queries: 0,
  cacheHits: 0,
  cacheMisses: 0,
  deduplicatedRequests: 0,
  listenerAttach: 0,
  listenerDetach: 0,
});

let counters = emptyCounters();
const isDev =
  typeof process !== "undefined" && process.env.NODE_ENV === "development";

function bump(key: keyof FirestoreDebugCounters, by = 1): void {
  if (!isDev) return;
  counters[key] += by;
}

export function recordFirestoreRead(docCount = 1): void {
  bump("reads", Math.max(0, docCount));
}

export function recordFirestoreQuery(docCount = 0): void {
  bump("queries", 1);
  if (docCount > 0) bump("reads", docCount);
}

export function recordCacheHit(): void {
  bump("cacheHits");
}

export function recordCacheMiss(): void {
  bump("cacheMisses");
}

export function recordDeduplicatedRequest(): void {
  bump("deduplicatedRequests");
}

export function recordListenerAttach(): void {
  bump("listenerAttach");
}

export function recordListenerDetach(): void {
  bump("listenerDetach");
}

export function getFirestoreDebugCounters(): Readonly<FirestoreDebugCounters> {
  return { ...counters };
}

export function resetFirestoreDebugCounters(): void {
  counters = emptyCounters();
}

/** Expose counters on window in development for manual inspection. */
export function installFirestoreDebugGlobals(): void {
  if (!isDev || typeof window === "undefined") return;
  const w = window as Window & {
    __firestoreDebug?: {
      get: typeof getFirestoreDebugCounters;
      reset: typeof resetFirestoreDebugCounters;
    };
  };
  w.__firestoreDebug = {
    get: getFirestoreDebugCounters,
    reset: resetFirestoreDebugCounters,
  };
}
