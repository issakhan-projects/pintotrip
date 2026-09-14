"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
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
    return (
      <main className="flex flex-1 items-center justify-center text-sm text-text-secondary">
        Loading…
      </main>
    );
  }

  return <LandingPage />;
}
