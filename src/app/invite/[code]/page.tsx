"use client";

import { Suspense, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  buildRegisterCapturePath,
  normalizeReferralCode,
  storePendingReferral,
} from "@/lib/referral";

function InviteLandingInner() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const searchParams = useSearchParams();

  useEffect(() => {
    const rawCode =
      typeof params.code === "string" ? decodeURIComponent(params.code) : "";
    const code = normalizeReferralCode(rawCode);
    const rid = searchParams.get("rid");

    if (!code) {
      router.replace("/login?tab=register");
      return;
    }

    storePendingReferral(code, rid);
    router.replace(buildRegisterCapturePath(code, rid));
  }, [params.code, searchParams, router]);

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center px-6 text-sm text-text-secondary">
      Opening your invite…
    </main>
  );
}

/**
 * Invite landing: validate code, stash in localStorage, redirect to register.
 * Path: /invite/{code}?rid={referralId}
 */
export default function InviteLandingPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh flex-1 items-center justify-center px-6 text-sm text-text-secondary">
          Opening your invite…
        </main>
      }
    >
      <InviteLandingInner />
    </Suspense>
  );
}
