/**
 * In-process request deduplication.
 * Concurrent identical fingerprints share one Promise (one OpenAI call).
 * Note: per Cloud Function instance only — still eliminates double-clicks
 * and parallel callers on the same warm instance.
 *
 * get→set is sync (no await between), so it is race-safe on Node's event loop.
 */

const inflight = new Map<string, Promise<unknown>>();

export async function dedupeAsync<T>(
  key: string,
  factory: () => Promise<T>
): Promise<{ value: T; isLeader: boolean }> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) {
    const value = await existing;
    return { value, isLeader: false };
  }

  const promise = factory().finally(() => {
    if (inflight.get(key) === promise) {
      inflight.delete(key);
    }
  });

  inflight.set(key, promise);

  const value = await promise;
  return { value, isLeader: true };
}

export function isInflight(key: string): boolean {
  return inflight.has(key);
}
