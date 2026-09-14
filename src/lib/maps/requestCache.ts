/**
 * In-memory Maps/Places request cache with in-flight deduplication.
 * Short TTLs only — do not persist Google response bodies beyond session/policy limits.
 * Place IDs may be stored longer elsewhere; this layer is for transient API responses.
 */

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/** Round coords so nearby identical lookups share a cache key (~1.1 m at 5 dp). */
export function roundCoord(value: number, decimals = 5): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function cachedRequest<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.value as T;
  }

  const pending = inflight.get(key);
  if (pending) {
    return pending as Promise<T>;
  }

  const promise = (async (): Promise<T> => {
    const value = await fn();
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

export function peekCachedRequest<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit || hit.expiresAt <= Date.now()) return undefined;
  return hit.value as T;
}

export function clearMapsRequestCache(prefix?: string): void {
  if (!prefix) {
    store.clear();
    inflight.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}

/** Geocoding results — temporary session cache (Google allows caching with limits). */
export const GEOCODE_TTL_MS = 24 * 60 * 60 * 1000;

/** Text Search / destination suggestions — short TTL to cut repeat typing cost. */
export const PLACES_SEARCH_TTL_MS = 10 * 60 * 1000;

/** Photo URI lists — URIs can expire; keep short. */
export const PLACE_PHOTOS_TTL_MS = 30 * 60 * 1000;
