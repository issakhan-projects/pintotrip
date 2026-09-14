"use client";

import { useCallback } from "react";
import {
  trackEvent,
  identifyUser,
  resetAnalytics,
} from "@/lib/analytics";
import type { AnalyticsEventName, AnalyticsProperties } from "@/types/analytics";

/**
 * Convenience hook around the analytics service.
 */
export function useAnalytics() {
  const track = useCallback(
    (
      event: AnalyticsEventName | (string & {}),
      properties?: AnalyticsProperties
    ) => {
      trackEvent(event, properties);
    },
    []
  );

  return {
    trackEvent: track,
    identifyUser,
    resetAnalytics,
  };
}
