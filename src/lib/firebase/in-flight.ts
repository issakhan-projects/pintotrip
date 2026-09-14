import { recordDeduplicatedRequest } from "./debug";

/**
 * In-flight request deduplication.
 * Concurrent callers with the same key share one Promise; cleared on settle.
 */
export function createInFlightMap<T = unknown>() {
  const pending = new Map<string, Promise<T>>();

  return {
    run(key: string, factory: () => Promise<T>): Promise<T> {
      const existing = pending.get(key);
      if (existing) {
        recordDeduplicatedRequest();
        return existing;
      }

      const promise = factory().finally(() => {
        if (pending.get(key) === promise) {
          pending.delete(key);
        }
      });
      pending.set(key, promise);
      return promise;
    },

    has(key: string): boolean {
      return pending.has(key);
    },

    clear(): void {
      pending.clear();
    },
  };
}

export type InFlightMap<T = unknown> = ReturnType<typeof createInFlightMap<T>>;
