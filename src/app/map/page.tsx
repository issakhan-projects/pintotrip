"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useUserProfile } from "@/hooks/useUserProfile";
import { logout } from "@/services/auth";
import { AppShell } from "@/features/app/AppShell";
import type { AppTab } from "@/features/app/BottomNav";

function parseTab(value: string | null): AppTab | undefined {
  if (
    value === "map" ||
    value === "places" ||
    value === "planner" ||
    value === "profile"
  ) {
    return value;
  }
  return undefined;
}

function MapPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = parseTab(searchParams.get("tab"));
  const { user, loading: authLoading } = useAuth();
  const {
    profile,
    loading: profileLoading,
    error: profileError,
  } = useUserProfile(user);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  if (authLoading || !user) {
    return (
      <main className="flex flex-1 items-center justify-center bg-background text-sm text-text-secondary">
        Loading…
      </main>
    );
  }

  if (profileLoading || !profile) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-background px-6">
        <div className="w-full max-w-xs">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-surface"
            role="progressbar"
            aria-valuetext={
              profileError ? "Profile setup failed" : "Setting up your account"
            }
          >
            <div
              className={`h-full rounded-full bg-primary ${
                profileError
                  ? "w-full opacity-40"
                  : "w-1/2 animate-pulse"
              }`}
            />
          </div>
        </div>
        <p className="text-sm text-text-secondary">
          {profileError ? "Couldn’t finish setup" : "Setting up your account…"}
        </p>
        {profileError ? (
          <div className="max-w-sm space-y-3 text-center">
            <p className="text-sm text-error" role="alert">
              {profileError}
            </p>
            <button
              type="button"
              className="btn-primary h-10 rounded-xl px-4 text-sm"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          </div>
        ) : null}
      </main>
    );
  }

  return (
    <AppShell
      user={user}
      onLogout={() => void handleLogout()}
      initialTab={initialTab}
    />
  );
}

export default function MapPage() {
  return (
    <Suspense
      fallback={
        <main className="flex flex-1 items-center justify-center bg-background text-sm text-text-secondary">
          Loading…
        </main>
      }
    >
      <MapPageInner />
    </Suspense>
  );
}
