/**
 * Cheap "did this collection change?" watermarks.
 * Profile fields are bumped on write; clients persist the last applied millis
 * so soft loads skip collection reads when nothing changed.
 */

const storageKey = (kind: "locations" | "favoriteCities", userId: string) =>
  `ptt:sync:${kind}:${userId}`;

export function readPersistedCollectionSync(
  kind: "locations" | "favoriteCities",
  userId: string
): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(kind, userId));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function writePersistedCollectionSync(
  kind: "locations" | "favoriteCities",
  userId: string,
  millis: number
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(kind, userId), String(millis));
  } catch {
    // Quota / private mode — memory watermark still works for the session.
  }
}

export function timestampMillis(
  value: { toMillis?: () => number } | null | undefined
): number | null {
  if (!value || typeof value.toMillis !== "function") return null;
  const n = value.toMillis();
  return Number.isFinite(n) && n > 0 ? n : null;
}
