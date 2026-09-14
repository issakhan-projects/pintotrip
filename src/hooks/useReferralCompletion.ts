"use client";

import { useEffect, useRef } from "react";
import {
  clearPendingReferral,
  clearReferralAwaitOnboarding,
  isReferralAwaitingOnboarding,
  markReferralRetry,
  peekPendingReferral,
  shouldRetryReferral,
} from "@/lib/referral";
import { completeReferral } from "@/services/functions";
import type { CompleteReferralOutcome } from "@/types/referral";

const TERMINAL_CLEAR: ReadonlySet<CompleteReferralOutcome> = new Set([
  "ok",
  "alreadyCompleted",
  "invalid_code",
  "self_referral",
  "not_pending",
  "referrer_missing",
]);

/**
 * After interactive onboarding is finished/skipped, try to complete a pending
 * referral. Also retries on later sessions when a previous attempt failed.
 */
export function useReferralCompletion(options: {
  enabled: boolean;
  /** True while travel-profile onboarding still needs to run. */
  needsOnboarding: boolean;
}): void {
  const { enabled, needsOnboarding } = options;
  const inFlight = useRef(false);
  const attemptedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || needsOnboarding || inFlight.current) return;

    const pending = peekPendingReferral();
    if (!pending) return;

    const awaiting = isReferralAwaitingOnboarding();
    const retry = shouldRetryReferral();
    if (!awaiting && !retry) return;

    const key = `${pending.code}:${pending.referralId ?? ""}`;
    if (attemptedKey.current === key) return;

    inFlight.current = true;
    attemptedKey.current = key;
    let cancelled = false;

    void (async () => {
      try {
        const result = await completeReferral({
          code: pending.code,
          referralId: pending.referralId ?? undefined,
        });

        if (cancelled) return;

        if (TERMINAL_CLEAR.has(result.outcome)) {
          clearPendingReferral();
        } else {
          markReferralRetry();
          clearReferralAwaitOnboarding();
          attemptedKey.current = null;
        }
      } catch (err) {
        console.error("[useReferralCompletion] complete failed", err);
        if (!cancelled) {
          markReferralRetry();
          clearReferralAwaitOnboarding();
          attemptedKey.current = null;
        }
      } finally {
        inFlight.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, needsOnboarding]);
}
