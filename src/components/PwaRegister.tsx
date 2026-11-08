"use client";

import { useEffect } from "react";
import { startInstallPromptCapture } from "@/lib/pwa/installPrompt";

/**
 * Registers the root service worker once on the client.
 * Required for Chromium install prompts + FCM web push.
 * iOS Add to Home Screen uses the web manifest + apple-web-app meta instead.
 *
 * Dev: also register so local push testing works (HTTPS / localhost).
 */
export function PwaRegister() {
  useEffect(() => {
    // Capture beforeinstallprompt as early as possible so "Use the app"
    // can call event.prompt() later from a user gesture.
    startInstallPromptCapture();

    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
      } catch {
        // Installability / push is best-effort — never block the app.
      }
    };

    void register();
  }, []);

  return null;
}
