/**
 * Reusable user notification service for Cloud Functions modules.
 *
 * Writes the in-app inbox document and (optionally) sends an FCM web push.
 * Use this from trip planning, referrals, AI jobs, system announcements, etc.
 *
 * Security: this module is Admin-SDK only (server-side). Do not expose a
 * public callable that accepts arbitrary uid + payload without authz.
 */

import { logger } from "firebase-functions";
import { adminDb, initAdmin } from "./admin";
import {
  sendPushToTopic,
  sendPushToUser,
  sendPushToUsers,
  type PushPayload,
  PushTopics,
} from "./pushNotifications";

export type UserNotificationInput = {
  type: string;
  title: string;
  body: string;
  /** In-app deep link path or absolute URL. */
  link: string | null;
  /** Extra inbox fields (must be JSON-serializable). */
  meta?: Record<string, unknown>;
  /** When false, only write inbox (no FCM). Default true when link/title set. */
  push?: boolean;
  /** Optional FCM tag for SW dedupe. */
  tag?: string;
  /** Extra FCM data string map. */
  pushData?: Record<string, string>;
};

export type NotifyResult = {
  notificationId: string | null;
  pushed: boolean;
};

async function writeInbox(
  uid: string,
  input: UserNotificationInput
): Promise<string | null> {
  initAdmin();
  try {
    const ref = await adminDb()
      .collection(`users/${uid}/notifications`)
      .add({
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link,
        read: false,
        createdAt: Date.now(),
        ...(input.meta ? { meta: input.meta } : {}),
      });
    return ref.id;
  } catch (err) {
    logger.warn("userNotifications.writeInbox failed", {
      uid,
      type: input.type,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function toPushPayload(
  input: UserNotificationInput
): PushPayload | null {
  if (input.push === false) return null;
  return {
    title: input.title,
    body: input.body,
    link: input.link || "/map",
    type: input.type,
    tag: input.tag,
    data: input.pushData,
  };
}

/**
 * Notify one user: inbox + optional push to all of their devices.
 */
export async function notifyUser(
  uid: string,
  input: UserNotificationInput
): Promise<NotifyResult> {
  const notificationId = await writeInbox(uid, input);
  const pushPayload = toPushPayload(input);
  if (!pushPayload) {
    return { notificationId, pushed: false };
  }

  // Prefer tagging with inbox id so SW can dedupe retries.
  if (!pushPayload.tag && notificationId) {
    pushPayload.tag = notificationId;
  }
  // Client skips in-app FCM banner when inbox already covers this event.
  pushPayload.data = {
    ...(pushPayload.data ?? {}),
    hasInbox: notificationId ? "1" : "0",
  };

  const result = await sendPushToUser(uid, pushPayload);
  return {
    notificationId,
    pushed: result.successCount > 0,
  };
}

/**
 * Notify many users with the same payload.
 */
export async function notifyUsers(
  uids: string[],
  input: UserNotificationInput
): Promise<{ notified: number }> {
  const unique = [...new Set(uids.filter(Boolean))];
  let notified = 0;
  for (const uid of unique) {
    const result = await notifyUser(uid, input);
    if (result.notificationId || result.pushed) notified += 1;
  }
  return { notified };
}

/**
 * Push-only fanout (no per-user inbox). Useful for broadcast announcements
 * when combined with {@link sendPushToTopic} subscribers.
 */
export async function pushToUsers(
  uids: string[],
  payload: PushPayload
): Promise<void> {
  await sendPushToUsers(uids, payload);
}

/**
 * System announcement via FCM topic (push only).
 * Prefer {@link notifyUsers} when you need inbox history per user.
 */
export async function announceToTopic(
  input: Omit<UserNotificationInput, "push"> & { topic?: string }
): Promise<boolean> {
  const topic = input.topic ?? PushTopics.systemAnnouncements;
  return sendPushToTopic(topic, {
    title: input.title,
    body: input.body,
    link: input.link || "/map",
    type: input.type || "system_announcement",
    tag: input.tag,
    data: input.pushData,
  });
}
