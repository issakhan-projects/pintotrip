"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ensureLocations,
  createUserLocation,
  updateUserLocation,
  updateLocationCityGooglePlaceId,
  deleteUserLocation,
  subscribeLocationsCache,
  getLocationsCache,
} from "@/services/locations";
import {
  getCachedLocation,
  upsertLocationInCache,
  type SavedLocation,
} from "@/lib/firebase/data-cache";
import { initRealtimeVisibilityPause } from "@/lib/firebase/realtime-sync";
import type {
  UserLocationCreateInput,
  UserLocationUpdateInput,
} from "@/types/location";
import type { CityPlaceIdBackfill } from "@/lib/maps";

export type { SavedLocation };

export function useLocations(userId: string | undefined) {
  const [locations, setLocations] = useState<SavedLocation[]>(() =>
    userId ? (getLocationsCache(userId)?.items ?? []) : []
  );
  const [loading, setLoading] = useState(() => {
    if (!userId) return false;
    const cached = getLocationsCache(userId);
    return !cached || cached.items.length === 0;
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initRealtimeVisibilityPause();
  }, []);

  useEffect(() => {
    if (!userId) {
      setLocations([]);
      setLoading(false);
      return;
    }

    const unsub = subscribeLocationsCache(userId, (state) => {
      if (state) {
        setLocations(state.items);
        setLoading(false);
      }
    });

    const cached = getLocationsCache(userId);
    if (cached && cached.items.length > 0) {
      setLocations(cached.items);
      setLoading(false);
    } else {
      setLoading(true);
    }

    let cancelled = false;
    void ensureLocations(userId)
      .then((state) => {
        if (cancelled) return;
        setLocations(state.items);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load places."
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [userId]);

  /** Soft refresh: 0 reads when memory/IndexedDB already warm. */
  const refresh = useCallback(
    async (options?: { hard?: boolean }) => {
      if (!userId) {
        setLocations([]);
        setLoading(false);
        return;
      }

      const hard = options?.hard === true;
      if (hard) setLoading(true);
      setError(null);
      try {
        const state = await ensureLocations(userId, { hard });
        setLocations(state.items);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load places."
        );
      } finally {
        setLoading(false);
      }
    },
    [userId]
  );

  const addLocation = useCallback(
    async (input: UserLocationCreateInput) => {
      if (!userId) throw new Error("Not signed in.");
      // createUserLocation patches the shared cache — no collection refetch.
      return createUserLocation(userId, input);
    },
    [userId]
  );

  const patchLocation = useCallback(
    async (locationId: string, input: UserLocationUpdateInput) => {
      if (!userId) throw new Error("Not signed in.");
      await updateUserLocation(userId, locationId, input);
    },
    [userId]
  );

  /** Persist resolved locality Place IDs onto location docs (no full reload). */
  const backfillCityGooglePlaceIds = useCallback(
    async (batch: CityPlaceIdBackfill[]) => {
      if (!userId || batch.length === 0) return;

      const writes: Array<Promise<void>> = [];
      const byId = new Map<string, string>();

      for (const item of batch) {
        for (const locationId of item.locationIds) {
          byId.set(locationId, item.googlePlaceId);
          writes.push(
            updateLocationCityGooglePlaceId(
              userId,
              locationId,
              item.googlePlaceId
            )
          );
        }
      }

      await Promise.all(writes);

      // Cache already patched per write; mirror into local state via store.
      for (const [locationId, placeId] of byId) {
        const cached = getCachedLocation(userId, locationId);
        if (!cached || cached.city.googlePlaceId === placeId) continue;
        upsertLocationInCache(userId, {
          ...cached,
          city: { ...cached.city, googlePlaceId: placeId },
        });
      }
    },
    [userId]
  );

  const removeLocation = useCallback(
    async (locationId: string) => {
      if (!userId) throw new Error("Not signed in.");
      await deleteUserLocation(userId, locationId);
    },
    [userId]
  );

  return {
    locations,
    loading,
    error,
    refresh,
    addLocation,
    patchLocation,
    backfillCityGooglePlaceIds,
    removeLocation,
  };
}
