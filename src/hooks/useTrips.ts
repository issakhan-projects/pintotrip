"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ensureTrips,
  subscribeTripsCache,
} from "@/services/trip-planner";
import { tripsKey, tripsStore } from "@/lib/firebase/data-cache";
import type { TripPlannerDoc } from "@/types/trip-planner";

export function useTrips(userId: string | undefined) {
  const [trips, setTrips] = useState<TripPlannerDoc[]>(() =>
    userId ? (tripsStore.get(tripsKey(userId))?.items ?? []) : []
  );
  const [loading, setLoading] = useState(() => {
    if (!userId) return false;
    return !tripsStore.has(tripsKey(userId));
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setTrips([]);
      setLoading(false);
      return;
    }

    const unsub = subscribeTripsCache(userId, (state) => {
      if (state) {
        setTrips(state.items);
        setLoading(false);
      }
    });

    const cached = tripsStore.get(tripsKey(userId));
    if (cached) {
      setTrips(cached.items);
      setLoading(false);
    } else {
      setLoading(true);
    }

    let cancelled = false;
    void ensureTrips(userId)
      .then((state) => {
        if (cancelled) return;
        setTrips(state.items);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load trips.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [userId]);

  /** Soft by default (0 reads when warm). Pass { hard: true } to force server. */
  const refresh = useCallback(
    async (options?: { hard?: boolean }) => {
      if (!userId) {
        setTrips([]);
        setLoading(false);
        return;
      }

      const hard = options?.hard === true;
      if (hard) setLoading(true);
      setError(null);
      try {
        setTrips((await ensureTrips(userId, { hard })).items);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load trips.");
      } finally {
        setLoading(false);
      }
    },
    [userId]
  );

  return { trips, loading, error, refresh };
}
