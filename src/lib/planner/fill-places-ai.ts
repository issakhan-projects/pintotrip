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
  sightseeing:
    "landmarks, museums, guided cultural tours, historic districts, viewpoints, performances",
  food: "restaurants, cafés, markets, food halls, tasting / cooking experiences",
  nature:
    "parks, trails, beaches, boat/water outings, outdoor scenery and nature tours",
  nightlife:
    "evening venues, shows/performances, night districts (lighter daytime)",
  shopping: "markets, malls, artisan streets, craft workshops",
  relaxation:
    "1–2 gentle picks — parks, cafés, spas/wellness, calm viewpoints, soft evening shows",
  adventure:
    "active outdoor experiences, adventure tours, signature activities; keep days doable",
  family:
    "kid-friendly tours/experiences, shorter blocks, rest-friendly shows or parks",
  mixed:
    "balanced mix of places, tours, local experiences, food, and culture",
  custom: "prioritize the user's named activities/experiences when available locally",
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

const FOOD_PLACE_CATEGORIES = new Set<PlaceCategory>(["food", "cafe", "market"]);

const MEAL_TYPE_HINT: Record<
  "default" | "halal" | "vegetarian" | "kosher" | "other",
  string
> = {
  default: "no dietary filter — recommend popular local food freely",
  halal:
    "HARD FILTER: only halal / halal-friendly dining; NEVER pork, bacon, ham, lard, non-halal meat, or alcohol-centric bars — popularity does not override",
  vegetarian:
    "HARD FILTER: only vegetarian-friendly dining; NEVER meat or fish as the focus",
  kosher:
    "HARD FILTER: only kosher-friendly dining; NEVER pork, shellfish, or non-kosher meat",
  other: "HARD FILTER: strictly match mealCustom — never recommend violating dishes",
};

export const FILL_PLACES_SYSTEM_PROMPT = `You fill free-time windows with concrete places AND bookable tourist activities/experiences, popular where-to-eat dining, AND enrich non-flight routes with fare + booking link.

PART A — PLACES + ACTIVITIES / EXPERIENCES:
1. Work ONLY on the provided free-time slots (day + cityId + freeTime).
2. PRESERVE every existing {"locationId":"..."} entry in that slot — list them first unchanged.
3. Then ADD new recommendations only when free time remains after saved places.
   Mix static sights WITH real things a traveler can DO:
   - tours / guided experiences (walking tours, museum tours, day trips)
   - boat / water experiences (cruises, ferries-as-sightseeing, kayaking)
   - cultural experiences (workshops, ceremonies, heritage visits)
   - shows and performances (theater, concerts, light shows, dinner shows)
   - outdoor activities (hikes, bike rides, parks with an activity angle)
   - wellness experiences (spa, hammam, thermal baths)
   - local experiences (cooking class, craft workshop, neighborhood walk with a host)
   - entertainment and short paid activities that fit the remaining freeTime
   Prefer named operators / venues / ticketed products over vague labels
   ("Bosphorus sunset cruise" not "do a boat trip").
4. New entries MUST use the locations subcollection shape (no googlePhotoUrl):
   {
     "id": "ascii-slug-id",
     "title": "",
     "description": "",
     "note": "",
     "cityId": "",
     "status": "planned",
     "category": "attraction|landmark|food|cafe|museum|park|viewpoint|market|nature|wellness|shopping|nightlife|beach|adventure|neighborhood|transport|tour|experience|show|other",
     "location": { "lat": 0, "lon": 0 },
     "city": { "id": "ascii-city-id", "name": "" },
     "country": { "id": "iso-alpha2-lowercase", "name": "" },
     "images": [],
     "price": { "amount": 0, "currency": "USD", "label": "Free" },
     "links": [{ "url": "https://...", "label": "Tickets" }],
     "bestVisitTime": { "from": "10:00", "to": "13:00" },
     "durationMinutes": 180,
     "confidence": 0.7,
     "source": { "type": "manual" },
     "ai": { "why": "", "model": "fillPlaces" }
   }
4a. Category guidance for activities:
    - tour → guided / ticketed tours and day trips
    - experience → bookable tourist experiences (boat trips, workshops, tastings, local activities)
    - show → performances, concerts, theaters, spectacle shows
    - adventure / wellness / nightlife → keep using those when they fit better
5. cityId / city.id / country.id must be English ASCII (never localized script).
6. locationId values must come from destinations[].savedPlaces[].id or from the slot's existing places. Never invent locationIds.
7. NO DUPLICATES ACROSS DAYS: each locationId, each new place id, and each place title (same city) may appear on at most ONE day — across BOTH places[] and whereToEat[].
7b. EVERY place (saved locationId refs AND new places) MUST include:
    - bestVisitTime: { from: "HH:mm", to: "HH:mm" } suggested local window that day.
      Choose realistic times for the place/activity/freeTime — do NOT copy example times like 09:00–12:00.
    - durationMinutes: approximate minutes to plan (e.g. 180 ≈ 3 hours meaning only).
      Tours/cruises/shows MUST use realistic session length (often 60–240).
      Activities must fit remaining freeTime after saved places.
8. Do NOT schedule places or whereToEat in stopType home cities.
9. Respect freeTime.durationMinutes (and start/end when present). Rough guide for places[]:
   - under 90 min → 0–1 new items (short paid activity OK if it fits)
   - 90–240 → 1–2 (prefer at least one doable activity/experience when leisure fits)
   - 240–480 → 2–3 (mix sights + 1 tour/experience when the city offers them)
   - 480+ → 2–4 (include 1–2 activities/experiences, not only landmarks)
   Count saved locationIds toward the day's load — do not overfill.
   Only recommend activities whose durationMinutes fit inside remaining freeTime
   after saved places (leave buffer for travel between stops).
10. leisureType WEIGHTS what you pick (preference, not a hard filter):
    - Prefer activities/experiences that match leisureType first
      (e.g. adventure → outdoor/active; nightlife → shows/evening;
      relaxation → wellness/soft experiences; sightseeing → cultural tours;
      custom → leisureCustom activities when available locally).
    - You MAY still add a destination-defining experience outside leisureType
      when it is characteristic of the city and fits time/budget.
    - Never fill a day with only generic landmarks when strong bookable
      experiences exist that match leisureType and freeTime.
11. Prefer real named places/tours/experiences with plausible lat/lon. Omit place price/links when unknown.

PART B — WHERE TO EAT (popular dining, mealType HARD FILTER):
12. For EVERY free-time slot with durationMinutes ≥ 90, also fill whereToEat[] with popular local restaurants / cafés / food halls.
13. whereToEat entries use the SAME location shape as new places, but:
    - category MUST be food | cafe | market
    - ai.model MUST be "fillWhereToEat"
    - Prefer well-known / locally popular spots
    - Suggest realistic meal windows inside freeTime
14. whereToEat count guide (separate from places[]):
   - under 90 min → 0
   - 90–240 → 1
   - 240–480 → 1–2
   - 480+ → 2–3
15. mealType is a HARD dietary filter for whereToEat AND any food/cafe/market in places[]:
    - default: recommend popular local food freely
    - halal: ONLY halal / halal-friendly. NEVER pork, bacon, ham, lard, non-halal meat, or alcohol-centric bars. If a famous local dish is pork-based, recommend a popular HALAL alternative — popularity NEVER overrides diet.
    - vegetarian: ONLY vegetarian-friendly. NEVER meat/fish as the focus.
    - kosher: ONLY kosher-friendly. NEVER pork, shellfish, or non-kosher meat.
    - other + mealCustom: strictly follow the stated diet.
16. Do not duplicate the same venue across places[] and whereToEat[].

PART C — NON-FLIGHT ROUTES (price + link):
17. For each route in the input with transport NOT "flight", return fare + official booking/timetable URL when known.
18. NEVER add priceAmount / priceCurrency / priceLabel / link for transport "flight".
19. Use approximate one-way adult fare. Prefer trip currency when converting. priceLabel like "≈ 45 USD" or "from 12 EUR".
20. link must be https official operator / timetable / booking page. Omit if not reliable.
21. Identify each route by day + routeIndex (0-based index in that day's routes array).

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
            { "locationId": "saved-id", "bestVisitTime": { "from": "10:00", "to": "12:30" }, "durationMinutes": 150 },
            { "id": "new-slug", "title": "", "description": "", "cityId": "", "status": "planned", "category": "attraction", "location": { "lat": 0, "lon": 0 }, "city": { "id": "", "name": "" }, "country": { "id": "", "name": "" }, "images": [], "bestVisitTime": { "from": "14:00", "to": "17:00" }, "durationMinutes": 180, "ai": { "why": "", "model": "fillPlaces" }, "source": { "type": "manual" }, "confidence": 0.7 }
          ],
          "whereToEat": [
            { "id": "popular-restaurant-slug", "title": "", "description": "", "cityId": "", "status": "planned", "category": "food", "location": { "lat": 0, "lon": 0 }, "city": { "id": "", "name": "" }, "country": { "id": "", "name": "" }, "images": [], "bestVisitTime": { "from": "12:30", "to": "13:30" }, "durationMinutes": 60, "ai": { "why": "Popular local spot matching mealType", "model": "fillWhereToEat" }, "source": { "type": "manual" }, "confidence": 0.75 }
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
  mealType?: "default" | "halal" | "vegetarian" | "kosher" | "other";
  mealCustom?: string;
  destinationsJson: string;
  itineraryJson: string;
}): string {
  const leisure = formatLeisurePreference(input.leisureType, input.leisureCustom);
  const mealType = input.mealType ?? "default";
  const meal =
    mealType === "other" && input.mealCustom?.trim()
      ? `Meal preference (mealType): other — ${input.mealCustom.trim()} — HARD dietary filter for whereToEat and food/cafe/market stops`
      : `Meal preference (mealType): ${mealType} — ${MEAL_TYPE_HINT[mealType]}`;

  return [
    `Language for titles/descriptions: ${input.language?.trim() || "en"}`,
    leisure,
    meal,
    input.currency
      ? `Currency for place, whereToEat, and non-flight route fares when known: ${input.currency}`
      : "Currency: use local or USD when known",
    "",
    "DESTINATIONS (context — city names, savedPlaces already reflected as locationId in slots):",
    input.destinationsJson,
    "",
    "ITINERARY TO FILL:",
    "- places[] = free-time city slots (seeded locationId first, then places AND bookable activities/experiences)",
    "- Prefer a mix of sights + tours/experiences/shows that fit freeTime; weight picks toward leisureType",
    "- whereToEat[] = popular dining for each slot (food/cafe/market), HARD-filtered by mealType",
    "- Never repeat the same locationId / place id / title across days — vary places, activities, and dining for multi-day city stays",
    "- For EVERY place and whereToEat entry: include bestVisitTime { from, to } as HH:mm and durationMinutes",
    "- routes[] = include non-flight legs with routeIndex; fill priceAmount/priceCurrency/priceLabel/link (never for flight)",
    input.itineraryJson,
    "",
    "Return itinerary with places/activities + whereToEat filled and non-flight route fare/link enrichment.",
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

/** Parse HH:mm (24h). Accepts H:mm → normalizes to HH:mm. */
function asHhMm(value: unknown): string | null {
  const s = asString(value);
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2]!;
  if (!Number.isFinite(h) || h < 0 || h > 23) return null;
  return `${String(h).padStart(2, "0")}:${min}`;
}

function minutesFromHhMm(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function parseBestVisitTime(
  row: Record<string, unknown>
): { from: string; to: string } | undefined {
  const nested =
    row.bestVisitTime && typeof row.bestVisitTime === "object"
      ? (row.bestVisitTime as Record<string, unknown>)
      : null;
  const from =
    asHhMm(nested?.from) ||
    asHhMm(row.visitFrom) ||
    asHhMm(row.bestVisitFrom) ||
    asHhMm(row.from);
  const to =
    asHhMm(nested?.to) ||
    asHhMm(row.visitTo) ||
    asHhMm(row.bestVisitTo) ||
    asHhMm(row.to);
  if (!from || !to) return undefined;
  if (minutesFromHhMm(to) <= minutesFromHhMm(from)) return undefined;
  return { from, to };
}

function parseVisitDurationMinutes(
  row: Record<string, unknown>
): number | undefined {
  const raw =
    asNumber(row.durationMinutes) ??
    asNumber(row.visitDurationMinutes) ??
    asNumber(row.approximateDurationMinutes);
  if (raw == null) return undefined;
  const mins = Math.round(raw);
  if (!Number.isFinite(mins) || mins < 15 || mins > 12 * 60) return undefined;
  return mins;
}

function withVisitTiming<T extends Record<string, unknown>>(
  base: T,
  row: Record<string, unknown>
): T & {
  bestVisitTime?: { from: string; to: string };
  durationMinutes?: number;
} {
  const bestVisitTime = parseBestVisitTime(row);
  const durationMinutes = parseVisitDurationMinutes(row);
  return {
    ...base,
    ...(bestVisitTime ? { bestVisitTime } : {}),
    ...(durationMinutes != null ? { durationMinutes } : {}),
  };
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
  },
  opts?: { model?: string; forceFoodCategory?: boolean }
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
  let category = parseCategory(row.category);
  if (opts?.forceFoodCategory) {
    category =
      category && FOOD_PLACE_CATEGORIES.has(category) ? category : "food";
  }

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
  const model =
    opts?.model ||
    (aiRaw ? asString(aiRaw.model) : null) ||
    "fillPlaces";

  return withVisitTiming(
    {
      id,
      title,
      description,
      ...(note ? { note } : {}),
      cityId,
      status: "planned" as const,
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
      ai: { why, model },
    },
    row
  );
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

/** Stable key for cross-day place uniqueness. */
function placeDedupeKey(
  place: TripPlannerAiResponseNestedPlace,
  cityId: string
): string | null {
  if ("locationId" in place && place.locationId?.trim()) {
    return `loc:${place.locationId.trim()}`;
  }
  if ("id" in place && place.id?.trim()) {
    return `id:${cityId}:${place.id.trim().toLowerCase()}`;
  }
  const title =
    "title" in place && typeof place.title === "string"
      ? place.title.trim().toLowerCase()
      : "";
  if (title) return `title:${cityId}:${title}`;
  return null;
}

/**
 * Keep the first occurrence of each place across the itinerary.
 * Prevents regenerate/multi-day stays from repeating the same places every day.
 */
export function dedupePlacesAcrossItinerary(
  itinerary: TripPlannerAiResponseDay[]
): TripPlannerAiResponseDay[] {
  const seen = new Set<string>();
  return itinerary.map((day) => ({
    ...day,
    places: (day.places ?? []).map((slot) => {
      const cityId = slot.cityId.trim().toLowerCase();
      const places: TripPlannerAiResponseNestedPlace[] = [];
      for (const place of slot.places ?? []) {
        const key = placeDedupeKey(place, cityId);
        if (key) {
          if (seen.has(key)) continue;
          seen.add(key);
        }
        places.push(place);
      }
      const whereToEat: TripPlannerAiResponseLocationPlace[] = [];
      for (const place of slot.whereToEat ?? []) {
        const key = placeDedupeKey(place, cityId);
        if (key) {
          if (seen.has(key)) continue;
          seen.add(key);
        }
        whereToEat.push(place);
      }
      return {
        ...slot,
        cityId,
        places,
        ...(whereToEat.length ? { whereToEat } : {}),
      };
    }),
  }));
}

/**
 * Merge AI place fill + non-flight route fare/link into the itinerary.
 * Saved `{ locationId }` from the original slot stay first.
 * Flights never receive price/link.
 * Cross-day duplicates (same locationId / place id / title) are dropped.
 */
export function mergeAiPlacesIntoItinerary(
  itinerary: TripPlannerAiResponseDay[],
  aiRaw: unknown,
  destinations: Record<string, TripPlannerAiRequestDestination>
): TripPlannerAiResponseDay[] {
  if (!aiRaw || typeof aiRaw !== "object") return itinerary;
  const body = aiRaw as Record<string, unknown>;
  const daysRaw = Array.isArray(body.itinerary) ? body.itinerary : [];

  type AiCitySlotFill = {
    places: TripPlannerAiResponseNestedPlace[];
    whereToEat: TripPlannerAiResponseLocationPlace[];
  };

  const aiByKey = new Map<string, Map<string, AiCitySlotFill>>();
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
    const cityMap = new Map<string, AiCitySlotFill>();

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
          places.push(withVisitTiming({ locationId }, row));
          continue;
        }
        const loc = parseLocationPlace(row, fallback);
        if (!loc || seenNew.has(loc.id)) continue;
        seenNew.add(loc.id);
        places.push(loc);
      }

      const whereToEat: TripPlannerAiResponseLocationPlace[] = [];
      const seenEat = new Set<string>();
      for (const p of Array.isArray(s.whereToEat) ? s.whereToEat : []) {
        if (!p || typeof p !== "object") continue;
        const row = p as Record<string, unknown>;
        if (asString(row.locationId) && !asString(row.title)) continue;
        const loc = parseLocationPlace(row, fallback, {
          model: "fillWhereToEat",
          forceFoodCategory: true,
        });
        if (!loc || seenEat.has(loc.id) || seenNew.has(loc.id)) continue;
        seenEat.add(loc.id);
        whereToEat.push(loc);
      }

      cityMap.set(cityId, { places, whereToEat });
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

  const mergedDays = itinerary.map((day) => {
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
          saved.push({
            locationId: id,
            ...(p.bestVisitTime?.from && p.bestVisitTime?.to
              ? { bestVisitTime: p.bestVisitTime }
              : {}),
            ...(p.durationMinutes != null
              ? { durationMinutes: p.durationMinutes }
              : {}),
          });
        }

        const fromAi = cityMap.get(cityId) ?? {
          places: [] as TripPlannerAiResponseNestedPlace[],
          whereToEat: [] as TripPlannerAiResponseLocationPlace[],
        };
        const merged: TripPlannerAiResponseNestedPlace[] = [];
        const seenNew = new Set<string>();
        const aiSavedById = new Map<
          string,
          Extract<TripPlannerAiResponseNestedPlace, { locationId: string }>
        >();
        for (const p of fromAi.places) {
          if (!("locationId" in p) || !p.locationId?.trim()) continue;
          aiSavedById.set(p.locationId.trim(), p);
        }
        for (const p of saved) {
          if (!("locationId" in p)) continue;
          const enriched = aiSavedById.get(p.locationId);
          if (enriched) {
            merged.push({
              locationId: p.locationId,
              ...(enriched.bestVisitTime || p.bestVisitTime
                ? {
                    bestVisitTime:
                      enriched.bestVisitTime || p.bestVisitTime,
                  }
                : {}),
              ...(enriched.durationMinutes != null || p.durationMinutes != null
                ? {
                    durationMinutes:
                      enriched.durationMinutes ?? p.durationMinutes,
                  }
                : {}),
            });
            aiSavedById.delete(p.locationId);
          } else {
            merged.push(p);
          }
        }
        for (const p of fromAi.places) {
          if ("locationId" in p) {
            const id = p.locationId.trim();
            if (!id || seenSaved.has(id)) continue;
            if (allowed.size > 0 && !allowed.has(id)) continue;
            seenSaved.add(id);
            merged.push({
              locationId: id,
              ...(p.bestVisitTime ? { bestVisitTime: p.bestVisitTime } : {}),
              ...(p.durationMinutes != null
                ? { durationMinutes: p.durationMinutes }
                : {}),
            });
            continue;
          }
          if (seenNew.has(p.id)) continue;
          seenNew.add(p.id);
          merged.push(p);
        }

        const whereToEat: TripPlannerAiResponseLocationPlace[] = [];
        const seenEat = new Set<string>(seenNew);
        for (const p of fromAi.whereToEat) {
          if (seenEat.has(p.id)) continue;
          seenEat.add(p.id);
          whereToEat.push(p);
        }

        return {
          ...slot,
          cityId,
          places: merged,
          ...(whereToEat.length ? { whereToEat } : {}),
        };
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

  return dedupePlacesAcrossItinerary(mergedDays);
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
      mealType: request.trip.mealType,
      mealCustom: request.trip.mealCustom,
      destinationsJson: JSON.stringify(
        slimDestinationsForPrompt(request.destinations)
      ),
      itineraryJson: JSON.stringify(slimItineraryPlacesForPrompt(itinerary)),
    }),
  };
}
