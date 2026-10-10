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
const SW_VERSION = "pintototrip-sw-v2";
const FIREBASE_CONFIG = ${JSON.stringify(firebaseConfig)};

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
        if ("focus" in client) {
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
      const link =
        (payload.data && payload.data.link) ||
        (payload.fcmOptions && payload.fcmOptions.link) ||
        "/map";
      return self.registration.showNotification(title, {
        body: body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { link: link },
      });
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
