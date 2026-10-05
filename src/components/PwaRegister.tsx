"use client";

import { useEffect } from "react";

/**
 * Registers the root service worker once on the client (production only).
 * Required for Chromium install prompts; iOS Add to Home Screen uses the
 * web manifest + apple-web-app meta instead.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
      } catch {
        // Installability is best-effort — never block the app.
      }
    };

    void register();
  }, []);

  return null;
}
