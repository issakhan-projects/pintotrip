import { Timestamp } from "firebase/firestore";
import { normalizeTripDoc } from "@/lib/planner/normalize-trip";
import type { TripPlannerDoc } from "@/types/trip-planner";
import type { UserProfile, UserSubscription } from "@/types/user";

const TRIP_PREFIX = "pintototrip.offline-trip.";
const PROFILE_PREFIX = "pintototrip.offline-profile.";

type OfflineProfileSnapshot = {
  subscription: UserSubscription;
  aiCreditsBalance: number;
  savedAt: number;
};

function tripKey(userId: string, tripId: string): string {
  return `${TRIP_PREFIX}${userId}.${tripId}`;
}

function profileKey(userId: string): string {
  return `${PROFILE_PREFIX}${userId}`;
}

function isTimestampLike(value: unknown): value is { toMillis: () => number } {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  );
}

/** JSON-safe clone: Firestore Timestamps → `{ __ts: millis }`. */
function serializeDeep(value: unknown): unknown {
  if (value == null) return value;
  if (isTimestampLike(value)) {
    return { __ts: value.toMillis() };
  }
  if (Array.isArray(value)) {
    return value.map(serializeDeep);
  }
  if (value instanceof Date) {
    return { __ts: value.getTime() };
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (entry === undefined) continue;
      out[key] = serializeDeep(entry);
    }
    return out;
  }
  return value;
}

function reviveDeep(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map(reviveDeep);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (
      typeof record.__ts === "number" &&
      Number.isFinite(record.__ts) &&
      Object.keys(record).length === 1
    ) {
      return Timestamp.fromMillis(record.__ts);
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) {
      out[key] = reviveDeep(entry);
    }
    return out;
  }
  return value;
}

export function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Persist a trip for offline open (device-only). */
export function saveOfflineTrip(userId: string, trip: TripPlannerDoc): void {
  if (typeof window === "undefined" || !userId || !trip?.id) return;
  try {
    window.localStorage.setItem(
      tripKey(userId, trip.id),
      JSON.stringify(serializeDeep(trip))
    );
  } catch {
    // Quota / private mode — ignore.
  }
}

export function loadOfflineTrip(
  userId: string,
  tripId: string
): TripPlannerDoc | null {
  if (typeof window === "undefined" || !userId || !tripId) return null;
  try {
    const raw = window.localStorage.getItem(tripKey(userId, tripId));
    if (!raw) return null;
    const revived = reviveDeep(JSON.parse(raw) as unknown);
    if (!revived || typeof revived !== "object") return null;
    const trip = revived as TripPlannerDoc;
    if (trip.id !== tripId) return null;
    return normalizeTripDoc(tripId, trip);
  } catch {
    return null;
  }
}

export function removeOfflineTrip(userId: string, tripId: string): void {
  if (typeof window === "undefined" || !userId || !tripId) return;
  try {
    window.localStorage.removeItem(tripKey(userId, tripId));
  } catch {
    // ignore
  }
}

/** Slim profile fields needed to open Trip Planner while offline. */
export function saveOfflineProfileSnapshot(
  userId: string,
  profile: UserProfile
): void {
  if (typeof window === "undefined" || !userId || !profile) return;
  const snapshot: OfflineProfileSnapshot = {
    subscription: profile.subscription,
    aiCreditsBalance: profile.aiCreditsBalance ?? 0,
    savedAt: Date.now(),
  };
  try {
    window.localStorage.setItem(profileKey(userId), JSON.stringify(snapshot));
  } catch {
    // ignore
  }
}

export function loadOfflineProfileSnapshot(
  userId: string
): OfflineProfileSnapshot | null {
  if (typeof window === "undefined" || !userId) return null;
  try {
    const raw = window.localStorage.getItem(profileKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfflineProfileSnapshot;
    if (!parsed?.subscription?.plan) return null;
    return parsed;
  } catch {
    return null;
  }
}
