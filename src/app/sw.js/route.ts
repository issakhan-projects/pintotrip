/**
 * Unified service worker: PWA installability + FCM web push.
 * Served dynamically so Firebase public config can be injected.
 */

import { getFirebasePublicEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIREBASE_COMPAT_VERSION = "12.19.0";

export function GET() {
  let firebaseConfig: Record<string, string> = {};
  try {
    firebaseConfig = getFirebasePublicEnv() as unknown as Record<string, string>;
  } catch {
    // SW still registers for PWA; FCM stays inactive until env is set.
  }

  const appScript = `https://www.gstatic.com/firebasejs/${FIREBASE_COMPAT_VERSION}/firebase-app-compat.js`;
  const messagingScript = `https://www.gstatic.com/firebasejs/${FIREBASE_COMPAT_VERSION}/firebase-messaging-compat.js`;

  const body = `/* PinToTrip SW — PWA + FCM (generated) */
const SW_VERSION = "pintototrip-sw-v3";
const FIREBASE_CONFIG = ${JSON.stringify(firebaseConfig)};

/** Dedupe window for identical pushes (ms). */
const DEDUPE_TTL_MS = 60 * 1000;
const recentNotificationKeys = new Map();

function pruneDedupe(now) {
  for (const [key, ts] of recentNotificationKeys.entries()) {
    if (now - ts > DEDUPE_TTL_MS) recentNotificationKeys.delete(key);
  }
}

function notificationDedupeKey(title, body, link, tag) {
  if (tag) return "tag:" + tag;
  return "tb:" + title + "|" + body + "|" + link;
}

function shouldSkipDuplicate(title, body, link, tag) {
  const now = Date.now();
  pruneDedupe(now);
  const key = notificationDedupeKey(title, body, link, tag);
  if (recentNotificationKeys.has(key)) return true;
  recentNotificationKeys.set(key, now);
  return false;
}

function resolveLink(payload) {
  return (
    (payload.data && payload.data.link) ||
    (payload.fcmOptions && payload.fcmOptions.link) ||
    (payload.notification && payload.notification.click_action) ||
    "/map"
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("pintototrip-") && key !== SW_VERSION)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(request));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw =
    (event.notification && event.notification.data && event.notification.data.link) ||
    "/map";
  const targetUrl = new URL(raw, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of allClients) {
        const clientUrl = client.url || "";
        const sameOrigin = clientUrl.startsWith(self.location.origin);
        if (sameOrigin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(targetUrl);
            } catch (_) {}
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});

self.addEventListener("notificationclose", () => {
  // No-op — reserved for analytics hooks.
});

(function initFcm() {
  if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.apiKey || !FIREBASE_CONFIG.projectId) {
    return;
  }
  try {
    importScripts(${JSON.stringify(appScript)});
    importScripts(${JSON.stringify(messagingScript)});
  } catch (err) {
    console.warn("[PinToTrip SW] FCM scripts failed to load", err);
    return;
  }

  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage(function (payload) {
      const title =
        (payload.notification && payload.notification.title) ||
        (payload.data && payload.data.title) ||
        "PinToTrip";
      const body =
        (payload.notification && payload.notification.body) ||
        (payload.data && payload.data.body) ||
        "";
      const link = resolveLink(payload);
      const tag =
        (payload.data && (payload.data.tag || payload.data.notificationId)) ||
        undefined;

      if (shouldSkipDuplicate(title, body, link, tag)) {
        return Promise.resolve();
      }

      const options = {
        body: body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: {
          link: link,
          type: (payload.data && payload.data.type) || "general",
        },
        // Same tag replaces prior notification → prevents stacking duplicates.
        tag: tag || notificationDedupeKey(title, body, link, null),
        renotify: false,
      };

      return self.registration.showNotification(title, options);
    });
  } catch (err) {
    console.warn("[PinToTrip SW] FCM init failed", err);
  }
})();
`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
