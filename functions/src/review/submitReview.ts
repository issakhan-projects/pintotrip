import { onCall, HttpsError } from "firebase-functions/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { requireAuth } from "../shared/auth";
import { DEFAULT_FUNCTIONS_REGION } from "../shared/config";
import { adminDb, initAdmin } from "../shared/admin";

/** One-time AI credit reward for submitting an in-app review. */
export const REVIEW_REWARD_AI_CREDITS = 100;

const MIN_COMMENT_LENGTH = 25;
const MAX_COMMENT_LENGTH = 500;

export type SubmitReviewRequest = {
  rating: number;
  comment: string;
};

export type SubmitReviewResult = {
  success: true;
  creditsAwarded: number;
  aiCreditsBalance: number;
};

function parseRequest(data: unknown): { rating: number; comment: string } {
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request body is required.");
  }

  const body = data as Record<string, unknown>;
  const rating = body.rating;

  if (
    typeof rating !== "number" ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5
  ) {
    throw new HttpsError(
      "invalid-argument",
      "rating must be an integer from 1 to 5."
    );
  }

  let comment = "";
  if (typeof body.comment !== "string") {
    throw new HttpsError("invalid-argument", "comment is required.");
  }
  comment = body.comment.trim();
  if (comment.length < MIN_COMMENT_LENGTH) {
    throw new HttpsError(
      "invalid-argument",
      `comment must be at least ${MIN_COMMENT_LENGTH} characters.`
    );
  }
  if (comment.length > MAX_COMMENT_LENGTH) {
    throw new HttpsError(
      "invalid-argument",
      `comment must be at most ${MAX_COMMENT_LENGTH} characters.`
    );
  }

  return { rating, comment };
}

function readBalance(data: FirebaseFirestore.DocumentData | undefined): number {
  const raw = data?.aiCreditsBalance;
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

type TxOutcome =
  | { ok: true; aiCreditsBalance: number }
  | { ok: false; reason: "already-exists" | "missing-profile" };

/**
 * Submit an in-app review once per user.
 * Writes reviews/{uid} (doc id = uid), marks users/{uid}.hasLeftReview,
 * and awards REVIEW_REWARD_AI_CREDITS exactly once.
 * A second call is rejected — no extra credits.
 */
export const submitReview = onCall(
  {
    region: DEFAULT_FUNCTIONS_REGION,
    invoker: "public",
    cors: true,
  },
  async (request): Promise<SubmitReviewResult> => {
    initAdmin();
    const userId = requireAuth(request);
    const { rating, comment } = parseRequest(request.data);

    const reviewRef = adminDb().doc(`reviews/${userId}`);
    const userRef = adminDb().doc(`users/${userId}`);

    let outcome: TxOutcome;
    try {
      outcome = await adminDb().runTransaction(async (tx) => {
        const reviewSnap = await tx.get(reviewRef);
        const userSnap = await tx.get(userRef);

        if (reviewSnap.exists || userSnap.data()?.hasLeftReview === true) {
          return { ok: false as const, reason: "already-exists" as const };
        }

        if (!userSnap.exists) {
          return { ok: false as const, reason: "missing-profile" as const };
        }

        const nextBalance =
          readBalance(userSnap.data()) + REVIEW_REWARD_AI_CREDITS;

        tx.create(reviewRef, {
          userId,
          rating,
          comment,
          creditsAwarded: REVIEW_REWARD_AI_CREDITS,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        tx.update(userRef, {
          hasLeftReview: true,
          aiCreditsBalance: nextBalance,
          updatedAt: FieldValue.serverTimestamp(),
        });

        return { ok: true as const, aiCreditsBalance: nextBalance };
      });
    } catch (err) {
      logger.error("submitReview failed", { userId, err });
      throw new HttpsError("internal", "Could not submit review.");
    }

    if (!outcome.ok) {
      if (outcome.reason === "already-exists") {
        throw new HttpsError(
          "already-exists",
          "You have already left a review."
        );
      }
      throw new HttpsError("failed-precondition", "User profile is missing.");
    }

    logger.info("Review submitted", {
      userId,
      rating,
      creditsAwarded: REVIEW_REWARD_AI_CREDITS,
      aiCreditsBalance: outcome.aiCreditsBalance,
    });

    return {
      success: true,
      creditsAwarded: REVIEW_REWARD_AI_CREDITS,
      aiCreditsBalance: outcome.aiCreditsBalance,
    };
  }
);
