"use client";

import { useEffect, useState } from "react";
import {
  REVIEW_PROMPT_DELAY_MS,
  dismissReviewPrompt,
  markReviewCompleted,
  recordReviewPromptSession,
  shouldOfferReviewPrompt,
} from "@/lib/reviews";
import { AnalyticsEvents } from "@/types/analytics";
import { useAnalytics } from "@/hooks/useAnalytics";

interface UseReviewPromptParams {
  hasLeftReview: boolean;
  savedItemCount: number;
  /** When true, delay opening so we don't stack over other sheets. */
  blocked: boolean;
  enabled?: boolean;
}

/**
 * After enough app use and some saved content, open the one-time review sheet.
 * Never re-offers after a successful submit (profile flag + local completed).
 */
export function useReviewPrompt({
  hasLeftReview,
  savedItemCount,
  blocked,
  enabled = true,
}: UseReviewPromptParams): {
  open: boolean;
  close: () => void;
  markSubmitted: () => void;
} {
  const { trackEvent } = useAnalytics();
  const [open, setOpen] = useState(false);
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    if (!enabled || hasLeftReview) {
      if (hasLeftReview) markReviewCompleted();
      setEligible(false);
      setOpen(false);
      return;
    }

    recordReviewPromptSession();
    setEligible(
      shouldOfferReviewPrompt({
        hasLeftReview,
        savedItemCount,
      })
    );
  }, [enabled, hasLeftReview, savedItemCount]);

  useEffect(() => {
    if (!eligible || blocked || open || hasLeftReview) return;

    const id = window.setTimeout(() => {
      if (
        shouldOfferReviewPrompt({
          hasLeftReview,
          savedItemCount,
        })
      ) {
        setOpen(true);
      }
    }, REVIEW_PROMPT_DELAY_MS);

    return () => window.clearTimeout(id);
  }, [eligible, blocked, open, hasLeftReview, savedItemCount]);

  function close() {
    if (open && !hasLeftReview) {
      dismissReviewPrompt();
      trackEvent(AnalyticsEvents.REVIEW_PROMPT_DISMISSED);
    }
    setOpen(false);
    setEligible(false);
  }

  function markSubmitted() {
    markReviewCompleted();
    setOpen(false);
    setEligible(false);
  }

  return { open, close, markSubmitted };
}
