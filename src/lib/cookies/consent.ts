const STORAGE_KEY = "pintototrip.cookie-consent";

export type CookieConsent = {
  /** Always true — required for the app to work. */
  necessary: true;
  /** Product analytics (e.g. PostHog). */
  analytics: boolean;
  updatedAt: string;
};

export const DEFAULT_CONSENT: CookieConsent = {
  necessary: true,
  analytics: false,
  updatedAt: "",
};

export function readCookieConsent(): CookieConsent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CookieConsent>;
    return {
      necessary: true,
      analytics: Boolean(parsed.analytics),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return null;
  }
}

export function writeCookieConsent(
  input: Pick<CookieConsent, "analytics">
): CookieConsent {
  const next: CookieConsent = {
    necessary: true,
    analytics: Boolean(input.analytics),
    updatedAt: new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(
      new CustomEvent("pintototrip:cookie-consent-changed", { detail: next })
    );
  }
  return next;
}

export const COOKIE_CONSENT_CHANGED_EVENT =
  "pintototrip:cookie-consent-changed";


export function hasAnalyticsConsent(): boolean {
  return readCookieConsent()?.analytics === true;
}

export const OPEN_COOKIE_SETTINGS_EVENT = "pintototrip:open-cookie-settings";

export function openCookieSettings(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_COOKIE_SETTINGS_EVENT));
}
