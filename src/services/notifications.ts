import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirestoreDb, FirestorePaths } from "@/lib/firebase/firestore";
import type { AppNotification } from "@/types/notification";

export type SavedNotification = AppNotification & { id: string };

function createdAtMs(value: AppNotification["createdAt"]): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toMillis" in value) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

/**
 * Live unread notifications for the signed-in user (newest first).
 */
export function subscribeUnreadNotifications(
  userId: string,
  onData: (items: SavedNotification[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const q = query(
    collection(getFirestoreDb(), FirestorePaths.notifications(userId)),
    where("read", "==", false),
    limit(20)
  );

  return onSnapshot(
    q,
    (snap) => {
      const items: SavedNotification[] = snap.docs.map((d) => {
        const data = d.data() as AppNotification;
        return { id: d.id, ...data };
      });
      items.sort(
        (a, b) => createdAtMs(b.createdAt) - createdAtMs(a.createdAt)
      );
      onData(items.slice(0, 10));
    },
    (err) => {
      onError?.(err);
    }
  );
}

export async function markNotificationRead(
  userId: string,
  notificationId: string
): Promise<void> {
  await updateDoc(
    doc(getFirestoreDb(), FirestorePaths.notification(userId, notificationId)),
    { read: true }
  );
}
