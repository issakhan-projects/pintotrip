"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SplashScreen } from "@/components/SplashScreen";
import { useAuth } from "@/hooks/useAuth";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useT } from "@/i18n";
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
  const t = useT();
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
    return <SplashScreen />;
  }

  if (profileLoading || !profile) {
    return (
      <SplashScreen
        message={profileError ? undefined : t("app.setupAccount")}
        error={profileError ? profileError || t("app.setupFailed") : null}
        onRetry={
          profileError ? () => window.location.reload() : undefined
        }
        retryLabel={t("common.tryAgain")}
      />
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
    <Suspense fallback={<SplashScreen />}>
      <MapPageInner />
    </Suspense>
  );
}
