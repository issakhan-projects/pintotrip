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
import {
  normalizeUiLocale,
  readStoredUiLocale,
  writeStoredUiLocale,
  type UiLocaleCode,
} from "./locales";
import type { TranslateFn, TranslateParams } from "./types";

type I18nContextValue = {
  locale: UiLocaleCode;
  setLocale: (locale: string) => void;
  t: TranslateFn;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  language,
}: {
  children: ReactNode;
  /** Override locale (e.g. from user profile). */
  language?: string | null;
}) {
  const [locale, setLocaleState] = useState<UiLocaleCode>(() =>
    language != null && String(language).trim() !== ""
      ? normalizeUiLocale(language)
      : "en"
  );

  // Guest preference / device language — applied after mount to avoid SSR mismatch.
  useEffect(() => {
    if (language != null && String(language).trim() !== "") return;
    const stored = readStoredUiLocale();
    if (stored) {
      setLocaleState(stored);
      return;
    }
    setLocaleState(normalizeUiLocale(detectDeviceLanguage()));
  }, [language]);

  useEffect(() => {
    if (language != null && String(language).trim() !== "") {
      const next = normalizeUiLocale(language);
      setLocaleState(next);
      writeStoredUiLocale(next);
    }
  }, [language]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale === "kz" ? "kk" : locale;
    }
  }, [locale]);

  const setLocale = useCallback((next: string) => {
    const code = normalizeUiLocale(next);
    setLocaleState(code);
    writeStoredUiLocale(code);
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
