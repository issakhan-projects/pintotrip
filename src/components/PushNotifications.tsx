"use client";

/**
 * Registers FCM web push when the user is signed in and this device opted in.
 * Permission is requested from Settings or when planning a trip (enableWebPush).
 * Foreground messages use ForegroundPushBanner (existing UI pattern).
 */

import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  enableWebPush,
  shouldAutoRegisterPush,
} from "@/services/fcmTokens";
import { subscribeForegroundPush } from "@/lib/firebase/messaging";
import { ForegroundPushBanner } from "@/components/ForegroundPushBanner";
import { devLog } from "@/lib/devLog";

export function PushNotifications() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !user) return;
    if (typeof window === "undefined") return;
    if (!shouldAutoRegisterPush()) return;

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
    // Refresh token registration after SW updates / token rotation.
    if (!user || typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (!shouldAutoRegisterPush()) return;

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

  // Re-validate token when the tab becomes visible again (handles quiet refresh).
  useEffect(() => {
    if (!user) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!shouldAutoRegisterPush()) return;
      void enableWebPush(user.uid).catch((err) => {
        devLog.warn("[FCM] visibility refresh failed", err);
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [user]);

  return <ForegroundPushBanner />;
}
