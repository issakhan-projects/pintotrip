/**
 * Client/server helpers to fill itinerary free-time places via AI.
 * Temporary Next.js /api path for checking place fill before planTrip wiring.
 */

import { PLACE_CATEGORIES, type LeisureType, type PlaceCategory } from "@/types/trip-plan";
import type {
  TripPlannerAiRequest,
  TripPlannerAiRequestDestination,
  TripPlannerAiResponseDay,
  TripPlannerAiResponseLocationPlace,
  TripPlannerAiResponseNestedPlace,
  TripPlannerAiResponsePlace,
} from "@/types/trip-planner-ai-request";

const PLACE_CATEGORY_SET = new Set<string>(PLACE_CATEGORIES);

const LEISURE_HINT: Record<LeisureType, string> = {
  sightseeing: "landmarks, museums, historic districts, viewpoints",
  food: "restaurants, cafés, markets, food halls",
  nature: "parks, trails, beaches, outdoor scenery",
  nightlife: "evening venues, shows, night districts (lighter daytime)",
  shopping: "markets, malls, artisan streets",
  relaxation: "1–2 gentle places — parks, cafés, calm viewpoints",
  adventure: "active outdoor / signature experiences; keep days doable",
  family: "kid-friendly, shorter blocks, rest-friendly",
  mixed: "balanced mix of culture, food, and local highlights",
  custom: "prioritize the user's named activities when available locally",
  umrah: "worship first (Haram / Nabawi / ziyarat); avoid tourist filler",
};

function formatLeisurePreference(
  leisureType?: LeisureType,
  leisureCustom?: string
): string {
  if (!leisureType) return "Leisure preference: mixed / destination-first";
  if (leisureType === "custom") {
    const focus = leisureCustom?.trim();
    return focus
      ? `Leisure preference (hint): custom — prioritize: ${focus}`
      : `Leisure preference (hint): custom — ${LEISURE_HINT.custom}`;
  }
  return `Leisure preference (hint): ${leisureType} — ${LEISURE_HINT[leisureType]}`;
}

export const FILL_PLACES_SYSTEM_PROMPT = `You fill free-time windows with concrete places AND enrich non-flight routes with fare + booking link.

PART A — PLACES:
1. Work ONLY on the provided free-time slots (day + cityId + freeTime).
2. PRESERVE every existing {"locationId":"..."} entry — list them first unchanged.
3. Then ADD new places only when free time remains after saved places.
4. New places MUST use the locations subcollection shape (no googlePhotoUrl):
   {
     "id": "ascii-slug-id",
     "title": "",
     "description": "",
     "note": "",
     "cityId": "",
     "status": "planned",
     "category": "attraction|landmark|food|cafe|museum|park|viewpoint|market|nature|wellness|shopping|nightlife|beach|adventure|neighborhood|transport|other",
     "location": { "lat": 0, "lon": 0 },
     "city": { "id": "ascii-city-id", "name": "" },
     "country": { "id": "iso-alpha2-lowercase", "name": "" },
     "images": [],
     "price": { "amount": 0, "currency": "USD", "label": "Free" },
     "links": [{ "url": "https://...", "label": "" }],
     "confidence": 0.7,
     "source": { "type": "manual" },
     "ai": { "why": "", "model": "fillPlaces" }
   }
5. cityId / city.id / country.id must be English ASCII (never localized script).
6. Do NOT invent locationId values. Only echo ids from the slot's existing places.
7. Do NOT schedule places in stopType home cities.
8. Respect freeTime.durationMinutes (and start/end when present). Rough guide:
   - under 90 min → 0–1 new places
   - 90–240 → 1–2
   - 240–480 → 2–3
   - 480+ → 2–4
   Count saved locationIds toward the day's load — do not overfill.
9. leisureType is a preference hint, not a hard filter.
10. Prefer real named places with plausible lat/lon. Omit place price/links when unknown.

PART B — NON-FLIGHT ROUTES (price + link):
11. For each route in the input with transport NOT "flight", return fare + official booking/timetable URL when known.
12. NEVER add priceAmount / priceCurrency / priceLabel / link for transport "flight".
13. Use approximate one-way adult fare. Prefer trip currency when converting. priceLabel like "≈ 45 USD" or "from 12 EUR".
14. link must be https official operator / timetable / booking page. Omit if not reliable.
15. Identify each route by day + routeIndex (0-based index in that day's routes array).

OUTPUT SCHEMA:
{
  "itinerary": [
    {
      "day": 1,
      "date": "YYYY-MM-DD",
      "places": [
        {
          "cityId": "",
          "places": [
            { "locationId": "saved-id" },
            { "id": "new-slug", "title": "", "description": "", "cityId": "", "status": "planned", "category": "attraction", "location": { "lat": 0, "lon": 0 }, "city": { "id": "", "name": "" }, "country": { "id": "", "name": "" }, "images": [], "ai": { "why": "", "model": "fillPlaces" }, "source": { "type": "manual" }, "confidence": 0.7 }
          ]
        }
      ],
      "routes": [
        {
          "routeIndex": 0,
          "transport": "train",
          "priceAmount": 150,
          "priceCurrency": "SAR",
          "priceLabel": "≈ 150 SAR",
          "link": "https://example.com/book"
        }
      ]
    }
  ]
}

Return strict JSON only. Include routes[] only for non-flight legs that need price/link.`;

export function buildFillPlacesUserPrompt(input: {
  language?: string;
  leisureType?: LeisureType;
  leisureCustom?: string;
  currency?: string;
  destinationsJson: string;
  itineraryJson: string;
}): string {
  const leisure = formatLeisurePreference(input.leisureType, input.leisureCustom);

  return [
    `Language for titles/descriptions: ${input.language?.trim() || "en"}`,
    leisure,
    input.currency
      ? `Currency for place and non-flight route fares when known: ${input.currency}`
      : "Currency: use local or USD when known",
    "",
    "DESTINATIONS (context — city names, savedPlaces already reflected as locationId in slots):",
    input.destinationsJson,
    "",
    "ITINERARY TO FILL:",
    "- places[] = free-time city slots (saved locationId first, then new places)",
    "- routes[] = include non-flight legs with routeIndex; fill priceAmount/priceCurrency/priceLabel/link (never for flight)",
    input.itineraryJson,
    "",
    "Return itinerary with places filled and non-flight route fare/link enrichment.",
  ].join("\n");
}

function isAsciiId(value: string): boolean {
  const id = value.trim().toLowerCase();
  if (!id || id === "unknown") return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t || null;
}

function asNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function asHttpUrl(value: unknown): string | null {
  const s = asString(value);
  if (!s || !/^https?:\/\//i.test(s)) return null;
  return s;
}

function slugifyAscii(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function parseCategory(value: unknown): PlaceCategory | undefined {
  const s = asString(value)?.toLowerCase();
  if (!s || !PLACE_CATEGORY_SET.has(s)) return undefined;
  return s as PlaceCategory;
}

export function slimDestinationsForPrompt(
  destinations: Record<string, TripPlannerAiRequestDestination>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, dest] of Object.entries(destinations)) {
    if (!dest || dest.stopType === "home") continue;
    const cityId = (dest.cityId || key).trim().toLowerCase();
    if (!isAsciiId(cityId)) continue;
    out[cityId] = {
      cityId,
      cityName: dest.cityName,
      countryId: dest.countryId,
      countryName: dest.countryName,
      stopType: dest.stopType,
      ...(dest.leisureType ? { leisureType: dest.leisureType } : {}),
      ...(dest.cityInfo
        ? {
            cityInfo: {
              ...(typeof dest.cityInfo.lat === "number"
                ? { lat: dest.cityInfo.lat }
                : {}),
              ...(typeof dest.cityInfo.lon === "number"
                ? { lon: dest.cityInfo.lon }
                : {}),
              ...(dest.cityInfo.timezone
                ? { timezone: dest.cityInfo.timezone }
                : {}),
            },
          }
        : {}),
      savedPlaces: (dest.savedPlaces ?? [])
        .map((p) => p.id?.trim())
        .filter(Boolean)
        .map((id) => ({ id })),
    };
  }
  return out;
}

export function slimItineraryPlacesForPrompt(
  itinerary: TripPlannerAiResponseDay[]
): unknown[] {
  return itinerary.map((day) => ({
    day: day.day,
    date: day.date,
    places: (day.places ?? [])
      .filter((s) => s?.cityId && isAsciiId(s.cityId))
      .map((s) => ({
        cityId: s.cityId.trim().toLowerCase(),
        ...(s.leisureType ? { leisureType: s.leisureType } : {}),
        freeTime: s.freeTime ?? {},
        places: (s.places ?? [])
          .map((p) =>
            "locationId" in p && p.locationId?.trim()
              ? { locationId: p.locationId.trim() }
              : null
          )
          .filter(Boolean),
      })),
    routes: (day.routes ?? []).map((route, routeIndex) => ({
      routeIndex,
      transport: route.transport,
      from: {
        name: route.from?.name,
        city: route.from?.city,
        ...(route.from?.code ? { code: route.from.code } : {}),
      },
      to: {
        name: route.to?.name,
        city: route.to?.city,
        ...(route.to?.code ? { code: route.to.code } : {}),
      },
      // Existing fare fields if already set (AI may keep / refine for non-flight).
      ...(route.transport !== "flight" && route.priceAmount != null
        ? { priceAmount: route.priceAmount }
        : {}),
      ...(route.transport !== "flight" && route.priceCurrency
        ? { priceCurrency: route.priceCurrency }
        : {}),
      ...(route.transport !== "flight" && route.priceLabel
        ? { priceLabel: route.priceLabel }
        : {}),
      ...(route.transport !== "flight" && route.link
        ? { link: route.link }
        : {}),
      needsFare:
        route.transport !== "flight" &&
        route.priceAmount == null &&
        !route.link,
    })),
  }));
}

function parseLocationPlace(
  row: Record<string, unknown>,
  fallback: {
    cityId: string;
    cityName: string;
    countryId: string;
    countryName: string;
  }
): TripPlannerAiResponseLocationPlace | null {
  const title = asString(row.title);
  if (!title) return null;

  const rawId = asString(row.id) || slugifyAscii(title);
  const id = isAsciiId(rawId) ? rawId.toLowerCase() : slugifyAscii(title);
  if (!isAsciiId(id)) return null;

  const locRaw =
    row.location && typeof row.location === "object"
      ? (row.location as Record<string, unknown>)
      : row;
  const lat = asNumber(locRaw.lat) ?? asNumber(row.lat);
  const lon = asNumber(locRaw.lon) ?? asNumber(row.lon);
  if (lat == null || lon == null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const cityIdRaw =
    asString(row.cityId) ||
    (row.city && typeof row.city === "object"
      ? asString((row.city as Record<string, unknown>).id)
      : null) ||
    fallback.cityId;
  const cityId = isAsciiId(cityIdRaw)
    ? cityIdRaw.toLowerCase()
    : fallback.cityId;

  const cityObj =
    row.city && typeof row.city === "object"
      ? (row.city as Record<string, unknown>)
      : {};
  const countryObj =
    row.country && typeof row.country === "object"
      ? (row.country as Record<string, unknown>)
      : {};

  const cityName = asString(cityObj.name) || fallback.cityName || cityId;
  const countryIdRaw = asString(countryObj.id) || fallback.countryId || "xx";
  const countryId = /^[a-z]{2}$/i.test(countryIdRaw)
    ? countryIdRaw.toLowerCase()
    : fallback.countryId || "xx";
  const countryName =
    asString(countryObj.name) || fallback.countryName || countryId;

  const description = asString(row.description) || title;
  const note = asString(row.note) ?? undefined;
  const category = parseCategory(row.category);

  const priceRaw =
    row.price && typeof row.price === "object"
      ? (row.price as Record<string, unknown>)
      : null;
  const priceAmount = priceRaw
    ? asNumber(priceRaw.amount)
    : asNumber(row.priceAmount);
  const priceCurrency =
    (priceRaw ? asString(priceRaw.currency) : null) ||
    asString(row.priceCurrency);
  const priceLabel =
    (priceRaw ? asString(priceRaw.label) : null) || asString(row.priceLabel);

  const links: Array<{ url: string; label?: string }> = [];
  if (Array.isArray(row.links)) {
    for (const item of row.links) {
      if (!item || typeof item !== "object") continue;
      const url = asHttpUrl((item as Record<string, unknown>).url);
      if (!url) continue;
      const label =
        asString((item as Record<string, unknown>).label) ?? undefined;
      links.push({ url, ...(label ? { label } : {}) });
    }
  } else {
    const single = asHttpUrl(row.link);
    if (single) links.push({ url: single });
  }

  const aiRaw =
    row.ai && typeof row.ai === "object"
      ? (row.ai as Record<string, unknown>)
      : null;
  const why =
    (aiRaw ? asString(aiRaw.why) : null) || asString(row.why) || description;
  const confidence = asNumber(row.confidence) ?? 0.7;

  return {
    id,
    title,
    description,
    ...(note ? { note } : {}),
    cityId,
    status: "planned",
    ...(category ? { category } : {}),
    location: { lat, lon },
    city: { id: cityId, name: cityName },
    country: { id: countryId, name: countryName },
    images: [],
    ...(priceAmount != null || priceCurrency || priceLabel
      ? {
          price: {
            ...(priceAmount != null && priceAmount >= 0
              ? { amount: priceAmount }
              : {}),
            ...(priceCurrency && /^[A-Za-z]{3}$/.test(priceCurrency)
              ? { currency: priceCurrency.toUpperCase() }
              : {}),
            ...(priceLabel ? { label: priceLabel } : {}),
          },
        }
      : {}),
    ...(links.length ? { links } : {}),
    confidence: Math.min(1, Math.max(0, confidence)),
    source: { type: "manual" },
    ai: { why, model: "fillPlaces" },
  };
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1]?.trim() || trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("No JSON object in AI places response.");
  }
  return JSON.parse(body.slice(start, end + 1)) as unknown;
}

/**
 * Merge AI place fill + non-flight route fare/link into the itinerary.
 * Saved `{ locationId }` from the original slot stay first.
 * Flights never receive price/link.
 */
export function mergeAiPlacesIntoItinerary(
  itinerary: TripPlannerAiResponseDay[],
  aiRaw: unknown,
  destinations: Record<string, TripPlannerAiRequestDestination>
): TripPlannerAiResponseDay[] {
  if (!aiRaw || typeof aiRaw !== "object") return itinerary;
  const body = aiRaw as Record<string, unknown>;
  const daysRaw = Array.isArray(body.itinerary) ? body.itinerary : [];

  const aiByKey = new Map<
    string,
    Map<string, TripPlannerAiResponseNestedPlace[]>
  >();
  const routeFareByKey = new Map<
    string,
    Map<
      number,
      {
        priceAmount?: number;
        priceCurrency?: string;
        priceLabel?: string;
        link?: string;
      }
    >
  >();

  for (const dayRow of daysRaw) {
    if (!dayRow || typeof dayRow !== "object") continue;
    const d = dayRow as Record<string, unknown>;
    const dayNum = asNumber(d.day);
    const date = asString(d.date);
    if (dayNum == null || !date) continue;
    const key = `${Math.floor(dayNum)}:${date}`;
    const cityMap = new Map<string, TripPlannerAiResponseNestedPlace[]>();

    for (const slotRow of Array.isArray(d.places) ? d.places : []) {
      if (!slotRow || typeof slotRow !== "object") continue;
      const s = slotRow as Record<string, unknown>;
      const cityIdRaw = asString(s.cityId);
      if (!cityIdRaw || !isAsciiId(cityIdRaw)) continue;
      const cityId = cityIdRaw.toLowerCase();
      const dest = destinations[cityId];
      const allowed = new Set(
        (dest?.savedPlaces ?? []).map((p) => p.id).filter(Boolean)
      );
      const fallback = {
        cityId,
        cityName: dest?.cityName ?? cityId,
        countryId: dest?.countryId ?? "xx",
        countryName: dest?.countryName ?? "",
      };

      const places: TripPlannerAiResponseNestedPlace[] = [];
      const seenSaved = new Set<string>();
      const seenNew = new Set<string>();

      for (const p of Array.isArray(s.places) ? s.places : []) {
        if (!p || typeof p !== "object") continue;
        const row = p as Record<string, unknown>;
        const locationId = asString(row.locationId);
        if (locationId) {
          if (allowed.size > 0 && !allowed.has(locationId)) continue;
          if (seenSaved.has(locationId)) continue;
          seenSaved.add(locationId);
          places.push({ locationId });
          continue;
        }
        const loc = parseLocationPlace(row, fallback);
        if (!loc || seenNew.has(loc.id)) continue;
        seenNew.add(loc.id);
        places.push(loc);
      }
      cityMap.set(cityId, places);
    }
    aiByKey.set(key, cityMap);
    aiByKey.set(`date:${date}`, cityMap);

    const fareMap = new Map<
      number,
      {
        priceAmount?: number;
        priceCurrency?: string;
        priceLabel?: string;
        link?: string;
      }
    >();
    for (const routeRow of Array.isArray(d.routes) ? d.routes : []) {
      if (!routeRow || typeof routeRow !== "object") continue;
      const r = routeRow as Record<string, unknown>;
      const transport = asString(r.transport)?.toLowerCase();
      if (transport === "flight") continue;

      const routeIndex = asNumber(r.routeIndex);
      if (routeIndex == null || routeIndex < 0) continue;

      const priceAmount = asNumber(r.priceAmount);
      const priceCurrency = asString(r.priceCurrency);
      const priceLabel = asString(r.priceLabel);
      const link = asHttpUrl(r.link);
      if (
        priceAmount == null &&
        !priceCurrency &&
        !priceLabel &&
        !link
      ) {
        continue;
      }

      fareMap.set(Math.floor(routeIndex), {
        ...(priceAmount != null && priceAmount >= 0
          ? { priceAmount }
          : {}),
        ...(priceCurrency && /^[A-Za-z]{3}$/.test(priceCurrency)
          ? { priceCurrency: priceCurrency.toUpperCase() }
          : {}),
        ...(priceLabel ? { priceLabel } : {}),
        ...(link ? { link } : {}),
      });
    }
    if (fareMap.size > 0) {
      routeFareByKey.set(key, fareMap);
      routeFareByKey.set(`date:${date}`, fareMap);
    }
  }

  return itinerary.map((day) => {
    const key = `${day.day}:${day.date}`;
    const cityMap =
      aiByKey.get(key) || aiByKey.get(`date:${day.date}`) || new Map();
    const fareMap =
      routeFareByKey.get(key) ||
      routeFareByKey.get(`date:${day.date}`) ||
      new Map();

    const places: TripPlannerAiResponsePlace[] = (day.places ?? []).map(
      (slot) => {
        const cityId = slot.cityId.trim().toLowerCase();
        const dest = destinations[cityId];
        const allowed = new Set(
          (dest?.savedPlaces ?? []).map((p) => p.id).filter(Boolean)
        );

        const saved: TripPlannerAiResponseNestedPlace[] = [];
        const seenSaved = new Set<string>();
        for (const p of slot.places ?? []) {
          if (!("locationId" in p) || !p.locationId?.trim()) continue;
          const id = p.locationId.trim();
          if (allowed.size > 0 && !allowed.has(id)) continue;
          if (seenSaved.has(id)) continue;
          seenSaved.add(id);
          saved.push({ locationId: id });
        }

        const fromAi = cityMap.get(cityId) ?? [];
        const merged: TripPlannerAiResponseNestedPlace[] = [...saved];
        const seenNew = new Set<string>();
        for (const p of fromAi) {
          if ("locationId" in p) {
            const id = p.locationId.trim();
            if (!id || seenSaved.has(id)) continue;
            if (allowed.size > 0 && !allowed.has(id)) continue;
            seenSaved.add(id);
            merged.push({ locationId: id });
            continue;
          }
          if (seenNew.has(p.id)) continue;
          seenNew.add(p.id);
          merged.push(p);
        }

        return { ...slot, cityId, places: merged };
      }
    );

    const routes = (day.routes ?? []).map((route, routeIndex) => {
      if (route.transport === "flight") {
        // Strip any fare fields that might have leaked onto flights.
        const {
          priceAmount: _a,
          priceCurrency: _c,
          priceLabel: _l,
          link: _link,
          ...rest
        } = route;
        void _a;
        void _c;
        void _l;
        void _link;
        return rest;
      }

      const fare = fareMap.get(routeIndex);
      if (!fare) return route;

      return {
        ...route,
        ...(fare.priceAmount != null ? { priceAmount: fare.priceAmount } : {}),
        ...(fare.priceCurrency ? { priceCurrency: fare.priceCurrency } : {}),
        ...(fare.priceLabel ? { priceLabel: fare.priceLabel } : {}),
        ...(fare.link ? { link: fare.link } : {}),
      };
    });

    return { ...day, places, routes };
  });
}

export function buildFillPlacesPayload(
  request: TripPlannerAiRequest,
  itinerary: TripPlannerAiResponseDay[],
  language?: string
): {
  system: string;
  user: string;
} {
  return {
    system: FILL_PLACES_SYSTEM_PROMPT,
    user: buildFillPlacesUserPrompt({
      language,
      leisureType: request.trip.leisureType,
      leisureCustom: request.trip.leisureCustom,
      currency: request.trip.currency,
      destinationsJson: JSON.stringify(
        slimDestinationsForPrompt(request.destinations)
      ),
      itineraryJson: JSON.stringify(slimItineraryPlacesForPrompt(itinerary)),
    }),
  };
}
