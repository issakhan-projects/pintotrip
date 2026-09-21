"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ensureFavoriteCities,
  findFavoriteCity,
  removeFavoriteCity,
  resolveFavoriteCityId,
  subscribeFavoriteCitiesCache,
  upsertFavoriteCity,
} from "@/services/favorite-cities";
import {
  favoriteCitiesStore,
  favoriteCitiesKey,
  type SavedFavoriteCity,
} from "@/lib/firebase/data-cache";
import type { FavoriteCityCreateInput } from "@/types/favorite-city";
import type { LocationStatus } from "@/types/location";

export type { SavedFavoriteCity };

export function useFavoriteCities(userId: string | undefined) {
  const [favoriteCities, setFavoriteCities] = useState<SavedFavoriteCity[]>(
    () =>
      userId
        ? (favoriteCitiesStore.get(favoriteCitiesKey(userId))?.items ?? [])
        : []
  );
  const [loading, setLoading] = useState(() => {
    if (!userId) return false;
    return !favoriteCitiesStore.has(favoriteCitiesKey(userId));
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setFavoriteCities([]);
      setLoading(false);
      return;
    }

    const unsub = subscribeFavoriteCitiesCache(userId, (state) => {
      if (state) {
        setFavoriteCities(state.items);
        setLoading(false);
      }
    });

    const cached = favoriteCitiesStore.get(favoriteCitiesKey(userId));
    if (cached) {
      setFavoriteCities(cached.items);
      setLoading(false);
    } else {
      setLoading(true);
    }

    let cancelled = false;
    void ensureFavoriteCities(userId)
      .then((state) => {
        if (cancelled) return;
        setFavoriteCities(state.items);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load favorite cities."
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

  const refresh = useCallback(
    async (options?: { hard?: boolean }) => {
      if (!userId) return;
      const hard = options?.hard === true;
      setLoading(true);
      setError(null);
      try {
        const state = await ensureFavoriteCities(userId, { hard });
        setFavoriteCities(state.items);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load favorite cities."
        );
      } finally {
        setLoading(false);
      }
    },
    [userId]
  );

  const isFavorite = useCallback(
    (
      cityName: string,
      country: string,
      coords?: { lat: number; lon: number }
    ) => {
      return Boolean(
        findFavoriteCity(favoriteCities, {
          cityName,
          country,
          lat: coords?.lat,
          lon: coords?.lon,
        })
      );
    },
    [favoriteCities]
  );

  const addFavorite = useCallback(
    async (input: {
      cityName: string;
      country: string;
      lat: number;
      lon: number;
      status?: LocationStatus;
    }) => {
      if (!userId) throw new Error("Not signed in.");
      const cityId = await resolveFavoriteCityId(input);
      if (!cityId) {
        throw new Error(
          "Could not resolve English city/country ids for this place. Try again."
        );
      }
      const payload: FavoriteCityCreateInput = {
        cityId,
        cityName: input.cityName.trim(),
        country: input.country.trim(),
        lat: input.lat,
        lon: input.lon,
        status: input.status ?? "planned",
      };
      // upsert patches shared cache — no collection refetch.
      await upsertFavoriteCity(userId, payload);
      return cityId;
    },
    [userId]
  );

  const removeFavorite = useCallback(
    async (
      cityName: string,
      country: string,
      coords?: { lat: number; lon: number }
    ) => {
      if (!userId) throw new Error("Not signed in.");
      const existing = findFavoriteCity(favoriteCities, {
        cityName,
        country,
        lat: coords?.lat,
        lon: coords?.lon,
      });
      const cityId =
        existing?.cityId ||
        existing?.id ||
        (await resolveFavoriteCityId({
          cityName,
          country,
          lat: coords?.lat ?? existing?.lat ?? 0,
          lon: coords?.lon ?? existing?.lon ?? 0,
        }));
      if (!cityId) {
        throw new Error("Could not find this saved city to remove.");
      }
      await removeFavoriteCity(userId, cityId);
    },
    [userId, favoriteCities]
  );

  const toggleFavorite = useCallback(
    async (input: {
      cityName: string;
      country: string;
      lat: number;
      lon: number;
      status?: LocationStatus;
    }) => {
      if (
        isFavorite(input.cityName, input.country, {
          lat: input.lat,
          lon: input.lon,
        })
      ) {
        await removeFavorite(input.cityName, input.country, {
          lat: input.lat,
          lon: input.lon,
        });
        return false;
      }
      await addFavorite(input);
      return true;
    },
    [isFavorite, addFavorite, removeFavorite]
  );

  return {
    favoriteCities,
    loading,
    error,
    refresh,
    isFavorite,
    addFavorite,
    removeFavorite,
    toggleFavorite,
  };
}
