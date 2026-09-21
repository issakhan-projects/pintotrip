"use client";

import { useEffect, useState } from "react";
import { isDevLoggingEnabled } from "@/lib/devLog";
import {
  getPlacesApiUsage,
  resetPlacesApiUsage,
  subscribePlacesApiUsage,
  type PlacesApiUsageSnapshot,
} from "@/lib/maps";

/**
 * Floating Places API counter — localhost / development only.
 * Click to reset. Details also stream to the console via [Places API] logs.
 */
export function PlacesApiDevBadge() {
  const [enabled] = useState(() => isDevLoggingEnabled());
  const [usage, setUsage] = useState<PlacesApiUsageSnapshot | null>(null);

  useEffect(() => {
    if (!enabled) return;
    setUsage(getPlacesApiUsage());
    return subscribePlacesApiUsage(setUsage);
  }, [enabled]);

  if (!enabled || !usage) return null;

  return (
    <button
      type="button"
      title="Places API session counts (click to reset). Also logged as [Places API] in the console."
      onClick={() => resetPlacesApiUsage()}
      className="fixed bottom-20 right-3 z-[80] rounded-lg border border-amber-500/40 bg-black/80 px-2.5 py-1.5 font-mono text-[11px] leading-tight text-amber-100 shadow-lg backdrop-blur-sm hover:bg-black/90"
    >
      <span className="block text-[9px] uppercase tracking-wide text-amber-200/80">
        Places API
      </span>
      <span className="tabular-nums">
        net {usage.network}
        <span className="text-amber-200/50"> · </span>
        cache {usage.cacheHits}
      </span>
    </button>
  );
}
