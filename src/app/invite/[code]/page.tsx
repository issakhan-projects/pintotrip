"use client";

import { Suspense, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { SplashScreen } from "@/components/SplashScreen";
import { useT } from "@/i18n";
import {
  buildRegisterCapturePath,
  normalizeReferralCode,
  storePendingReferral,
} from "@/lib/referral";

function InviteLandingInner() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const t = useT();

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

  return <SplashScreen message={t("common.openingInvite")} />;
}

/**
 * Invite landing: validate code, stash in localStorage, redirect to register.
 * Path: /invite/{code}?rid={referralId}
 */
export default function InviteLandingPage() {
  return (
    <Suspense fallback={<SplashScreen />}>
      <InviteLandingInner />
    </Suspense>
  );
}
