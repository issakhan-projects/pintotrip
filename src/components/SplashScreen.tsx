"use client";

import type { ReactNode } from "react";
import { APP_NAME } from "@/features/legal";
import { Button } from "@/components/ui";
import { cx } from "@/lib/utils";

export interface SplashScreenProps {
  /** Optional status line under the brand (e.g. account setup). */
  message?: string;
  /** When set, splash switches to an error state. */
  error?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * Full-viewport brand splash for auth boot, redirects, and account setup.
 */
export function SplashScreen({
  message,
  error,
  onRetry,
  retryLabel = "Try again",
  className,
  children,
}: SplashScreenProps) {
  const busy = !error;

  return (
    <main
      className={cx(
        "relative flex min-h-dvh flex-1 flex-col items-center justify-center overflow-hidden bg-background px-6",
        className
      )}
      role="status"
      aria-busy={busy}
      aria-live="polite"
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,var(--color-primary-tint)_0%,transparent_58%)]" />
        <div className="absolute -left-[20%] top-[18%] h-[42vmax] w-[42vmax] rounded-full bg-primary/[0.06] blur-3xl" />
        <div className="absolute -right-[18%] bottom-[12%] h-[36vmax] w-[36vmax] rounded-full bg-primary/[0.05] blur-3xl" />
      </div>

      <div className="relative flex flex-col items-center text-center">
        <div className="splash-mark relative flex h-24 w-24 items-center justify-center">
          <span
            className="splash-mark-ring absolute inset-0 rounded-full border border-primary/15"
            aria-hidden
          />
          {/* eslint-disable-next-line @next/next/no-img-element -- local brand mark */}
          <img
            src="/icon.svg"
            alt=""
            width={80}
            height={80}
            className="splash-mark-icon relative h-20 w-20"
            decoding="async"
          />
        </div>

        <p className="splash-brand mt-5 font-[family-name:var(--font-lobster)] text-3xl font-normal tracking-wide text-primary sm:text-4xl">
          {APP_NAME}
        </p>

        {error ? (
          <div className="mt-6 flex max-w-sm flex-col items-center gap-3">
            <p className="text-sm text-error" role="alert">
              {error}
            </p>
            {onRetry ? (
              <Button
                type="button"
                variant="primary"
                className="h-10 rounded-xl px-4 text-sm"
                onClick={onRetry}
              >
                {retryLabel}
              </Button>
            ) : null}
          </div>
        ) : message ? (
          <p className="splash-message mt-5 text-sm text-text-secondary">
            {message}
          </p>
        ) : (
          <span className="sr-only">{APP_NAME}</span>
        )}

        {children}
      </div>
    </main>
  );
}
