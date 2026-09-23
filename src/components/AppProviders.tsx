"use client";

import type { ReactNode } from "react";
import { I18nProvider } from "@/i18n";

/**
 * Client providers for the app shell (i18n, etc.).
 * Locale syncs from the signed-in profile via `I18nLocaleSync` in AppShell.
 */
export function AppProviders({
  children,
  language,
}: {
  children: ReactNode;
  language?: string | null;
}) {
  return <I18nProvider language={language}>{children}</I18nProvider>;
}
