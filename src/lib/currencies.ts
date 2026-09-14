import cc from "currency-codes";

export type CurrencyOption = {
  code: string;
  name: string;
  label: string;
};

/** ISO 4217 currencies, sorted by code. */
export const CURRENCY_OPTIONS: CurrencyOption[] = cc.data
  .filter((c) => Boolean(c.code && c.currency))
  .map((c) => ({
    code: c.code,
    name: c.currency,
    label: `${c.code} — ${c.currency}`,
  }))
  .sort((a, b) => a.code.localeCompare(b.code));

/** Resolve a stored value (code or currency name) to an ISO 4217 code. */
export function resolveCurrencyCode(value: string | undefined | null): string {
  if (!value?.trim()) return "";
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  if (CURRENCY_OPTIONS.some((c) => c.code === upper)) return upper;

  const lower = trimmed.toLowerCase();
  const byName = CURRENCY_OPTIONS.find(
    (c) => c.name.toLowerCase() === lower
  );
  // Keep the saved string so the picker can still display it.
  return byName?.code ?? upper;
}
