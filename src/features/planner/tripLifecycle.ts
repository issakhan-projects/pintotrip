import type { TripPlannerDoc } from "@/types/trip-planner";

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Past = completed/cancelled, or end date before today. */
export function isPastTrip(
  trip: TripPlannerDoc,
  today = startOfToday()
): boolean {
  if (trip.status === "completed" || trip.status === "cancelled") return true;
  return trip.endDate.toDate() < today;
}

/** Trips whose calendar window ended but Firestore status was never flipped. */
export function needsCompletedStatus(
  trip: TripPlannerDoc,
  today = startOfToday()
): boolean {
  if (trip.status === "completed" || trip.status === "cancelled") return false;
  return trip.endDate.toDate() < today;
}

/** Eligible for the post-trip planning review prompt. */
export function needsTripReviewPrompt(trip: TripPlannerDoc): boolean {
  if (trip.status === "cancelled") return false;
  if (trip.reviewDismissedAt) return false;
  if (trip.status === "completed") return true;
  return trip.endDate.toDate() < startOfToday();
}
