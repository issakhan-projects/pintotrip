"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { detectDeviceLanguage } from "@/services/users";
import { createTranslator } from "./t";
import { en } from "./messages/en";
import { getMessagesForLocale } from "./messages";
import type { TranslateFn, TranslateParams } from "./types";

type I18nContextValue = {
  locale: string;
  setLocale: (locale: string) => void;
  t: TranslateFn;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function normalizeLocale(value: string | undefined | null): string {
  if (!value?.trim()) return "en";
  const primary = value.trim().toLowerCase().split(/[-_]/)[0] ?? "en";
  return primary || "en";
}

export function I18nProvider({
  children,
  language,
}: {
  children: ReactNode;
  /** Override locale (e.g. from user profile). */
  language?: string | null;
}) {
  const [locale, setLocaleState] = useState(() =>
    normalizeLocale(
      language ||
        (typeof navigator !== "undefined" ? detectDeviceLanguage() : "en")
    )
  );

  useEffect(() => {
    if (language != null && String(language).trim() !== "") {
      setLocaleState(normalizeLocale(language));
    }
  }, [language]);

  const setLocale = useCallback((next: string) => {
    setLocaleState(normalizeLocale(next));
  }, []);

  const t = useMemo(() => {
    const messages = getMessagesForLocale(locale);
    return createTranslator(messages, en);
  }, [locale]);

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t]
  );

  return (
    <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Safe fallback for modules rendered outside the provider (SSR edge cases).
    const fallbackT = createTranslator(en, en);
    return {
      locale: "en",
      setLocale: () => undefined,
      t: fallbackT,
    };
  }
  return ctx;
}

/** Convenience: translate with the current locale from context. */
export function useT(): TranslateFn {
  return useI18n().t;
}

export type { TranslateFn, TranslateParams };
