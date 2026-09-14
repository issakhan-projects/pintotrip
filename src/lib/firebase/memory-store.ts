/**
 * Lightweight per-key in-memory store with reference-counted subscribers.
 * Not a global state library — domain services own their store instances.
 */

export type StoreListener<T> = (value: T) => void;

export type MemoryStoreEntry<T> = {
  value: T;
  version: number;
  updatedAt: number;
};

export function createMemoryStore<T>() {
  const entries = new Map<string, MemoryStoreEntry<T>>();
  const listeners = new Map<string, Set<StoreListener<T | undefined>>>();
  const refCounts = new Map<string, number>();

  function getEntry(key: string): MemoryStoreEntry<T> | undefined {
    return entries.get(key);
  }

  function get(key: string): T | undefined {
    return entries.get(key)?.value;
  }

  function has(key: string): boolean {
    return entries.has(key);
  }

  function set(key: string, value: T): void {
    const prev = entries.get(key);
    const next: MemoryStoreEntry<T> = {
      value,
      version: (prev?.version ?? 0) + 1,
      updatedAt: Date.now(),
    };
    entries.set(key, next);
    notify(key, value);
  }

  function patch(key: string, updater: (prev: T | undefined) => T): T {
    const next = updater(get(key));
    set(key, next);
    return next;
  }

  function remove(key: string): void {
    if (!entries.has(key)) return;
    entries.delete(key);
    notify(key, undefined);
  }

  function notify(key: string, value: T | undefined): void {
    const setForKey = listeners.get(key);
    if (!setForKey) return;
    for (const listener of setForKey) {
      listener(value);
    }
  }

  /**
   * Subscribe to a key. Increments ref count. Returns unsubscribe that
   * decrements; when refs hit 0 the entry may optionally be retained
   * (we keep data for offline UX / pause — do not auto-clear).
   */
  function subscribe(
    key: string,
    listener: StoreListener<T | undefined>
  ): () => void {
    let setForKey = listeners.get(key);
    if (!setForKey) {
      setForKey = new Set();
      listeners.set(key, setForKey);
    }
    setForKey.add(listener);
    refCounts.set(key, (refCounts.get(key) ?? 0) + 1);

    // Immediate emit of current value (may be undefined).
    listener(get(key));

    return () => {
      setForKey?.delete(listener);
      if (setForKey && setForKey.size === 0) {
        listeners.delete(key);
      }
      const next = (refCounts.get(key) ?? 1) - 1;
      if (next <= 0) {
        refCounts.delete(key);
      } else {
        refCounts.set(key, next);
      }
    };
  }

  function clearAll(): void {
    entries.clear();
  }

  return {
    get,
    getEntry,
    has,
    set,
    patch,
    remove,
    subscribe,
    clearAll,
    refCount: (key: string) => refCounts.get(key) ?? 0,
  };
}

export type MemoryStore<T> = ReturnType<typeof createMemoryStore<T>>;
