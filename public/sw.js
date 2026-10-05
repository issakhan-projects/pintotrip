/* PinToTrip service worker — installability + safe network pass-through.
 * Avoids aggressive caching so Firebase Auth / Next deploys stay fresh.
 */
const SW_VERSION = "pintototrip-sw-v1";

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

  // Never intercept Next.js / Firebase / API traffic — network only.
  event.respondWith(fetch(request));
});
