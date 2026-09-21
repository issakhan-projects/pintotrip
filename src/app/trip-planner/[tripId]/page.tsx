"use client";

import { Suspense, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { Lock, WifiOff } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useUserProfile } from "@/hooks/useUserProfile";
import { isProEntitled } from "@/features/profile/plans";
import { TripPlannerDetail } from "@/features/planner/TripPlannerDetail";
import {
  isBrowserOffline,
  loadOfflineProfileSnapshot,
  loadOfflineTrip,
} from "@/lib/planner/offline-store";

function TripPlannerDetailGate() {
  const router = useRouter();
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;
  const { user, loading } = useAuth();
  const { profile, loading: profileLoading } = useUserProfile(user);

  const offline = isBrowserOffline();
  const offlineSnapshot = user
    ? loadOfflineProfileSnapshot(user.uid)
    : null;
  const hasOfflineTrip = Boolean(
    user && tripId && loadOfflineTrip(user.uid, tripId)
  );
  const isPro =
    isProEntitled(profile?.subscription) ||
    isProEntitled(offlineSnapshot?.subscription);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <main className="flex flex-1 items-center justify-center bg-background text-sm text-text-secondary">
        Loading…
      </main>
    );
  }

  if (!tripId) {
    return (
      <main className="flex flex-1 items-center justify-center bg-background text-sm text-error">
        Missing trip id.
      </main>
    );
  }

  // Online: wait for profile. Offline: proceed once we have a device snapshot.
  if (profileLoading && !profile && !(offline && offlineSnapshot)) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 bg-background px-6 text-center text-sm text-text-secondary">
        {offline ? (
          <>
            <WifiOff className="h-5 w-5 text-text-muted" aria-hidden />
            <p>
              You’re offline. Open this trip once online to save it for later.
            </p>
          </>
        ) : (
          <p>Loading…</p>
        )}
      </main>
    );
  }

  if (!isPro) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-tint text-primary">
          <Lock className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-text">Trip Planner</h1>
          <p className="mt-2 max-w-sm text-sm text-text-secondary">
            Trip Planner is available on the Pro plan.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            onClick={() => router.push("/pricing")}
            className="!bg-primary hover:!bg-primary-hover !border-primary !text-white"
          >
            Upgrade to Pro
          </Button>
          <Button
            variant="secondary"
            onClick={() => router.replace("/map?tab=planner")}
          >
            Back
          </Button>
        </div>
      </main>
    );
  }

  if (offline && !hasOfflineTrip && !profile) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 bg-background px-6 text-center text-sm text-text-secondary">
        <WifiOff className="h-5 w-5 text-text-muted" aria-hidden />
        <p>You’re offline and this trip isn’t saved on this device yet.</p>
        <Button
          variant="secondary"
          className="mt-2"
          onClick={() => router.replace("/map?tab=planner")}
        >
          Back
        </Button>
      </main>
    );
  }

  return <TripPlannerDetail user={user} tripId={tripId} />;
}

export default function TripPlannerTripPage() {
  return (
    <Suspense
      fallback={
        <main className="flex flex-1 items-center justify-center bg-background text-sm text-text-secondary">
          Loading…
        </main>
      }
    >
      <TripPlannerDetailGate />
    </Suspense>
  );
}
