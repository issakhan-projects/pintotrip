/** UI locales that have message catalogs under `messages/`. */
export const UI_LOCALES = [
  { code: "en", label: "English", nativeLabel: "English", shortLabel: "EN" },
  { code: "ru", label: "Russian", nativeLabel: "Русский", shortLabel: "RU" },
  { code: "kz", label: "Kazakh", nativeLabel: "Қазақша", shortLabel: "KZ" },
] as const;

export type UiLocaleCode = (typeof UI_LOCALES)[number]["code"];

export const UI_LOCALE_CODES: readonly UiLocaleCode[] = UI_LOCALES.map(
  (l) => l.code
);

export const LOCALE_STORAGE_KEY = "pinttotrip.uiLocale";

/** Map browser / ISO codes onto a supported UI catalog. */
export function normalizeUiLocale(
  value: string | null | undefined
): UiLocaleCode {
  if (!value?.trim()) return "en";
  const primary = value.trim().toLowerCase().split(/[-_]/)[0] ?? "en";
  if (primary === "kk") return "kz";
  if ((UI_LOCALE_CODES as readonly string[]).includes(primary)) {
    return primary as UiLocaleCode;
  }
  return "en";
}

export function getUiLocaleOption(code: string) {
  const normalized = normalizeUiLocale(code);
  return UI_LOCALES.find((l) => l.code === normalized) ?? UI_LOCALES[0];
}

export function readStoredUiLocale(): UiLocaleCode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (!raw?.trim()) return null;
    return normalizeUiLocale(raw);
  } catch {
    return null;
  }
}

export function writeStoredUiLocale(code: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, normalizeUiLocale(code));
  } catch {
    // ignore quota / private mode
  }
}
