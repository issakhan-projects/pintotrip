import {
  addDoc,
  collection,
  serverTimestamp,
  type CollectionReference,
} from "firebase/firestore";
import { getFirestoreDb, FirestorePaths } from "@/lib/firebase/firestore";
import type { SupportTicketCreateInput } from "@/types/support";

function supportCollection(): CollectionReference {
  return collection(getFirestoreDb(), FirestorePaths.support);
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

/** Create a support ticket in the top-level `support` collection. */
export async function createSupportTicket(
  input: SupportTicketCreateInput
): Promise<string> {
  const question = input.question.trim();
  if (!question) {
    throw new Error("Support question is required.");
  }

  const payload = omitUndefined({
    userId: input.userId,
    email: input.email?.trim() || undefined,
    type: input.type,
    topicLabel: input.topicLabel?.trim() || undefined,
    question,
    status: "open" as const,
    language: input.language?.trim() || undefined,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const ref = await addDoc(supportCollection(), payload);
  return ref.id;
}
