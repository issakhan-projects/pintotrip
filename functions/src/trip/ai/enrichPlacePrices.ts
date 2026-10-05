/**
 * After AI invents place prices, resolve real adult ticket/entry costs:
 * 1) placesLocation Firestore cache (by countryId + cityId + ascii place id)
 * 2) ONE cheap GPT web_search (search_context_size=low) for cache misses
 * 3) Persist looked-up prices back to placesLocation
 *
 * Soft-fails: keeps AI prices when cache+web miss or error.
 */

import { logger } from "firebase-functions";
import { completePlacePricesWebSearch } from "../../shared/openai";
import {
  findCachedPlace,
  getPlacesForLocation,
  hasFreshCachedPrice,
  resolvePlaceDocId,
  resolvePlacesLocationIds,
  setPlaceLocationPrice,
  type PlacesCityCache,
  type PlacesLocationIds,
  type PlacesLocationPrice,
} from "../../shared/placesLocation";
import { extractJsonObject } from "./fillPlacesAi";
import type {
  TripPlannerAiRequestDestination,
  TripPlannerAiResponseDay,
  TripPlannerAiResponseLocationPlace,
  TripPlannerAiResponseNestedPlace,
} from "./tripPlannerAiTypes";

/** Cap web lookups so one low-context search stays cheap. */
const MAX_WEB_LOOKUP = 18;
const CONCURRENCY = 4;

/** Skip meal venues — prices vary by dish; focus on ticketed places. */
const SKIP_PRICE_CATEGORIES = new Set(["food", "cafe"]);

const SYSTEM_PROMPT = `You look up CURRENT adult ticket / entry / activity prices from the web.
Return ONLY a JSON object (no markdown). Prefer official ticket sites.
Use the requested currency when converting. If free, amount=0. Omit unknowns.
Schema:
{"prices":[{"id":"ascii-place-id","amount":30,"currency":"EUR","label":"≈ 30 EUR adult","link":"https://..."}]}`;

type PriceJob = {
  key: string;
  place: TripPlannerAiResponseLocationPlace;
  placeDocId: string;
  ids: PlacesLocationIds | null;
};

type ResolvedPrice = {
  amount: number;
  currency: string;
  label?: string;
  link?: string;
};

function isLocationPlace(
  place: TripPlannerAiResponseNestedPlace
): place is TripPlannerAiResponseLocationPlace {
  return Boolean(
    place &&
      typeof place === "object" &&
      "title" in place &&
      "location" in place &&
      !("locationId" in place)
  );
}

function jobKey(
  countryId: string,
  locationId: string,
  placeDocId: string
): string {
  return `${countryId}/${locationId}/${placeDocId}`;
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
}

function shouldLookupPrice(place: TripPlannerAiResponseLocationPlace): boolean {
  const category = place.category?.trim().toLowerCase();
  if (category && SKIP_PRICE_CATEGORIES.has(category)) return false;
  const title = place.title?.trim();
  return Boolean(title);
}

function fromCachedPrice(price: PlacesLocationPrice): ResolvedPrice {
  return {
    amount: price.amount,
    currency: price.currency,
    ...(price.label ? { label: price.label } : {}),
    ...(price.link ? { link: price.link } : {}),
  };
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asHttpUrl(value: unknown): string | null {
  const s = asString(value);
  if (!s || !/^https:\/\//i.test(s)) return null;
  return s;
}

function parseWebPrices(
  text: string,
  allowedIds: Set<string>
): Map<string, ResolvedPrice> {
  const out = new Map<string, ResolvedPrice>();
  let parsed: unknown;
  try {
    parsed = extractJsonObject(text);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== "object") return out;
  const rows = (parsed as Record<string, unknown>).prices;
  if (!Array.isArray(rows)) return out;

  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = asString(row.id)?.toLowerCase();
    if (!id || !allowedIds.has(id)) continue;
    const amount = asNumber(row.amount);
    const currency = asString(row.currency);
    if (amount == null || amount < 0 || !currency || !/^[A-Za-z]{3}$/.test(currency)) {
      continue;
    }
    const label = asString(row.label) ?? undefined;
    const link = asHttpUrl(row.link) ?? undefined;
    out.set(id, {
      amount,
      currency: currency.toUpperCase(),
      ...(label ? { label } : {}),
      ...(link ? { link } : {}),
    });
  }
  return out;
}

function buildWebSearchUserPrompt(params: {
  currency: string;
  places: Array<{
    id: string;
    title: string;
    city: string;
    country: string;
    category?: string;
  }>;
}): string {
  const lines = params.places.map((p, i) => {
    const cat = p.category ? ` category=${p.category}` : "";
    return `${i + 1}. id=${p.id} title="${p.title}" city=${p.city} country=${p.country}${cat}`;
  });
  return [
    `Currency preference: ${params.currency}`,
    "Look up the current standard adult ticket/entry price for each place (official site preferred).",
    "Return JSON only with prices[] for ids you found.",
    "",
    "Places:",
    ...lines,
  ].join("\n");
}

function applyPriceToPlace(
  place: TripPlannerAiResponseLocationPlace,
  price: ResolvedPrice
): TripPlannerAiResponseLocationPlace {
  const label =
    price.label ||
    (price.amount === 0
      ? "Free"
      : `≈ ${price.amount} ${price.currency}`);
  const links = [...(place.links ?? [])];
  if (price.link && !links.some((l) => l.url === price.link)) {
    links.unshift({ url: price.link, label: "Tickets" });
  }
  return {
    ...place,
    price: {
      amount: price.amount,
      currency: price.currency,
      label,
    },
    ...(links.length ? { links } : {}),
  };
}

/**
 * Cache → one cheap GPT web_search for misses → save prices → apply to itinerary.
 */
export async function enrichItineraryPlacePrices(
  itinerary: TripPlannerAiResponseDay[],
  destinations: Record<string, TripPlannerAiRequestDestination>,
  currency = "USD"
): Promise<{
  itinerary: TripPlannerAiResponseDay[];
  metrics: { model: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number }; cost: number } | null;
  stats: {
    uniquePlaces: number;
    cacheHits: number;
    webLookups: number;
    webHits: number;
  };
}> {
  const jobsByKey = new Map<string, PriceJob>();

  for (const day of itinerary) {
    for (const slot of day.places ?? []) {
      const dest = destinations[slot.cityId];
      for (const nested of slot.places ?? []) {
        if (!isLocationPlace(nested) || !shouldLookupPrice(nested)) continue;
        const title = nested.title.trim();
        const cityId =
          nested.city.id?.trim() ||
          nested.cityId?.trim() ||
          dest?.cityId?.trim() ||
          "";
        const countryId =
          nested.country.id?.trim() || dest?.countryId?.trim() || "";
        const placeDocId = resolvePlaceDocId({
          placeSlug: nested.id,
          title,
        });
        if (!placeDocId) continue;

        const ids = resolvePlacesLocationIds({
          cityName: nested.city.name || dest?.cityName || cityId,
          countryName: nested.country.name || dest?.countryName || countryId,
          cityId: cityId || dest?.cityId,
          countryId: countryId || dest?.countryId,
        });

        const key = ids
          ? jobKey(ids.countryId, ids.locationId, placeDocId)
          : `noid|${placeDocId}|${title.toLowerCase()}`;
        if (jobsByKey.has(key)) continue;

        jobsByKey.set(key, {
          key,
          place: nested,
          placeDocId,
          ids,
        });
      }
    }
  }

  if (jobsByKey.size === 0) {
    return {
      itinerary,
      metrics: null,
      stats: { uniquePlaces: 0, cacheHits: 0, webLookups: 0, webHits: 0 },
    };
  }

  const jobs = [...jobsByKey.values()];
  const resolved = new Map<string, ResolvedPrice>();

  // --- 1) Batch-load placesLocation cache ---
  const cityCache = new Map<string, PlacesCityCache>();
  const cityIdsSeen = new Map<string, PlacesLocationIds>();
  for (const job of jobs) {
    if (!job.ids) continue;
    const cityKey = `${job.ids.countryId}/${job.ids.locationId}`;
    if (!cityIdsSeen.has(cityKey)) cityIdsSeen.set(cityKey, job.ids);
  }

  await mapPool([...cityIdsSeen.entries()], CONCURRENCY, async ([cityKey, ids]) => {
    cityCache.set(cityKey, await getPlacesForLocation(ids));
  });

  let cacheHits = 0;
  const misses: PriceJob[] = [];

  for (const job of jobs) {
    if (job.ids) {
      const cityKey = `${job.ids.countryId}/${job.ids.locationId}`;
      const cache = cityCache.get(cityKey);
      const entry = cache
        ? findCachedPlace(cache, { placeDocId: job.placeDocId })
        : null;
      if (hasFreshCachedPrice(entry)) {
        resolved.set(job.key, fromCachedPrice(entry.price));
        cacheHits += 1;
        continue;
      }
    }
    misses.push(job);
  }

  // --- 2) ONE cheap web_search for cache misses (capped) ---
  let webHits = 0;
  let metrics: {
    model: string;
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    cost: number;
  } | null = null;

  const toLookup = misses.slice(0, MAX_WEB_LOOKUP);
  if (toLookup.length > 0) {
    const allowedIds = new Set(
      toLookup.map((j) => j.placeDocId.toLowerCase())
    );
    const preferredCurrency =
      typeof currency === "string" && /^[A-Za-z]{3}$/.test(currency.trim())
        ? currency.trim().toUpperCase()
        : "USD";

    try {
      const result = await completePlacePricesWebSearch({
        system: SYSTEM_PROMPT,
        user: buildWebSearchUserPrompt({
          currency: preferredCurrency,
          places: toLookup.map((j) => ({
            id: j.placeDocId,
            title: j.place.title.trim(),
            city: j.place.city.name || j.place.cityId,
            country: j.place.country.name || j.place.country.id,
            ...(j.place.category ? { category: j.place.category } : {}),
          })),
        }),
      });
      metrics = result.metrics;
      const found = parseWebPrices(result.text, allowedIds);
      const now = Date.now();

      for (const job of toLookup) {
        const hit = found.get(job.placeDocId.toLowerCase());
        if (!hit) continue;
        resolved.set(job.key, hit);
        webHits += 1;

        if (job.ids) {
          await setPlaceLocationPrice({
            ids: job.ids,
            placeDocId: job.placeDocId,
            price: {
              amount: hit.amount,
              currency: hit.currency,
              pricedAt: now,
              source: "web_search",
              ...(hit.label ? { label: hit.label } : {}),
              ...(hit.link ? { link: hit.link } : {}),
            },
            stub: {
              id: job.placeDocId,
              title: job.place.title.trim(),
              location: job.place.location,
              cityName: job.place.city.name,
              countryName: job.place.country.name,
              cityId: job.place.city.id || job.place.cityId || job.ids.locationId,
            },
          });
        }
      }
    } catch (err) {
      logger.warn("enrichPlacePrices web search failed", {
        missCount: toLookup.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("enrichPlacePrices finished", {
    uniquePlaces: jobs.length,
    cacheHits,
    webLookups: toLookup.length,
    webHits,
    skippedOverCap: Math.max(0, misses.length - MAX_WEB_LOOKUP),
    cost: metrics?.cost ?? 0,
  });

  if (resolved.size === 0) {
    return {
      itinerary,
      metrics,
      stats: {
        uniquePlaces: jobs.length,
        cacheHits,
        webLookups: toLookup.length,
        webHits,
      },
    };
  }

  function applyResolved(
    nested: TripPlannerAiResponseNestedPlace,
    slotCityId: string
  ): TripPlannerAiResponseNestedPlace {
    if (!isLocationPlace(nested) || !shouldLookupPrice(nested)) return nested;
    const placeDocId = resolvePlaceDocId({
      placeSlug: nested.id,
      title: nested.title,
    });
    if (!placeDocId) return nested;
    const dest = destinations[slotCityId];
    const ids = resolvePlacesLocationIds({
      cityName: nested.city.name || dest?.cityName || "",
      countryName: nested.country.name || dest?.countryName || "",
      cityId: nested.city.id || nested.cityId || dest?.cityId || "",
      countryId: nested.country.id || dest?.countryId || "",
    });
    const key = ids
      ? jobKey(ids.countryId, ids.locationId, placeDocId)
      : `noid|${placeDocId}|${nested.title.trim().toLowerCase()}`;
    const hit = resolved.get(key);
    if (!hit) return nested;
    return applyPriceToPlace(nested, hit);
  }

  return {
    itinerary: itinerary.map((day) => ({
      ...day,
      places: (day.places ?? []).map((slot) => ({
        ...slot,
        places: (slot.places ?? []).map((nested) =>
          applyResolved(nested, slot.cityId)
        ),
      })),
    })),
    metrics,
    stats: {
      uniquePlaces: jobs.length,
      cacheHits,
      webLookups: toLookup.length,
      webHits,
    },
  };
}
