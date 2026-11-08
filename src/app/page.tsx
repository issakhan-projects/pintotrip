"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SplashScreen } from "@/components/SplashScreen";
import { useAuth } from "@/hooks/useAuth";
import { LandingPage } from "@/features/landing";

/**
 * Public landing. Signed-in users go straight to the main map.
 */
export default function Home() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) {
      router.replace("/map");
    }
  }, [loading, user, router]);

  if (loading || user) {
    return <SplashScreen />;
  }

  return <LandingPage />;
}
