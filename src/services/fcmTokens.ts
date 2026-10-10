/**
 * Persist FCM web push tokens under users/{uid}/fcmTokens/{tokenId}.
 */

import {
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { getFirestoreDb, FirestorePaths } from "@/lib/firebase/firestore";
import { obtainFcmToken } from "@/lib/firebase/messaging";
import { devLog } from "@/lib/devLog";

function tokenDocId(token: string): string {
  // Firestore-safe id from the token (tokens are URL-safe-ish but may include `:`)
  if (typeof btoa === "function") {
    return btoa(token)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "")
      .slice(0, 700);
  }
  return token.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 700);
}

/**
 * Ask for permission (if needed), get an FCM token, and save it for the user.
 * Safe to call repeatedly — upserts the same token doc.
 */
export async function enableWebPush(userId: string): Promise<boolean> {
  try {
    const token = await obtainFcmToken();
    if (!token) return false;

    const id = tokenDocId(token);
    await setDoc(
      doc(getFirestoreDb(), FirestorePaths.fcmToken(userId, id)),
      {
        token,
        platform: "web",
        userAgent:
          typeof navigator !== "undefined"
            ? navigator.userAgent.slice(0, 300)
            : "",
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  } catch (err) {
    devLog.warn("[FCM] enableWebPush failed", err);
    return false;
  }
}

export async function removeWebPushToken(
  userId: string,
  token: string
): Promise<void> {
  const id = tokenDocId(token);
  await deleteDoc(
    doc(getFirestoreDb(), FirestorePaths.fcmToken(userId, id))
  );
}
