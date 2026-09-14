"use client";

import posthog from "posthog-js";
import { getPublicEnv, hasPostHogConfigured } from "@/lib/env";
import { hasAnalyticsConsent } from "@/lib/cookies";

let initialized = false;

/**
 * Initialize PostHog once on the client.
 * Safe to call multiple times. No-ops when PostHog is not configured
 * or the user has not opted into analytics cookies.
 */
export function initAnalytics(): void {
  if (typeof window === "undefined" || initialized) return;
  if (!hasPostHogConfigured()) return;
  if (!hasAnalyticsConsent()) return;

  const { posthog: config } = getPublicEnv();
  if (!config.key) return;

  posthog.init(config.key, {
    api_host: config.host,
    person_profiles: "identified_only",
    capture_pageview: true,
    capture_pageleave: true,
    opt_out_capturing_by_default: false,
  });

  // Re-enable if previously opted out.
  try {
    posthog.opt_in_capturing();
  } catch {
    // ignore
  }

  initialized = true;
}

export function getPostHog() {
  return posthog;
}

export function isAnalyticsReady(): boolean {
  return initialized;
}

/** Opt out and clear PostHog state when analytics consent is revoked. */
export function disableAnalytics(): void {
  if (typeof window === "undefined") return;
  try {
    if (initialized) {
      posthog.opt_out_capturing();
      posthog.reset();
    }
  } catch {
    // ignore
  }
  initialized = false;
}
