"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getTrip,
  updateTrip,
  subscribeTripDetailCache,
} from "@/services/trip-planner";
import {
  tripDetailKey,
  tripDetailStore,
} from "@/lib/firebase/data-cache";
import type {
  TripPlannerDoc,
  TripPlannerUpdateInput,
} from "@/types/trip-planner";

type RefreshOptions = {
  /** When true, keep current UI mounted (no full-page loading flash). */
  silent?: boolean;
  /** Force a server read. Soft (default) uses memory / IndexedDB only when warm. */
  hard?: boolean;
};

export function useTrip(tripId: string | undefined, userId: string | undefined) {
  const [trip, setTrip] = useState<TripPlannerDoc | null>(() => {
    if (!tripId || !userId) return null;
    return tripDetailStore.get(tripDetailKey(userId, tripId)) ?? null;
  });
  const [loading, setLoading] = useState(() => {
    if (!tripId || !userId) return false;
    return !tripDetailStore.has(tripDetailKey(userId, tripId));
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tripId || !userId) {
      setTrip(null);
      setLoading(false);
      return;
    }

    const unsub = subscribeTripDetailCache(userId, tripId, (next) => {
      if (next) {
        setTrip(next);
        setLoading(false);
        setError(null);
      }
    });

    const cached = tripDetailStore.get(tripDetailKey(userId, tripId));
    if (cached) {
      setTrip(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    let cancelled = false;
    void getTrip(userId, tripId)
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setTrip(null);
          setError("Trip not found.");
        } else {
          setTrip(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load trip.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [tripId, userId]);

  const refresh = useCallback(
    async (options?: RefreshOptions) => {
      if (!tripId || !userId) {
        setTrip(null);
        setLoading(false);
        return;
      }

      const silent = options?.silent === true;
      const hard = options?.hard === true;
      if (!silent && hard) {
        setLoading(true);
      }
      setError(null);
      try {
        const data = await getTrip(userId, tripId, { hard });
        if (!data) {
          setTrip(null);
          setError("Trip not found.");
        } else {
          setTrip(data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load trip.");
        if (!silent && hard) {
          setTrip(null);
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [tripId, userId]
  );

  const patchTrip = useCallback(
    async (input: TripPlannerUpdateInput) => {
      if (!tripId || !userId) throw new Error("Missing trip.");
      // updateTrip patches shared cache — no document refetch.
      await updateTrip(userId, tripId, input);
    },
    [tripId, userId]
  );

  return { trip, loading, error, refresh, patchTrip, setTrip };
}
