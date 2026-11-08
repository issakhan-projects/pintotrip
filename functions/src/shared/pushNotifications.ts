/**
 * FCM web push delivery helpers (Admin SDK).
 * Internal-only — call from Cloud Functions modules, never expose raw send
 * as a public callable without additional authorization.
 *
 * Supports: single user, multiple users, specific tokens, and topics.
 * Automatically removes invalid / expired registration tokens from Firestore.
 */

import {
  getMessaging,
  type Messaging,
  type MulticastMessage,
  type TopicMessage,
} from "firebase-admin/messaging";
import { logger } from "firebase-functions";
import { initAdmin, adminDb } from "./admin";

const APP_ORIGIN = "https://pintototrip.app";
/** FCM multicast limit. */
const MULTICAST_CHUNK = 500;

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
  /** Stable id/tag for SW dedupe (optional). */
  tag?: string;
  /** Extra string data merged into the FCM data payload. */
  data?: Record<string, string>;
};

export type PushSendResult = {
  successCount: number;
  failureCount: number;
  removedTokenCount: number;
};

type TokenEntry = { uid: string; id: string; token: string };

function buildDataPayload(payload: PushPayload): Record<string, string> {
  const data: Record<string, string> = {
    title: payload.title,
    body: payload.body,
    link: payload.link,
    type: payload.type ?? "general",
  };
  if (payload.tag) data.tag = payload.tag;
  if (payload.data) {
    for (const [key, value] of Object.entries(payload.data)) {
      if (typeof value === "string") data[key] = value;
    }
  }
  return data;
}

function buildMulticast(
  tokens: string[],
  payload: PushPayload
): MulticastMessage {
  const link = absoluteLink(payload.link);
  return {
    tokens,
    // Data-only so our service worker always owns showNotification (icon + link).
    data: buildDataPayload(payload),
    webpush: {
      fcmOptions: { link },
      headers: { Urgency: "high" },
    },
  };
}

function isStaleTokenError(code: string | undefined): boolean {
  return (
    code === "messaging/registration-token-not-registered" ||
    code === "messaging/invalid-registration-token"
  );
}

async function deleteTokenDocs(
  entries: Array<{ uid: string; id: string }>
): Promise<void> {
  if (entries.length === 0) return;
  // Firestore batch limit is 500.
  for (let i = 0; i < entries.length; i += 400) {
    const slice = entries.slice(i, i + 400);
    const batch = adminDb().batch();
    for (const entry of slice) {
      batch.delete(
        adminDb().doc(`users/${entry.uid}/fcmTokens/${entry.id}`)
      );
    }
    await batch.commit();
  }
}

async function loadUserTokenEntries(uid: string): Promise<TokenEntry[]> {
  const snap = await adminDb().collection(`users/${uid}/fcmTokens`).get();
  const entries: TokenEntry[] = [];
  for (const d of snap.docs) {
    const token =
      typeof d.data().token === "string" ? d.data().token.trim() : "";
    if (token) entries.push({ uid, id: d.id, token });
  }
  return entries;
}

async function sendToTokenEntries(
  entries: TokenEntry[],
  payload: PushPayload,
  logLabel: string
): Promise<PushSendResult> {
  if (entries.length === 0) {
    return { successCount: 0, failureCount: 0, removedTokenCount: 0 };
  }

  let successCount = 0;
  let failureCount = 0;
  const stale: Array<{ uid: string; id: string }> = [];

  for (let i = 0; i < entries.length; i += MULTICAST_CHUNK) {
    const chunk = entries.slice(i, i + MULTICAST_CHUNK);
    const response = await messagingClient().sendEachForMulticast(
      buildMulticast(
        chunk.map((e) => e.token),
        payload
      )
    );
    successCount += response.successCount;
    failureCount += response.failureCount;

    response.responses.forEach((res, index) => {
      if (res.success) return;
      const code = res.error?.code ?? "";
      logger.warn(`${logLabel}: token send failed`, {
        code,
        message: res.error?.message,
        uid: chunk[index]?.uid,
      });
      if (isStaleTokenError(code)) {
        const entry = chunk[index];
        if (entry) stale.push({ uid: entry.uid, id: entry.id });
      }
    });
  }

  if (stale.length > 0) {
    await deleteTokenDocs(stale);
    logger.info(`${logLabel}: removed stale tokens`, {
      count: stale.length,
    });
  }

  return {
    successCount,
    failureCount,
    removedTokenCount: stale.length,
  };
}

/**
 * Send a system/OS notification to every FCM token for the user.
 * Removes dead tokens from Firestore.
 */
export async function sendPushToUser(
  uid: string,
  payload: PushPayload
): Promise<PushSendResult> {
  try {
    const entries = await loadUserTokenEntries(uid);
    if (entries.length === 0) {
      logger.info("sendPushToUser: no FCM tokens", { uid });
      return { successCount: 0, failureCount: 0, removedTokenCount: 0 };
    }
    const result = await sendToTokenEntries(entries, payload, "sendPushToUser");
    logger.info("sendPushToUser: done", { uid, ...result });
    return result;
  } catch (err) {
    logger.warn("sendPushToUser failed", {
      uid,
      err: err instanceof Error ? err.message : String(err),
    });
    return { successCount: 0, failureCount: 0, removedTokenCount: 0 };
  }
}

/**
 * Send the same push to many users (each user's registered devices).
 */
export async function sendPushToUsers(
  uids: string[],
  payload: PushPayload
): Promise<PushSendResult> {
  const unique = [...new Set(uids.filter(Boolean))];
  let successCount = 0;
  let failureCount = 0;
  let removedTokenCount = 0;

  for (const uid of unique) {
    const result = await sendPushToUser(uid, payload);
    successCount += result.successCount;
    failureCount += result.failureCount;
    removedTokenCount += result.removedTokenCount;
  }

  return { successCount, failureCount, removedTokenCount };
}

/**
 * Send to specific device tokens. When `uid` is provided, stale tokens are
 * deleted from that user's `fcmTokens` collection.
 */
export async function sendPushToDevices(
  tokens: string[],
  payload: PushPayload,
  options?: { uid?: string }
): Promise<PushSendResult> {
  try {
    const unique = [
      ...new Set(tokens.map((t) => t.trim()).filter(Boolean)),
    ];
    if (unique.length === 0) {
      return { successCount: 0, failureCount: 0, removedTokenCount: 0 };
    }

    const uid = options?.uid;
    const entries: TokenEntry[] = unique.map((token, index) => ({
      uid: uid ?? "",
      id: uid ? "" : `anon-${index}`,
      token,
    }));

    // If we have a uid, resolve Firestore doc ids for cleanup.
    if (uid) {
      const stored = await loadUserTokenEntries(uid);
      const byToken = new Map(stored.map((e) => [e.token, e]));
      for (let i = 0; i < entries.length; i++) {
        const match = byToken.get(entries[i]!.token);
        if (match) entries[i] = match;
      }
    }

    let successCount = 0;
    let failureCount = 0;
    const stale: Array<{ uid: string; id: string }> = [];

    for (let i = 0; i < entries.length; i += MULTICAST_CHUNK) {
      const chunk = entries.slice(i, i + MULTICAST_CHUNK);
      const response = await messagingClient().sendEachForMulticast(
        buildMulticast(
          chunk.map((e) => e.token),
          payload
        )
      );
      successCount += response.successCount;
      failureCount += response.failureCount;
      response.responses.forEach((res, index) => {
        if (res.success) return;
        const code = res.error?.code ?? "";
        logger.warn("sendPushToDevices: token send failed", {
          code,
          message: res.error?.message,
        });
        if (isStaleTokenError(code) && uid) {
          const entry = chunk[index];
          if (entry?.id) stale.push({ uid, id: entry.id });
        }
      });
    }

    if (stale.length > 0) {
      await deleteTokenDocs(stale);
    }

    const result = {
      successCount,
      failureCount,
      removedTokenCount: stale.length,
    };
    logger.info("sendPushToDevices: done", result);
    return result;
  } catch (err) {
    logger.warn("sendPushToDevices failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return { successCount: 0, failureCount: 0, removedTokenCount: 0 };
  }
}

/**
 * Send to an FCM topic (e.g. system announcements). Clients must be
 * subscribed via {@link subscribeTokensToTopic}.
 */
export async function sendPushToTopic(
  topic: string,
  payload: PushPayload
): Promise<boolean> {
  const normalized = topic.trim().replace(/^\/+/, "");
  if (!normalized) {
    logger.warn("sendPushToTopic: empty topic");
    return false;
  }

  try {
    const link = absoluteLink(payload.link);
    const message: TopicMessage = {
      topic: normalized,
      data: buildDataPayload(payload),
      webpush: {
        fcmOptions: { link },
        headers: { Urgency: "high" },
      },
    };
    const id = await messagingClient().send(message);
    logger.info("sendPushToTopic: done", { topic: normalized, id });
    return true;
  } catch (err) {
    logger.warn("sendPushToTopic failed", {
      topic: normalized,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function subscribeTokensToTopic(
  tokens: string[],
  topic: string
): Promise<void> {
  const normalized = topic.trim().replace(/^\/+/, "");
  const unique = [...new Set(tokens.map((t) => t.trim()).filter(Boolean))];
  if (!normalized || unique.length === 0) return;
  try {
    const res = await messagingClient().subscribeToTopic(unique, normalized);
    logger.info("subscribeTokensToTopic", {
      topic: normalized,
      successCount: res.successCount,
      failureCount: res.failureCount,
    });
  } catch (err) {
    logger.warn("subscribeTokensToTopic failed", {
      topic: normalized,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function unsubscribeTokensFromTopic(
  tokens: string[],
  topic: string
): Promise<void> {
  const normalized = topic.trim().replace(/^\/+/, "");
  const unique = [...new Set(tokens.map((t) => t.trim()).filter(Boolean))];
  if (!normalized || unique.length === 0) return;
  try {
    const res = await messagingClient().unsubscribeFromTopic(
      unique,
      normalized
    );
    logger.info("unsubscribeTokensFromTopic", {
      topic: normalized,
      successCount: res.successCount,
      failureCount: res.failureCount,
    });
  } catch (err) {
    logger.warn("unsubscribeTokensFromTopic failed", {
      topic: normalized,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Well-known topics other modules can reuse. */
export const PushTopics = {
  systemAnnouncements: "system_announcements",
} as const;
