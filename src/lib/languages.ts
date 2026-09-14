import ISO6391 from "iso-639-1";

export type LanguageOption = {
  code: string;
  name: string;
  nativeName: string;
  label: string;
};

/** ISO 639-1 languages, sorted by English name. */
export const LANGUAGE_OPTIONS: LanguageOption[] = ISO6391.getAllCodes()
  .map((code) => {
    const name = ISO6391.getName(code);
    const nativeName = ISO6391.getNativeName(code);
    return {
      code,
      name,
      nativeName,
      label:
        nativeName && nativeName !== name
          ? `${name} (${nativeName})`
          : name,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

/**
 * Normalize a stored preference (e.g. "en", "en-US") to an ISO 639-1 code.
 * Returns "" when nothing is saved; keeps the saved string if unrecognized.
 */
export function resolveLanguageCode(value: string | undefined | null): string {
  if (!value?.trim()) return "";
  const trimmed = value.trim();
  const primary = trimmed.toLowerCase().split(/[-_]/)[0] ?? "";
  if (LANGUAGE_OPTIONS.some((l) => l.code === primary)) return primary;
  // Keep the saved string so the picker can still display it.
  return trimmed;
}
