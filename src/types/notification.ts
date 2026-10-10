import type { Timestamp } from "firebase/firestore";

/**
 * Firestore document: users/{userId}/notifications/{notificationId}
 * Written by Cloud Functions; readable by the owner.
 */
export interface AppNotification {
  type:
    | "referral_reward"
    | "plan_trip_ready"
    | "plan_trip_error"
    | string;
  title: string;
  body: string;
  /** In-app deep link path, e.g. `/map?tab=profile` or `/trip-planner/{id}`. */
  link: string | null;
  read: boolean;
  createdAt: Timestamp | number;
}
