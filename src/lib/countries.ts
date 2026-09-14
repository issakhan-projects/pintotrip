import { COUNTRIES, getFlagEmoji } from "country-flag-select";

export type CountryOption = {
  code: string;
  name: string;
  label: string;
};

/** Countries with flag emoji labels, sorted by name. */
export const COUNTRY_OPTIONS: CountryOption[] = COUNTRIES.map((c) => ({
  code: c.code,
  name: c.name,
  label: `${getFlagEmoji(c.code)} ${c.name}`,
})).sort((a, b) => a.name.localeCompare(b.name));

/** Resolve a stored profile value (name or alpha-2 code) to an ISO alpha-2 code. */
export function resolveCountryCode(value: string | undefined | null): string {
  if (!value?.trim()) return "";
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  if (COUNTRIES.some((c) => c.code === upper)) return upper;

  const lower = trimmed.toLowerCase();
  const exact = COUNTRIES.find((c) => c.name.toLowerCase() === lower);
  if (exact) return exact.code;

  const fuzzy = COUNTRIES.find(
    (c) =>
      c.name.toLowerCase().includes(lower) ||
      lower.includes(c.name.toLowerCase())
  );
  // Only return a real ISO code — never echo localized names into ids.
  return fuzzy?.code ?? "";
}

/** Resolve ISO alpha-2 code to English country name. */
export function countryNameFromCode(code: string | undefined | null): string {
  if (!code?.trim()) return "";
  return (
    COUNTRIES.find((c) => c.code === code.trim().toUpperCase())?.name ?? ""
  );
}
