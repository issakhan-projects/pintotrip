/**
 * Send FCM web push to a user's registered browser tokens.
 * Best-effort — failures must never fail the caller (planTrip, etc.).
 */

import { getMessaging, type Messaging } from "firebase-admin/messaging";
import { logger } from "firebase-functions";
import { initAdmin, adminDb } from "./admin";

const APP_ORIGIN = "https://pintototrip.app";

let messaging: Messaging | undefined;

function messagingClient(): Messaging {
  initAdmin();
  if (!messaging) {
    messaging = getMessaging();
  }
  return messaging;
}

function absoluteLink(link: string): string {
  if (/^https?:\/\//i.test(link)) return link;
  const path = link.startsWith("/") ? link : `/${link}`;
  return `${APP_ORIGIN}${path}`;
}

export type PushPayload = {
  title: string;
  body: string;
  /** In-app path or absolute URL, e.g. `/trip-planner/{id}`. */
  link: string;
  type?: string;
};

/**
 * Send a system/OS notification to every FCM token for the user.
 * Removes dead tokens from Firestore.
 */
export async function sendPushToUser(
  uid: string,
  payload: PushPayload
): Promise<void> {
  try {
    const snap = await adminDb()
      .collection(`users/${uid}/fcmTokens`)
      .get();
    if (snap.empty) {
      logger.info("sendPushToUser: no FCM tokens", { uid });
      return;
    }

    const entries = snap.docs
      .map((d) => {
        const token =
          typeof d.data().token === "string" ? d.data().token.trim() : "";
        return token ? { id: d.id, token } : null;
      })
      .filter((row): row is { id: string; token: string } => Boolean(row));

    if (entries.length === 0) return;

    // Data-only so our service worker always owns showNotification (icon + link).
    const link = absoluteLink(payload.link);
    const response = await messagingClient().sendEachForMulticast({
      tokens: entries.map((e) => e.token),
      data: {
        title: payload.title,
        body: payload.body,
        link: payload.link,
        type: payload.type ?? "general",
      },
      webpush: {
        fcmOptions: {
          link,
        },
        headers: {
          Urgency: "high",
        },
      },
    });

    const staleIds: string[] = [];
    response.responses.forEach((res, index) => {
      if (res.success) return;
      const code = res.error?.code ?? "";
      logger.warn("sendPushToUser: token send failed", {
        uid,
        code,
        message: res.error?.message,
      });
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        const entry = entries[index];
        if (entry) staleIds.push(entry.id);
      }
    });

    if (staleIds.length > 0) {
      const batch = adminDb().batch();
      for (const id of staleIds) {
        batch.delete(adminDb().doc(`users/${uid}/fcmTokens/${id}`));
      }
      await batch.commit();
      logger.info("sendPushToUser: removed stale tokens", {
        uid,
        count: staleIds.length,
      });
    }

    logger.info("sendPushToUser: done", {
      uid,
      successCount: response.successCount,
      failureCount: response.failureCount,
    });
  } catch (err) {
    logger.warn("sendPushToUser failed", {
      uid,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
