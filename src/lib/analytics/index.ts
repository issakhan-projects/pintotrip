"use client";

import type { AnalyticsEventName, AnalyticsProperties } from "@/types/analytics";
import {
  initAnalytics,
  getPostHog,
  isAnalyticsReady,
  disableAnalytics,
} from "./posthog";
import { hasAnalyticsConsent } from "@/lib/cookies";

/**
 * Central analytics abstraction.
 * Components and features should call these helpers — not PostHog directly.
 */
export function trackEvent(
  event: AnalyticsEventName | (string & {}),
  properties?: AnalyticsProperties
): void {
  if (!hasAnalyticsConsent()) return;
  initAnalytics();
  if (!isAnalyticsReady()) return;

  getPostHog().capture(event, properties);
}

export function identifyUser(
  userId: string,
  traits?: AnalyticsProperties
): void {
  if (!hasAnalyticsConsent()) return;
  initAnalytics();
  if (!isAnalyticsReady()) return;

  getPostHog().identify(userId, traits);
}

export function resetAnalytics(): void {
  if (!isAnalyticsReady()) return;
  getPostHog().reset();
}

export function applyAnalyticsConsent(enabled: boolean): void {
  if (enabled) {
    initAnalytics();
  } else {
    disableAnalytics();
  }
}

export { AnalyticsEvents } from "@/types/analytics";
