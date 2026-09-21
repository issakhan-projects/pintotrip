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
import { loadOfflineTrip } from "@/lib/planner/offline-store";
import { normalizeTripDoc } from "@/lib/planner/normalize-trip";
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

function readInitialTrip(
  userId: string | undefined,
  tripId: string | undefined
): TripPlannerDoc | null {
  if (!tripId || !userId) return null;
  const raw =
    tripDetailStore.get(tripDetailKey(userId, tripId)) ??
    loadOfflineTrip(userId, tripId);
  return raw ? normalizeTripDoc(tripId, raw) : null;
}

export function useTrip(tripId: string | undefined, userId: string | undefined) {
  const [trip, setTrip] = useState<TripPlannerDoc | null>(() =>
    readInitialTrip(userId, tripId)
  );
  const [loading, setLoading] = useState(() => {
    if (!tripId || !userId) return false;
    return !readInitialTrip(userId, tripId);
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
        setTrip(normalizeTripDoc(tripId, next));
        setLoading(false);
        setError(null);
      }
    });

    const cached =
      tripDetailStore.get(tripDetailKey(userId, tripId)) ??
      loadOfflineTrip(userId, tripId);
    if (cached) {
      const normalized = normalizeTripDoc(tripId, cached);
      tripDetailStore.set(tripDetailKey(userId, tripId), normalized);
      setTrip(normalized);
      setLoading(false);
    } else {
      setLoading(true);
    }

    let cancelled = false;
    void getTrip(userId, tripId)
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          const offline = loadOfflineTrip(userId, tripId);
          if (offline) {
            setTrip(offline);
            setError(null);
            return;
          }
          setTrip(null);
          setError("Trip not found.");
        } else {
          setTrip(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const offline = loadOfflineTrip(userId, tripId);
        if (offline) {
          setTrip(offline);
          setError(null);
          return;
        }
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
          const offline = loadOfflineTrip(userId, tripId);
          if (offline) {
            setTrip(offline);
            return;
          }
          setTrip(null);
          setError("Trip not found.");
        } else {
          setTrip(data);
        }
      } catch (err) {
        const offline = loadOfflineTrip(userId, tripId);
        if (offline) {
          setTrip(offline);
          return;
        }
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
      // updateTrip patches shared cache + offline snapshot.
      await updateTrip(userId, tripId, input);
    },
    [tripId, userId]
  );

  return { trip, loading, error, refresh, patchTrip, setTrip };
}
