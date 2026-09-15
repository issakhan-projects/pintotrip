/**
 * Live mid-market FX via Frankfurter (https://frankfurter.dev/).
 * No API key. Rates are daily reference rates.
 */

import type { ExchangeRateProvider } from "./types";

const FRANKFURTER_API = "https://api.frankfurter.dev";
const SOURCE =
  "Frankfurter (https://frankfurter.dev/) — mid-market reference rate";

export type FrankfurterRate = {
  date: string;
  base: string;
  quote: string;
  rate: number;
};

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Fetch mid-market rate for 1 `base` → `quote`.
 * @see https://frankfurter.dev/ — GET /v2/rate/{base}/{quote}
 */
export async function fetchFrankfurterRate(
  base: string,
  quote: string
): Promise<FrankfurterRate> {
  const from = normalizeCode(base);
  const to = normalizeCode(quote);
  if (!from || !to) {
    throw new Error("Currency codes are required.");
  }
  if (from === to) {
    return {
      date: new Date().toISOString().slice(0, 10),
      base: from,
      quote: to,
      rate: 1,
    };
  }

  const url = `${FRANKFURTER_API}/v2/rate/${encodeURIComponent(from.toLowerCase())}/${encodeURIComponent(to.toLowerCase())}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    let message = `Exchange rate unavailable (${response.status}).`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message?.trim()) message = body.message.trim();
    } catch {
      // keep status message
    }
    throw new Error(message);
  }

  const data = (await response.json()) as {
    date?: string;
    base?: string;
    quote?: string;
    rate?: number;
  };

  if (
    typeof data.rate !== "number" ||
    !Number.isFinite(data.rate) ||
    data.rate <= 0
  ) {
    throw new Error("Invalid exchange rate response.");
  }

  return {
    date: data.date?.trim() || new Date().toISOString().slice(0, 10),
    base: normalizeCode(data.base || from),
    quote: normalizeCode(data.quote || to),
    rate: data.rate,
  };
}

export const frankfurterExchangeRateProvider: ExchangeRateProvider = {
  name: "frankfurter",
  async getRate(from, to) {
    const result = await fetchFrankfurterRate(from, to);
    return {
      rate: result.rate,
      asOf: result.date,
    };
  },
};

export { SOURCE as FRANKFURTER_SOURCE };
