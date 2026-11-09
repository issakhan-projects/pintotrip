"use client";

/**
 * Soft-warm Paddle.js after first paint so /pricing is less cold.
 * Does not inject the CDN itself — only calls initializePaddle via getPaddle().
 */

import { useEffect } from "react";
import { prefetchPaddle } from "@/lib/paddle/client";
import { hasPaddlePublicEnvConfigured } from "@/lib/paddle/env";

export function PaddlePrefetch() {
  useEffect(() => {
    if (!hasPaddlePublicEnvConfigured()) return;

    const run = () => prefetchPaddle();

    const ric = window.requestIdleCallback?.bind(window);
    if (ric) {
      const id = ric(run, { timeout: 6_000 });
      return () => window.cancelIdleCallback?.(id);
    }

    const timeoutId = window.setTimeout(run, 2_500);
    return () => window.clearTimeout(timeoutId);
  }, []);

  return null;
}
