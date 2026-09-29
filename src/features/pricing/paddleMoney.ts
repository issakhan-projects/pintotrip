/** Currencies Paddle stores without minor units. */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "CLP"]);

/** Convert Paddle lowest-unit amount string to a major-unit number. */
export function amountFromLowestUnit(
  amount: string,
  currencyCode: string
): number {
  const raw = Number.parseFloat(amount);
  if (!Number.isFinite(raw)) return 0;
  if (ZERO_DECIMAL.has(currencyCode.toUpperCase())) return raw;
  return raw / 100;
}

export function formatMoney(amount: number, currencyCode: string): string {
  const language =
    typeof navigator !== "undefined" ? navigator.language : "en-US";
  return new Intl.NumberFormat(language, {
    style: "currency",
    currency: currencyCode,
  }).format(amount);
}

/** Yearly compare-at: twelve × monthly charge, formatted for display. */
export function formatYearlyCompareAt(
  monthlyLowestUnit: string,
  currencyCode: string
): string {
  const monthly = amountFromLowestUnit(monthlyLowestUnit, currencyCode);
  return formatMoney(monthly * 12, currencyCode);
}
