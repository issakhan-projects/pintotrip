import type { Timestamp } from "firebase/firestore";

export type TripReviewRating = 1 | 2 | 3 | 4 | 5;

export type TripReviewRecommend = "yes" | "maybe" | "no";

/**
 * Firestore document: users/{userId}/tripReviews/{tripId}
 * One review per trip (doc id = tripId).
 */
export type TripReview = {
  userId: string;
  tripId: string;
  tripName: string;
  /** How was the planning experience? */
  planningRating: TripReviewRating;
  /** How useful was the itinerary on the trip? */
  itineraryRating?: TripReviewRating;
  /** What went well. */
  liked?: string;
  /** What should we improve. */
  improve: string;
  /** Would you use Trip Planner again / recommend it? */
  recommend?: TripReviewRecommend;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type TripReviewCreateInput = {
  tripId: string;
  tripName: string;
  planningRating: TripReviewRating;
  itineraryRating?: TripReviewRating;
  liked?: string;
  improve: string;
  recommend?: TripReviewRecommend;
};

export type TripReviewDoc = TripReview & { id: string };
