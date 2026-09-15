import { Timestamp } from "firebase/firestore";
import { createMemoryStore } from "@/lib/firebase/memory-store";
import { createInFlightMap } from "@/lib/firebase/in-flight";
import type { UserLocation } from "@/types/location";
import type { FavoriteCity } from "@/types/favorite-city";
import type { TripPlannerDoc } from "@/types/trip-planner";
import type { UserProfile } from "@/types/user";
import type {
  TravelIntelligenceCity,
  TravelIntelligenceCountry,
  TravelIntelligenceDaily,
  TravelIntelligencePlace,
} from "@/types/travel-intelligence";

export type SavedLocation = UserLocation & { id: string };
export type SavedFavoriteCity = FavoriteCity & { id: string };

export type LocationsCacheState = {
  items: SavedLocation[];
  /** True once we've exhausted pagination (or loaded a complete cache set). */
  complete: boolean;
  hasMore: boolean;
  /** Opaque cursor for startAfter — stored as last doc id + createdAt millis. */
  cursor: { id: string; createdAtMillis: number } | null;
};

export type FavoriteCitiesCacheState = {
  items: SavedFavoriteCity[];
  complete: boolean;
  hasMore: boolean;
  cursor: { id: string } | null;
};

export type TripsCacheState = {
  items: TripPlannerDoc[];
  complete: boolean;
  hasMore: boolean;
  cursor: { id: string; createdAtMillis: number } | null;
};

export const locationsStore = createMemoryStore<LocationsCacheState>();
export const favoriteCitiesStore =
  createMemoryStore<FavoriteCitiesCacheState>();
export const tripsStore = createMemoryStore<TripsCacheState>();
export const tripDetailStore = createMemoryStore<TripPlannerDoc>();
export const userProfileStore = createMemoryStore<UserProfile | null>();

export const travelIntelPlacesStore = createMemoryStore<
  Array<TravelIntelligencePlace & { id: string }>
>();
export const travelIntelCitiesStore = createMemoryStore<
  Array<TravelIntelligenceCity & { id: string }>
>();
export const travelIntelCountriesStore = createMemoryStore<
  Array<TravelIntelligenceCountry & { id: string }>
>();
export const travelIntelDailyStore = createMemoryStore<
  Array<TravelIntelligenceDaily & { id: string }>
>();

export const locationsInFlight = createInFlightMap<LocationsCacheState>();
export const favoriteCitiesInFlight =
  createInFlightMap<FavoriteCitiesCacheState>();
export const tripsInFlight = createInFlightMap<TripsCacheState>();
export const tripDetailInFlight = createInFlightMap<TripPlannerDoc | null>();
export const userProfileInFlight = createInFlightMap<UserProfile | null>();
export const travelIntelInFlight = createInFlightMap<unknown>();

export function locationsKey(userId: string): string {
  return userId;
}

export function favoriteCitiesKey(userId: string): string {
  return userId;
}

export function tripsKey(userId: string): string {
  return userId;
}

export function tripDetailKey(userId: string, tripId: string): string {
  return `${userId}:${tripId}`;
}

export function userProfileKey(userId: string): string {
  return userId;
}

export function approxNowTimestamp(): Timestamp {
  return Timestamp.now();
}

/** Upsert a location into the per-user list cache (patch-in-place). */
export function upsertLocationInCache(
  userId: string,
  location: SavedLocation
): void {
  const key = locationsKey(userId);
  locationsStore.patch(key, (prev) => {
    const items = prev?.items ? [...prev.items] : [];
    const idx = items.findIndex((l) => l.id === location.id);
    if (idx >= 0) {
      items[idx] = { ...items[idx], ...location };
    } else {
      items.unshift(location);
    }
    return {
      items,
      complete: prev?.complete ?? false,
      hasMore: prev?.hasMore ?? false,
      cursor: prev?.cursor ?? null,
    };
  });
}

export function patchLocationInCache(
  userId: string,
  locationId: string,
  patch: Partial<UserLocation>
): void {
  const key = locationsKey(userId);
  const prev = locationsStore.get(key);
  if (!prev) return;
  const items = prev.items.map((l) =>
    l.id === locationId ? { ...l, ...patch } : l
  );
  locationsStore.set(key, { ...prev, items });
}

export function removeLocationFromCache(
  userId: string,
  locationId: string
): void {
  const key = locationsKey(userId);
  const prev = locationsStore.get(key);
  if (!prev) return;
  locationsStore.set(key, {
    ...prev,
    items: prev.items.filter((l) => l.id !== locationId),
  });
}

export function getCachedLocation(
  userId: string,
  locationId: string
): SavedLocation | undefined {
  return locationsStore
    .get(locationsKey(userId))
    ?.items.find((l) => l.id === locationId);
}

export function upsertFavoriteInCache(
  userId: string,
  city: SavedFavoriteCity
): void {
  const key = favoriteCitiesKey(userId);
  favoriteCitiesStore.patch(key, (prev) => {
    const items = prev?.items ? [...prev.items] : [];
    const idx = items.findIndex(
      (c) => c.id === city.id || c.cityId === city.cityId
    );
    if (idx >= 0) {
      items[idx] = { ...items[idx], ...city };
    } else {
      items.unshift(city);
    }
    return {
      items,
      complete: prev?.complete ?? true,
      hasMore: prev?.hasMore ?? false,
      cursor: prev?.cursor ?? null,
    };
  });
}

export function removeFavoriteFromCache(
  userId: string,
  cityId: string
): void {
  const key = favoriteCitiesKey(userId);
  const prev = favoriteCitiesStore.get(key);
  if (!prev) return;
  favoriteCitiesStore.set(key, {
    ...prev,
    items: prev.items.filter((c) => c.id !== cityId && c.cityId !== cityId),
  });
}

export function upsertTripInListCache(
  userId: string,
  trip: TripPlannerDoc
): void {
  const key = tripsKey(userId);
  const prev = tripsStore.get(key);
  // Never seed the list from a detail read — otherwise ensureTrips treats a
  // single trip as a warm cache and the panel only shows 1 trip until reload.
  if (!prev) return;

  const items = [...prev.items];
  const idx = items.findIndex((t) => t.id === trip.id);
  if (idx >= 0) {
    items[idx] = { ...items[idx], ...trip };
  } else {
    items.unshift(trip);
  }
  tripsStore.set(key, {
    ...prev,
    items,
  });
}

export function removeTripFromListCache(
  userId: string,
  tripId: string
): void {
  const key = tripsKey(userId);
  const prev = tripsStore.get(key);
  if (!prev) return;
  tripsStore.set(key, {
    ...prev,
    items: prev.items.filter((t) => t.id !== tripId),
  });
  tripDetailStore.remove(tripDetailKey(userId, tripId));
}

export function patchTripInCache(
  userId: string,
  tripId: string,
  patch: Partial<TripPlannerDoc>
): TripPlannerDoc | null {
  const detailKey = tripDetailKey(userId, tripId);
  const existing =
    tripDetailStore.get(detailKey) ??
    tripsStore.get(tripsKey(userId))?.items.find((t) => t.id === tripId) ??
    null;
  if (!existing) return null;
  const next = { ...existing, ...patch, id: tripId };
  tripDetailStore.set(detailKey, next);
  upsertTripInListCache(userId, next);
  return next;
}

export function setUserProfileInCache(
  userId: string,
  profile: UserProfile | null
): void {
  userProfileStore.set(userProfileKey(userId), profile);
}

export function patchUserProfileInCache(
  userId: string,
  patch: Partial<UserProfile>
): UserProfile | null {
  const key = userProfileKey(userId);
  const prev = userProfileStore.get(key);
  if (!prev) return null;
  const next = { ...prev, ...patch };
  userProfileStore.set(key, next);
  return next;
}

/**
 * Drop all client-side domain caches (memory only — IndexedDB is managed by
 * Firestore). Call on logout so the next login cannot paint stale profile /
 * trips / places from the previous session.
 */
export function clearClientDataCaches(): void {
  locationsStore.clearAll();
  favoriteCitiesStore.clearAll();
  tripsStore.clearAll();
  tripDetailStore.clearAll();
  userProfileStore.clearAll();
  travelIntelPlacesStore.clearAll();
  travelIntelCitiesStore.clearAll();
  travelIntelCountriesStore.clearAll();
  travelIntelDailyStore.clearAll();

  locationsInFlight.clear();
  favoriteCitiesInFlight.clear();
  tripsInFlight.clear();
  tripDetailInFlight.clear();
  userProfileInFlight.clear();
  travelIntelInFlight.clear();
}
