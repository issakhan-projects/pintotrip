"use client";

/**
 * Registers FCM web push when the user is signed in and permission is already
 * granted. Permission is requested when planning a trip (see enableWebPush).
 */

import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { enableWebPush } from "@/services/fcmTokens";
import { subscribeForegroundPush } from "@/lib/firebase/messaging";
import { devLog } from "@/lib/devLog";

export function PushNotifications() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !user) return;
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;

    // Only auto-register when the user already allowed notifications.
    if (Notification.permission !== "granted") return;

    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await enableWebPush(user.uid);
    })();

    let unsub = () => {};
    void subscribeForegroundPush().then((stop) => {
      if (cancelled) {
        stop();
        return;
      }
      unsub = stop;
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [user, loading]);

  useEffect(() => {
    // Refresh token registration after SW updates.
    if (!user || typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const onControllerChange = () => {
      void enableWebPush(user.uid).catch((err) => {
        devLog.warn("[FCM] re-register after SW update failed", err);
      });
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange
    );
    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange
      );
    };
  }, [user]);

  return null;
}
