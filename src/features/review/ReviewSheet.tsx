"use client";

import { useEffect, useState } from "react";
import { Button, TextInput } from "@/components/ui";
import { Coins, Star } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { submitReview } from "@/services/functions";
import { REVIEW_REWARD_AI_CREDITS } from "@/types/credits";
import type { ReviewRating } from "@/types/review";
import { AnalyticsEvents } from "@/types/analytics";
import { useAnalytics } from "@/hooks/useAnalytics";
import { cx } from "@/lib/utils";

interface ReviewSheetProps {
  open: boolean;
  onClose: () => void;
  /** When true, the user already used their one-time review. */
  alreadyReviewed?: boolean;
  onSubmitted?: (result: {
    creditsAwarded: number;
    aiCreditsBalance: number;
  }) => void;
}

const RATINGS: ReviewRating[] = [1, 2, 3, 4, 5];
const MIN_COMMENT_LENGTH = 25;
const MAX_COMMENT_LENGTH = 500;

export function ReviewSheet({
  open,
  onClose,
  alreadyReviewed = false,
  onSubmitted,
}: ReviewSheetProps) {
  const { trackEvent } = useAnalytics();
  const [rating, setRating] = useState<ReviewRating | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [awarded, setAwarded] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setRating(null);
    setComment("");
    setSubmitting(false);
    setError(null);
    setDone(false);
    setAwarded(null);
    if (!alreadyReviewed) {
      trackEvent(AnalyticsEvents.REVIEW_PROMPT_SHOWN);
    }
  }, [open, alreadyReviewed, trackEvent]);

  const trimmedComment = comment.trim();
  const commentValid =
    trimmedComment.length >= MIN_COMMENT_LENGTH &&
    trimmedComment.length <= MAX_COMMENT_LENGTH;
  const canSubmit = rating !== null && commentValid && !submitting;

  async function handleSubmit() {
    if (alreadyReviewed) {
      setError("You can only leave a review once.");
      return;
    }
    if (!rating) {
      setError("Please choose a star rating.");
      return;
    }
    if (trimmedComment.length < MIN_COMMENT_LENGTH) {
      setError(`Please write at least ${MIN_COMMENT_LENGTH} characters.`);
      return;
    }
    if (trimmedComment.length > MAX_COMMENT_LENGTH) {
      setError(`Please keep your feedback under ${MAX_COMMENT_LENGTH} characters.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await submitReview({
        rating,
        comment: trimmedComment,
      });
      setDone(true);
      setAwarded(result.creditsAwarded);
      trackEvent(AnalyticsEvents.REVIEW_SUBMITTED, {
        rating,
        credits_awarded: result.creditsAwarded,
      });
      onSubmitted?.(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not submit review.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        alreadyReviewed || done ? "Thank you" : "Enjoying PinToTrip?"
      }
      size="sm"
    >
      {alreadyReviewed ? (
        <div className="flex flex-col gap-3 pb-2">
          <p className="text-sm text-text-secondary">
            You already left a review. Each account can review once and
            receive the AI credit reward one time.
          </p>
          <Button onClick={onClose} className="btn-primary">
            Done
          </Button>
        </div>
      ) : done ? (
        <div className="flex flex-col gap-3 pb-2">
          <p className="text-sm text-text-secondary">
            Thanks for your feedback. We added{" "}
            <span className="font-semibold tabular-nums text-text">
              {awarded ?? REVIEW_REWARD_AI_CREDITS}
            </span>{" "}
            AI credits to your balance. This was a one-time reward.
          </p>
          <Button onClick={onClose} className="btn-primary">
            Done
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 pb-2">
          <div className="rounded-xl border border-primary/20 bg-primary-tint px-3 py-3">
            <div className="flex items-start gap-2">
              <Coins className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="text-sm text-text">
                Leave a one-time review and we&apos;ll add{" "}
                <span className="font-semibold tabular-nums">
                  {REVIEW_REWARD_AI_CREDITS}
                </span>{" "}
                AI credits to your account. You can only do this once.
              </p>
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-text">Your rating</p>
            <div className="flex items-center gap-1">
              {RATINGS.map((value) => {
                const active = rating !== null && value <= rating;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-label={`${value} star${value === 1 ? "" : "s"}`}
                    aria-pressed={rating === value}
                    onClick={() => setRating(value)}
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

          <div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-text">
                Anything we should know?
              </p>
              <p
                className={cx(
                  "text-xs tabular-nums",
                  trimmedComment.length > MAX_COMMENT_LENGTH
                    ? "text-error"
                    : trimmedComment.length > 0 &&
                        trimmedComment.length < MIN_COMMENT_LENGTH
                      ? "text-warning"
                      : "text-text-muted"
                )}
              >
                {trimmedComment.length}/{MAX_COMMENT_LENGTH}
              </p>
            </div>
            <TextInput
              placeholder="What you like, or what we could improve…"
              value={comment}
              maxLength={MAX_COMMENT_LENGTH}
              onChange={(e) => setComment(e.target.value)}
            />
            <p className="mt-1.5 text-xs text-text-muted">
              Minimum {MIN_COMMENT_LENGTH} characters.
            </p>
          </div>

          {error ? <p className="text-sm text-error">{error}</p> : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              onClick={onClose}
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
              Submit review
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
