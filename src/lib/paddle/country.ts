/**
 * Resolve a Paddle-safe ISO country code from request headers.
 *
 * Pass the result to client PricePreview only when present.
 * If absent, omit country entirely so Paddle auto-detects from the visitor IP.
 *
 * App-side sentinels (OTHERS, unknown, XX) must never be sent to Paddle.
 */

const INVALID_COUNTRY_SENTINELS = new Set([
  "XX",
  "T1",
  "A1",
  "A2",
  "O1",
  "OTHERS",
  "OTHER",
  "UNKNOWN",
  "ZZ",
]);

/** Two-letter ISO 3166-1 alpha-2, excluding CDN/geo unknown sentinels. */
export function isPaddleCountryCode(
  value: string | null | undefined
): value is string {
  if (!value) return false;
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return false;
  if (INVALID_COUNTRY_SENTINELS.has(code)) return false;
  return true;
}

/**
 * Read country from common edge headers (Vercel, Cloudflare).
 * Returns uppercase ISO alpha-2, or `undefined` when unknown.
 */
export function resolvePaddleCountryCode(
  headersList: Headers
): string | undefined {
  const candidates = [
    headersList.get("x-vercel-ip-country"),
    headersList.get("cf-ipcountry"),
    headersList.get("x-country-code"),
  ];

  for (const raw of candidates) {
    if (isPaddleCountryCode(raw)) {
      return raw.trim().toUpperCase();
    }
  }

  return undefined;
}
