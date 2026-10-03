"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Star, X } from "lucide-react";
import { Button, TextInput } from "@/components/ui";
import { lockBodyScroll } from "@/lib/bodyScrollLock";
import { createTripReview } from "@/services/trip-reviews";
import { AnalyticsEvents } from "@/types/analytics";
import type {
  TripReviewRating,
  TripReviewRecommend,
} from "@/types/trip-review";
import { useAnalytics } from "@/hooks/useAnalytics";
import { cx } from "@/lib/utils";

const RATINGS: TripReviewRating[] = [1, 2, 3, 4, 5];
const MIN_IMPROVE_LENGTH = 10;
const MAX_TEXT_LENGTH = 1000;

const RECOMMEND_OPTIONS: Array<{
  value: TripReviewRecommend;
  label: string;
}> = [
  { value: "yes", label: "Yes" },
  { value: "maybe", label: "Maybe" },
  { value: "no", label: "No" },
];

export interface TripReviewModalProps {
  open: boolean;
  userId: string;
  tripId: string;
  tripName: string;
  onClose: () => void;
  onSubmitted?: () => void;
}

function StarRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TripReviewRating | null;
  onChange: (rating: TripReviewRating) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-text">{label}</p>
      <div className="flex items-center gap-1">
        {RATINGS.map((rating) => {
          const active = value !== null && rating <= value;
          return (
            <button
              key={rating}
              type="button"
              aria-label={`${rating} star${rating === 1 ? "" : "s"}`}
              aria-pressed={value === rating}
              onClick={() => onChange(rating)}
              className="rounded-md p-1.5 transition-colors hover:bg-surface"
            >
              <Star
                className={cx(
                  "h-7 w-7",
                  active
                    ? "fill-warning text-warning"
                    : "fill-transparent text-text-muted"
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Post-trip feedback modal — shown after a trip ends and status becomes completed.
 */
export function TripReviewModal({
  open,
  userId,
  tripId,
  tripName,
  onClose,
  onSubmitted,
}: TripReviewModalProps) {
  const titleId = useId();
  const { trackEvent } = useAnalytics();
  const [mounted, setMounted] = useState(false);
  const [backdropArmed, setBackdropArmed] = useState(false);
  const [planningRating, setPlanningRating] = useState<TripReviewRating | null>(
    null
  );
  const [itineraryRating, setItineraryRating] =
    useState<TripReviewRating | null>(null);
  const [liked, setLiked] = useState("");
  const [improve, setImprove] = useState("");
  const [recommend, setRecommend] = useState<TripReviewRecommend | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setBackdropArmed(false);
      return;
    }

    setPlanningRating(null);
    setItineraryRating(null);
    setLiked("");
    setImprove("");
    setRecommend(null);
    setSubmitting(false);
    setError(null);
    setDone(false);
    trackEvent(AnalyticsEvents.TRIP_REVIEW_PROMPT_SHOWN, { trip_id: tripId });

    const armId = window.setTimeout(() => setBackdropArmed(true), 120);
    const unlock = lockBodyScroll();

    return () => {
      window.clearTimeout(armId);
      unlock();
    };
  }, [open, tripId, trackEvent]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  const trimmedImprove = improve.trim();
  const improveValid =
    trimmedImprove.length >= MIN_IMPROVE_LENGTH &&
    trimmedImprove.length <= MAX_TEXT_LENGTH;
  const canSubmit =
    planningRating !== null && improveValid && !submitting && !done;

  async function handleSubmit() {
    if (!planningRating) {
      setError("Please rate how planning went.");
      return;
    }
    if (trimmedImprove.length < MIN_IMPROVE_LENGTH) {
      setError(`Please write at least ${MIN_IMPROVE_LENGTH} characters.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createTripReview(userId, {
        tripId,
        tripName,
        planningRating,
        ...(itineraryRating ? { itineraryRating } : {}),
        ...(liked.trim() ? { liked: liked.trim() } : {}),
        improve: trimmedImprove,
        ...(recommend ? { recommend } : {}),
      });
      setDone(true);
      trackEvent(AnalyticsEvents.TRIP_REVIEW_SUBMITTED, {
        trip_id: tripId,
        planning_rating: planningRating,
        itinerary_rating: itineraryRating,
        recommend,
      });
      onSubmitted?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not submit your review."
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleDismiss() {
    if (submitting) return;
    if (!done) {
      trackEvent(AnalyticsEvents.TRIP_REVIEW_PROMPT_DISMISSED, {
        trip_id: tripId,
      });
    }
    onClose();
  }

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Dismiss"
        disabled={submitting}
        className="absolute inset-0 bg-text/40"
        onClick={() => {
          if (backdropArmed && !submitting) handleDismiss();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[min(90vh,40rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-text">
              {done ? "Thank you" : "How was your trip planning?"}
            </h2>
            {!done ? (
              <p className="mt-0.5 truncate text-sm text-text-secondary">
                {tripName}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            disabled={submitting}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-text-secondary hover:bg-surface disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {done ? (
            <p className="text-sm text-text-secondary">
              Thanks for the feedback — it helps us improve Trip Planner for
              your next adventure.
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              <p className="text-sm text-text-secondary">
                Your trip has ended. Tell us how planning went so we can make
                the next one better.
              </p>

              <StarRow
                label="How was the planning experience?"
                value={planningRating}
                onChange={setPlanningRating}
              />

              <StarRow
                label="How useful was the itinerary?"
                value={itineraryRating}
                onChange={setItineraryRating}
              />

              <div>
                <label
                  htmlFor="trip-review-liked"
                  className="mb-2 block text-sm font-medium text-text"
                >
                  What went well?{" "}
                  <span className="font-normal text-text-muted">(optional)</span>
                </label>
                <TextInput
                  id="trip-review-liked"
                  value={liked}
                  maxLength={MAX_TEXT_LENGTH}
                  placeholder="Places, routes, tips that helped…"
                  onChange={(e) => setLiked(e.target.value)}
                />
              </div>

              <div>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <label
                    htmlFor="trip-review-improve"
                    className="text-sm font-medium text-text"
                  >
                    What should we improve?
                  </label>
                  <span
                    className={cx(
                      "text-xs tabular-nums",
                      trimmedImprove.length > MAX_TEXT_LENGTH
                        ? "text-error"
                        : trimmedImprove.length > 0 &&
                            trimmedImprove.length < MIN_IMPROVE_LENGTH
                          ? "text-warning"
                          : "text-text-muted"
                    )}
                  >
                    {trimmedImprove.length}/{MAX_TEXT_LENGTH}
                  </span>
                </div>
                <textarea
                  id="trip-review-improve"
                  value={improve}
                  maxLength={MAX_TEXT_LENGTH}
                  rows={4}
                  placeholder="Missing features, confusing steps, bad suggestions…"
                  onChange={(e) => setImprove(e.target.value)}
                  className={cx(
                    "block w-full resize-y rounded-xl border border-border bg-surface-elevated",
                    "px-3 py-2.5 text-sm text-text placeholder:text-text-muted",
                    "shadow-sm outline-none transition-colors",
                    "focus:border-primary focus:ring-2 focus:ring-primary/20"
                  )}
                />
                <p className="mt-1.5 text-xs text-text-muted">
                  Minimum {MIN_IMPROVE_LENGTH} characters.
                </p>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-text">
                  Would you use Trip Planner again?
                </p>
                <div className="flex flex-wrap gap-2">
                  {RECOMMEND_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setRecommend(option.value)}
                      className={cx(
                        "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                        recommend === option.value
                          ? "border-primary bg-primary-tint text-primary"
                          : "border-border bg-surface text-text-secondary hover:border-primary/30 hover:text-text"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {error ? <p className="text-sm text-error">{error}</p> : null}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end">
          {done ? (
            <Button onClick={handleDismiss} className="btn-primary">
              Done
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={handleDismiss}
                disabled={submitting}
                className="!border-border !bg-surface !text-text"
              >
                Not now
              </Button>
              <Button
                onClick={() => void handleSubmit()}
                loading={submitting}
                disabled={!canSubmit}
                className="btn-primary"
              >
                Submit feedback
              </Button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
