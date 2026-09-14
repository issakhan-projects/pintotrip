"use client";

import { useEffect, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import {
  OPEN_COOKIE_SETTINGS_EVENT,
  readCookieConsent,
  writeCookieConsent,
} from "@/lib/cookies";
import { applyAnalyticsConsent } from "@/lib/analytics";
import { cx } from "@/lib/utils";

/**
 * Cookie settings panel — opened from footer or first-visit banner.
 */
export function CookieSettings() {
  const [open, setOpen] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    const existing = readCookieConsent();
    if (existing) {
      setAnalytics(existing.analytics);
      setShowBanner(false);
      applyAnalyticsConsent(existing.analytics);
    } else {
      setShowBanner(true);
    }

    const onOpen = () => {
      const current = readCookieConsent();
      setAnalytics(current?.analytics ?? false);
      setOpen(true);
      setShowBanner(false);
    };

    const onHash = () => {
      if (window.location.hash === "#cookies") onOpen();
    };

    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, onOpen);
    window.addEventListener("hashchange", onHash);
    onHash();

    return () => {
      window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, onOpen);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  function save(nextAnalytics: boolean) {
    writeCookieConsent({ analytics: nextAnalytics });
    applyAnalyticsConsent(nextAnalytics);
    setAnalytics(nextAnalytics);
    setOpen(false);
    setShowBanner(false);
    if (window.location.hash === "#cookies") {
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search
      );
    }
  }

  function acceptAll() {
    save(true);
  }

  function rejectOptional() {
    save(false);
  }

  function savePreferences() {
    save(analytics);
  }

  return (
    <>
      {showBanner && !open ? (
        <div className="fixed inset-x-0 bottom-0 z-[90] p-4 sm:p-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-4 rounded-2xl border border-border bg-white p-4 shadow-[0_16px_48px_-16px_rgba(17,24,39,0.35)] sm:flex-row sm:items-center sm:p-5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-text">Cookie settings</p>
              <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                We use necessary cookies to run PinToTrip. Analytics cookies are
                optional and help us improve the product.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="btn-secondary h-9 px-3 text-xs"
              >
                Customize
              </button>
              <button
                type="button"
                onClick={rejectOptional}
                className="btn-secondary h-9 px-3 text-xs"
              >
                Necessary only
              </button>
              <button
                type="button"
                onClick={acceptAll}
                className="btn-primary h-9 px-3 text-xs"
              >
                Accept all
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Cookie Settings"
        size="sm"
      >
        <div className="space-y-5">
          <p className="text-sm leading-relaxed text-text-secondary">
            Choose which cookies PinToTrip can use. Necessary cookies are always
            on. You can change this anytime.
          </p>

          <CookieRow
            title="Necessary"
            description="Required for sign-in, security, and basic app function."
            checked
            disabled
          />

          <CookieRow
            title="Analytics"
            description="Helps us understand how people use PinToTrip so we can improve it."
            checked={analytics}
            onChange={setAnalytics}
          />

          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <button
              type="button"
              onClick={rejectOptional}
              className="btn-secondary flex-1"
            >
              Necessary only
            </button>
            <button
              type="button"
              onClick={savePreferences}
              className="btn-secondary flex-1"
            >
              Save preferences
            </button>
            <button
              type="button"
              onClick={acceptAll}
              className="btn-primary flex-1"
            >
              Accept all
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

function CookieRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={cx(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-border",
          disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-5" : "translate-x-0"
          )}
        />
      </button>
    </div>
  );
}
