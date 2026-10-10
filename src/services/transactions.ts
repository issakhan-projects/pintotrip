import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirestoreDb, FirestorePaths } from "@/lib/firebase/firestore";
import type {
  BillingTransaction,
  SavedBillingTransaction,
} from "@/types/transaction";

function createdAtMs(value: BillingTransaction["createdAt"]): number {
  if (value && typeof value === "object" && "toMillis" in value) {
    return value.toMillis();
  }
  return 0;
}

function mapTransactionSnap(snap: {
  docs: Array<{ id: string; data: () => unknown }>;
}): SavedBillingTransaction[] {
  const items: SavedBillingTransaction[] = snap.docs.map((d) => {
    const data = d.data() as BillingTransaction;
    return { id: d.id, ...data };
  });
  items.sort((a, b) => createdAtMs(b.createdAt) - createdAtMs(a.createdAt));
  return items;
}

/**
 * Live billing history for the signed-in user (newest first).
 * Rules scope reads to docs where `userId == auth.uid`.
 */
export function subscribeUserTransactions(
  userId: string,
  onData: (items: SavedBillingTransaction[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const q = query(
    collection(getFirestoreDb(), FirestorePaths.transactions),
    where("userId", "==", userId),
    limit(50)
  );

  return onSnapshot(
    q,
    (snap) => {
      onData(mapTransactionSnap(snap));
    },
    (err) => {
      onError?.(err);
    }
  );
}
