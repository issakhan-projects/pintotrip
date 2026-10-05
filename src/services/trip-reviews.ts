import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  type DocumentReference,
} from "firebase/firestore";
import { getFirestoreDb, FirestorePaths } from "@/lib/firebase/firestore";
import { updateTrip } from "@/services/trip-planner";
import type {
  TripReview,
  TripReviewCreateInput,
  TripReviewDoc,
} from "@/types/trip-review";

function tripReviewRef(userId: string, tripId: string): DocumentReference {
  return doc(getFirestoreDb(), FirestorePaths.tripReview(userId, tripId));
}

function omitUndefined<T extends Record<string, unknown>>(
  value: T
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as { [K in keyof T]?: Exclude<T[K], undefined> };
}

/** Returns the trip review when one exists (doc id = tripId). */
export async function getTripReview(
  userId: string,
  tripId: string
): Promise<TripReviewDoc | null> {
  const snap = await getDoc(tripReviewRef(userId, tripId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as TripReview) };
}

/** Create or overwrite the single review for a trip. */
export async function createTripReview(
  userId: string,
  input: TripReviewCreateInput
): Promise<string> {
  const ref = tripReviewRef(userId, input.tripId);
  const payload = omitUndefined({
    userId,
    tripId: input.tripId,
    tripName: input.tripName.trim(),
    planningRating: input.planningRating,
    itineraryRating: input.itineraryRating,
    liked: input.liked?.trim() || undefined,
    improve: input.improve.trim(),
    recommend: input.recommend,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(ref, payload);
  // Persist on the trip so Rate CTA stays hidden after reload.
  try {
    await updateTrip(userId, input.tripId, { tripReviewed: true });
  } catch {
    // Review already saved; trip flag can be retried on next submit.
  }
  return input.tripId;
}
