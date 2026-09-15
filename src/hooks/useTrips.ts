"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ensureTrips,
  subscribeTripsCache,
} from "@/services/trip-planner";
import { tripsKey, tripsStore } from "@/lib/firebase/data-cache";
import type { TripPlannerDoc } from "@/types/trip-planner";

function readCachedTrips(userId: string): TripPlannerDoc[] {
  return tripsStore.get(tripsKey(userId))?.items ?? [];
}

export function useTrips(userId: string | undefined) {
  const [trips, setTrips] = useState<TripPlannerDoc[]>(() =>
    userId ? readCachedTrips(userId) : []
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

    const pullFromStore = () => {
      const next = tripsStore.get(tripsKey(userId));
      if (next) setTrips(next.items);
    };

    const onPageShow = (event: PageTransitionEvent) => {
      pullFromStore();
      // Mobile Safari / prod restores a frozen heap via bfcache — memory is stale.
      void ensureTrips(userId, { hard: event.persisted }).then((state) => {
        if (!cancelled) {
          setTrips(state.items);
          setError(null);
        }
      });
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      pullFromStore();
      void ensureTrips(userId).then((state) => {
        if (!cancelled) setTrips(state.items);
      });
    };

    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      unsub();
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId]);

  /** Soft by default (0 reads when warm). Pass { hard: true } to force server. */
  const refresh = useCallback(
    async (options?: { hard?: boolean; silent?: boolean }) => {
      if (!userId) {
        setTrips([]);
        setLoading(false);
        return;
      }

      const hard = options?.hard === true;
      const silent = options?.silent === true;
      if (hard && !silent) setLoading(true);
      setError(null);
      try {
        setTrips((await ensureTrips(userId, { hard })).items);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load trips.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [userId]
  );

  return { trips, loading, error, refresh };
}
