import type { Timestamp } from "firebase/firestore";
import { REVIEW_REWARD_AI_CREDITS } from "./credits";

export { REVIEW_REWARD_AI_CREDITS };

export type ReviewRating = 1 | 2 | 3 | 4 | 5;

/**
 * Firestore document: reviews/{userId}
 * One review per user; written only by Cloud Functions.
 */
export interface AppReview {
  userId: string;
  rating: ReviewRating;
  /** Free-text feedback (required, 25–500 chars). */
  comment: string;
  creditsAwarded: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type SubmitReviewRequest = {
  rating: ReviewRating;
  comment: string;
};

export type SubmitReviewResult = {
  success: true;
  creditsAwarded: number;
  aiCreditsBalance: number;
};
