"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { History, Lock, PlaneTakeoff, Plus, type LucideIcon } from "lucide-react";
import { Timestamp } from "firebase/firestore";
import type { User } from "firebase/auth";
import { useTrips } from "@/hooks/useTrips";
import { useLocations } from "@/hooks/useLocations";
import { useUserProfile } from "@/hooks/useUserProfile";
import { isProEntitled } from "@/features/profile/plans";
import { deleteTrip, updateTrip } from "@/services/trip-planner";
import { getTripReview } from "@/services/trip-reviews";
import type { TripPlannerDoc } from "@/types/trip-planner";
import { cx } from "@/lib/utils";
import { TripCard } from "./TripCard";
import { TripCalendar } from "./TripCalendar";
import { CreateTripSheet } from "./CreateTripSheet";
import { TripReviewModal } from "./TripReviewModal";
import {
  isPastTrip,
  needsCompletedStatus,
  needsTripReviewPrompt,
  startOfToday,
} from "./tripLifecycle";

interface TripPlannerPanelProps {
  user: User;
  /** When landing from a trip page (`/map?tab=planner`), refetch so the list isn't IndexedDB-stale. */
  resyncOnMount?: boolean;
}

type TripFilterTab = "active" | "past";

const TRIP_TABS: Array<{ id: TripFilterTab; label: string; icon: LucideIcon }> =
  [
    { id: "active", label: "Active", icon: PlaneTakeoff },
    { id: "past", label: "Past", icon: History },
  ];

function filterTrips(
  trips: TripPlannerDoc[],
  tab: TripFilterTab
): TripPlannerDoc[] {
  const today = startOfToday();
  if (tab === "past") return trips.filter((t) => isPastTrip(t, today));
  return trips.filter((t) => !isPastTrip(t, today));
}

function emptyCopy(tab: TripFilterTab): { title: string; body: string } {
  if (tab === "past") {
    return {
      title: "No past trips",
      body: "Completed and past trips will appear here after you travel.",
    };
  }
  return {
    title: "Where to next?",
    body: "No active trips yet. Create one and it will show up here.",
  };
}

/**
 * Trip Planner list — shown as the Planner tab in AppShell.
 * Pro plan only; free/plus see an upgrade gate.
 */
export function TripPlannerPanel({
  user,
  resyncOnMount = false,
}: TripPlannerPanelProps) {
  const router = useRouter();
  const { trips, loading, error, refresh } = useTrips(user.uid);
  const { locations } = useLocations(user.uid);
  const { profile } = useUserProfile(user);
  const isPro = isProEntitled(profile?.subscription);
  const [createOpen, setCreateOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [tab, setTab] = useState<TripFilterTab>("active");
  const [reviewTrip, setReviewTrip] = useState<TripPlannerDoc | null>(null);
  const completingIdsRef = useRef<Set<string>>(new Set());
  const reviewCheckedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!resyncOnMount) return;
    void refresh({ hard: true, silent: true });
  }, [resyncOnMount, refresh]);

  // Persist status=completed when a trip's end date has passed, then offer review.
  useEffect(() => {
    if (loading || !isPro || trips.length === 0) return;

    const today = startOfToday();
    const stale = trips.filter(
      (trip) =>
        needsCompletedStatus(trip, today) &&
        !completingIdsRef.current.has(trip.id)
    );
    if (stale.length === 0) return;

    for (const trip of stale) {
      completingIdsRef.current.add(trip.id);
    }

    void Promise.all(
      stale.map(async (trip) => {
        try {
          await updateTrip(user.uid, trip.id, { status: "completed" });
          return trip;
        } catch {
          completingIdsRef.current.delete(trip.id);
          return null;
        }
      })
    ).then((completed) => {
      const first = completed.find((trip): trip is TripPlannerDoc =>
        Boolean(trip)
      );
      if (first) {
        setReviewTrip((current) =>
          current ? current : { ...first, status: "completed" }
        );
      }
    });
  }, [loading, isPro, trips, user.uid]);

  // Also prompt for already-completed trips that still need a review.
  useEffect(() => {
    if (loading || !isPro || reviewTrip || trips.length === 0) return;

    const candidates = trips.filter(
      (trip) =>
        needsTripReviewPrompt(trip) && !reviewCheckedRef.current.has(trip.id)
    );
    if (candidates.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const trip of candidates) {
        reviewCheckedRef.current.add(trip.id);
        try {
          const existing = await getTripReview(user.uid, trip.id);
          if (cancelled) return;
          if (!existing) {
            setReviewTrip(trip);
            return;
          }
        } catch {
          // Ignore read errors; try next trip.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, isPro, trips, user.uid, reviewTrip]);

  const filteredTrips = filterTrips(trips, tab);

  async function handleDelete(tripId: string) {
    setDeletingId(tripId);
    try {
      // deleteTrip patches the shared trips cache — no list refetch.
      await deleteTrip(user.uid, tripId);
    } finally {
      setDeletingId(null);
    }
  }

  async function dismissReviewPrompt() {
    const trip = reviewTrip;
    setReviewTrip(null);
    if (!trip) return;
    try {
      await updateTrip(user.uid, trip.id, {
        reviewDismissedAt: Timestamp.now(),
      });
    } catch {
      // Keep UI closed even if dismiss write fails.
    }
  }

  if (!isPro) {
    return (
      <div className="flex h-full flex-col overflow-auto px-4 pb-28 pt-20">
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-tint text-primary">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            Trip Planner
          </h1>
          <p className="mt-2 max-w-sm text-sm text-text-secondary">
            Organize destinations into itineraries with Trip Planner. Available
            on the Pro plan.
          </p>
          <Button
            onClick={() => router.push("/pricing")}
            className="mt-6 !bg-primary hover:!bg-primary-hover !border-primary !text-white"
          >
            Upgrade to Pro
          </Button>
        </div>
      </div>
    );
  }

  const empty = emptyCopy(tab);

  return (
    <div className="flex h-full flex-col overflow-auto px-4 pb-28 pt-20">
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-text">
              Trip Planner
            </h1>
            {!loading && trips.length > 0 ? (
              <p className="mt-1 text-sm text-text-secondary">
                {trips.length} trip{trips.length === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
          <Button
            icon={Plus}
            onClick={() => setCreateOpen(true)}
            className="!bg-primary hover:!bg-primary-hover !border-primary !text-white"
          >
            Create trip
          </Button>
        </div>

        <div
          role="tablist"
          aria-label="Trip filters"
          className="mt-5 flex gap-1 rounded-full bg-surface p-1"
        >
          {TRIP_TABS.map((item) => {
            const selected = tab === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(item.id)}
                className={cx(
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-colors",
                  selected
                    ? "bg-surface-elevated text-text shadow-sm"
                    : "text-text-secondary hover:text-text"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {item.label}
              </button>
            );
          })}
        </div>

        {error ? (
          <p className="mt-6 rounded-xl bg-error-background px-4 py-3 text-sm text-error">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
          <div className="min-w-0 flex-1">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-[7.5rem] animate-pulse rounded-2xl bg-surface sm:h-[8.5rem]"
                  />
                ))}
              </div>
            ) : null}

            {!loading && filteredTrips.length === 0 ? (
              <div className="flex items-center gap-4 py-6 sm:gap-5 sm:py-10">
                <div className="relative h-28 w-[7.25rem] shrink-0 overflow-hidden sm:h-36 sm:w-[9.25rem]">
                  <Image
                    src="/trip-empty-globe.png"
                    alt=""
                    fill
                    className="object-contain object-left"
                    sizes="148px"
                    priority
                  />
                </div>
                <div className="min-w-0 text-left">
                  <h2 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
                    {empty.title}
                  </h2>
                  <p className="mt-1.5 max-w-sm text-sm text-text-secondary sm:text-[15px]">
                    {empty.body}
                  </p>
                  {tab !== "past" ? (
                    <Button
                      icon={Plus}
                      onClick={() => setCreateOpen(true)}
                      className="mt-4 !bg-primary hover:!bg-primary-hover !border-primary !text-white"
                    >
                      Create trip
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {!loading && filteredTrips.length > 0 ? (
              <div className="space-y-3">
                {filteredTrips.map((trip) => (
                  <TripCard
                    key={trip.id}
                    trip={trip}
                    locations={locations}
                    onOpen={() => router.push(`/trip-planner/${trip.id}`)}
                    onDelete={
                      deletingId === trip.id
                        ? undefined
                        : () => handleDelete(trip.id)
                    }
                  />
                ))}
              </div>
            ) : null}
          </div>

          <aside className="w-full shrink-0 lg:sticky lg:top-20 lg:w-[320px]">
            {loading ? (
              <div className="h-[380px] animate-pulse rounded-2xl bg-surface" />
            ) : (
              <TripCalendar
                trips={trips}
                onSelectTrip={(tripId) =>
                  router.push(`/trip-planner/${tripId}`)
                }
              />
            )}
          </aside>
        </div>
      </div>

      <CreateTripSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        userId={user.uid}
        profile={profile}
        locations={locations}
      />

      <TripReviewModal
        open={Boolean(reviewTrip)}
        userId={user.uid}
        tripId={reviewTrip?.id ?? ""}
        tripName={reviewTrip?.name ?? ""}
        onClose={() => void dismissReviewPrompt()}
        onSubmitted={() => setReviewTrip(null)}
      />
    </div>
  );
}
