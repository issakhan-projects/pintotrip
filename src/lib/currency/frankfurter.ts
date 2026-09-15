/**
 * Live mid-market FX via Frankfurter (https://frankfurter.dev/).
 * No API key. Rates are daily reference rates — cache generously.
 */

const FRANKFURTER_API = "https://api.frankfurter.dev";
const RATE_TTL_MS = 60 * 60 * 1000; // 1 hour — underlying data is daily

export type FrankfurterRate = {
  date: string;
  base: string;
  quote: string;
  rate: number;
};

type CacheEntry = {
  value: FrankfurterRate;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<FrankfurterRate>>();

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

  const key = `${from}:${to}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const pending = inflight.get(key);
  if (pending) return pending;

  const request = (async () => {
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

    const result: FrankfurterRate = {
      date: data.date?.trim() || new Date().toISOString().slice(0, 10),
      base: normalizeCode(data.base || from),
      quote: normalizeCode(data.quote || to),
      rate: data.rate,
    };

    cache.set(key, { value: result, expiresAt: Date.now() + RATE_TTL_MS });
    return result;
  })();

  inflight.set(key, request);
  try {
    return await request;
  } finally {
    inflight.delete(key);
  }
}
