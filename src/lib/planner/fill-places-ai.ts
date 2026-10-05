/**
 * Client/server helpers to fill itinerary free-time places via AI.
 * Temporary Next.js /api path for checking place fill before planTrip wiring.
 */

import { PLACE_CATEGORIES, type LeisureType, type PlaceCategory } from "@/types/trip-plan";
import {
  TRIP_ROUTE_TRANSPORTS,
  type RoutePoint,
  type TripRouteTransport,
} from "@/types/trip-planner";
import type {
  TripPlannerAiRequest,
  TripPlannerAiRequestDestination,
  TripPlannerAiResponseDay,
  TripPlannerAiResponseLocationPlace,
  TripPlannerAiResponseNestedPlace,
  TripPlannerAiResponsePlace,
  TripPlannerAiResponseRoute,
} from "@/types/trip-planner-ai-request";

const PLACE_CATEGORY_SET = new Set<string>(PLACE_CATEGORIES);
const TRANSPORT_SET = new Set<string>(TRIP_ROUTE_TRANSPORTS);
/** Modes allowed for same-day island / peninsula / coastal day-trip access. */
const DAY_TRIP_TRANSPORT_SET = new Set<TripRouteTransport>([
  "ferry",
  "bus",
  "taxi",
  "car",
  "metro",
  "other",
]);

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
3b. Destination-defining nearby attractions (CRITICAL — easy to under-recommend):
   - Do NOT limit picks to the city center / old town. Also cover iconic places
     travelers visit FROM this stay city in the same metro / province / bay —
     including nearby islands, peninsulas, beach resorts, wildlife islands,
     ferry day-trips, cable-car islands, and coastal parks — when they are
     genuinely associated with that destination and reachable as a day outing
     (roughly within ~1–2 hours by ferry/boat/car).
   - Keep cityId / city.id as the stay city; put real lat/lon on the attraction
     itself (even if offshore or in a neighboring district).
   - On multi-day stays with freeTime ≥ ~360 min at least once, include at least
     ONE such signature nearby outing across the stay when the destination is
     known for them — do not fill every day with only downtown museums/markets.
   - Still respect freeTime: short half-days stay local; full/near-full days may
     use one longer island/day-trip activity instead of packing only short stops.
   - When the place needs ferry / boat / coastal hop / short transfer to reach,
     you MUST also ADD outbound + return transport routes for that day
     (see PART C day-trip access rules) with realistic times and fares.
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
4c. SAME-DAY VARIETY (CRITICAL — avoid repetitive days):
    - Do NOT put dining venues in places[] — restaurants/cafés/markets belong in whereToEat[] only
      (exception: leisureType is "food", and even then at most ONE food stop in places[]).
    - Never schedule two food/cafe/market stops back-to-back in the day's timeline
      (including whereToEat). Separate meals with a non-dining activity or leave gaps.
    - At most ONE of each activity type per day: wellness (spa/hammam/bath), tour,
      adventure, show, nightlife. Example: never hammam morning AND hammam/spa evening.
    - Prefer a mixed day (sight + activity + meal) over repeating the same category.
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
   - 240–480 → 2–3 (mix sights + 1 tour/experience when the city offers them);
     OR 1 longer nearby day-trip / island outing when that is the city's icon
   - 480+ → 2–4 (include 1–2 activities/experiences, not only landmarks);
     OR 1 signature nearby island/peninsula/day-trip as the day's anchor
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
   - 90–240 → 1 (one meal only — do not add a second café/snack stop)
   - 240–480 → 1–2 (different meal windows only, e.g. lunch + dinner — never two lunches)
   - 480+ → 2–3 (spread across breakfast / lunch / dinner — never consecutive dining)
   At most ONE whereToEat per meal window (breakfast <11:00, lunch 11:00–16:00, dinner ≥16:00).
15. mealType is a HARD dietary filter for whereToEat AND any food/cafe/market in places[]:
    - default: recommend popular local food freely
    - halal: ONLY halal / halal-friendly. NEVER pork, bacon, ham, lard, non-halal meat, or alcohol-centric bars. If a famous local dish is pork-based, recommend a popular HALAL alternative — popularity NEVER overrides diet.
    - vegetarian: ONLY vegetarian-friendly. NEVER meat/fish as the focus.
    - kosher: ONLY kosher-friendly. NEVER pork, shellfish, or non-kosher meat.
    - other + mealCustom: strictly follow the stated diet.
16. Do not duplicate the same venue across places[] and whereToEat[].

PART C — NON-FLIGHT ROUTES (fare enrich + day-trip access):
17. For each EXISTING route in the input with transport NOT "flight", return fare + official booking/timetable URL when known. Identify by day + routeIndex (0-based).
18. NEVER add priceAmount / priceCurrency / priceLabel / link for transport "flight".
19. Use approximate one-way adult fare. Prefer trip currency when converting. priceLabel like "≈ 45 USD" or "from 12 EUR".
20. link must be https official operator / timetable / booking page. Omit if not reliable.
21. DAY-TRIP ACCESS ROUTES — ADD when a recommended place needs ferry/boat/coastal hop:
    If you recommend an island, peninsula, ferry day-trip, or coastal icon that is NOT
    walkable from the city center, you MUST add TWO new same-day routes:
      a) outbound: stay-city pier / ferry terminal / hub → island/attraction pier
      b) return: island/attraction pier → stay-city pier / hub
    Use transport "ferry" when that is the real mode; otherwise bus|taxi|car|metro|other.
    NEVER use flight or airport_transfer for these access legs.
    Each NEW route object MUST include:
      - "add": true
      - "forPlaceId": ascii id of the place it serves
      - transport, from, to (name, city, location {lat,lon})
      - departure + arrival: { datetime: ISO with offset on that day, timezone: IANA, timeKnown: true }
      - priceAmount, priceCurrency, priceLabel (one-way adult fare when known), link when known
    Timing rules:
      - Both legs must fall inside that day's freeTime window when freeTime start/end exist
      - Outbound arrival ≤ place.bestVisitTime.from
      - Return departure ≥ place.bestVisitTime.to
      - Place durationMinutes is ON-SITE time only (exclude ferry riding time)
    Do NOT add day-trip routes for ordinary downtown walks. Do NOT invent intercity legs.

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
            { "id": "princes-islands", "title": "", "description": "", "cityId": "", "status": "planned", "category": "attraction", "location": { "lat": 0, "lon": 0 }, "city": { "id": "", "name": "" }, "country": { "id": "", "name": "" }, "images": [], "bestVisitTime": { "from": "11:00", "to": "16:00" }, "durationMinutes": 300, "ai": { "why": "", "model": "fillPlaces" }, "source": { "type": "manual" }, "confidence": 0.7 }
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
        },
        {
          "add": true,
          "forPlaceId": "princes-islands",
          "transport": "ferry",
          "from": { "name": "Kabataş Ferry Terminal", "city": "Istanbul", "location": { "lat": 41.034, "lon": 28.995 } },
          "to": { "name": "Büyükada Pier", "city": "Istanbul", "location": { "lat": 40.874, "lon": 29.12 } },
          "departure": { "datetime": "2026-06-10T09:00:00+03:00", "timezone": "Europe/Istanbul", "timeKnown": true },
          "arrival": { "datetime": "2026-06-10T10:00:00+03:00", "timezone": "Europe/Istanbul", "timeKnown": true },
          "priceAmount": 15,
          "priceCurrency": "TRY",
          "priceLabel": "≈ 15 TRY one-way",
          "link": "https://example.com/ferry"
        },
        {
          "add": true,
          "forPlaceId": "princes-islands",
          "transport": "ferry",
          "from": { "name": "Büyükada Pier", "city": "Istanbul", "location": { "lat": 40.874, "lon": 29.12 } },
          "to": { "name": "Kabataş Ferry Terminal", "city": "Istanbul", "location": { "lat": 41.034, "lon": 28.995 } },
          "departure": { "datetime": "2026-06-10T16:30:00+03:00", "timezone": "Europe/Istanbul", "timeKnown": true },
          "arrival": { "datetime": "2026-06-10T17:30:00+03:00", "timezone": "Europe/Istanbul", "timeKnown": true },
          "priceAmount": 15,
          "priceCurrency": "TRY",
          "priceLabel": "≈ 15 TRY one-way",
          "link": "https://example.com/ferry"
        }
      ]
    }
  ]
}

Return strict JSON only. Include routes[] for non-flight fare enrichment (by routeIndex) AND any new day-trip access legs (add:true).`;

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
    "- Also include destination-defining nearby attractions (islands, peninsulas, ferry day-trips, coastal icons) when freeTime allows — not only downtown",
    "- For island/peninsula/ferry day-trips: ADD outbound + return transport routes (add:true) with departure/arrival times and one-way fare",
    "- whereToEat[] = popular dining for each slot (food/cafe/market), HARD-filtered by mealType",
    "- SAME-DAY VARIETY: no dining in places[] (use whereToEat); no back-to-back meals; at most one wellness/tour/adventure/show/nightlife per day",
    "- Never repeat the same locationId / place id / title across days — vary places, activities, and dining for multi-day city stays",
    "- For EVERY place and whereToEat entry: include bestVisitTime { from, to } as HH:mm and durationMinutes",
    "- routes[] = (1) enrich existing non-flight legs by routeIndex with fare/link; (2) add day-trip ferry/access legs with add:true",
    input.itineraryJson,
    "",
    "Return itinerary with places/activities + whereToEat filled, non-flight fare enrichment, and day-trip access routes when needed.",
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
      source: { type: "manual" as const },
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

/** Activity types that should not repeat on the same day. */
const SINGLETON_DAY_CATEGORIES = new Set<PlaceCategory>([
  "wellness",
  "tour",
  "adventure",
  "show",
  "nightlife",
]);

const SPA_TITLE_RE =
  /\b(hammam|hamam|spa|thermal\s*baths?|sauna|onsen|bathhouse)\b/i;

type MealBucket = "breakfast" | "lunch" | "dinner";

function parseHhMmMinutes(value?: string): number | null {
  if (!value?.trim()) return null;
  const m = value.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23) {
    return null;
  }
  return hour * 60 + minute;
}

function mealBucketFromMinutes(mins: number | null): MealBucket {
  if (mins == null) return "lunch";
  if (mins < 11 * 60) return "breakfast";
  if (mins < 16 * 60) return "lunch";
  return "dinner";
}

function nestedPlaceCategory(
  place: TripPlannerAiResponseNestedPlace
): PlaceCategory | undefined {
  if ("category" in place && place.category) return place.category;
  return undefined;
}

function nestedPlaceTitle(place: TripPlannerAiResponseNestedPlace): string {
  if ("title" in place && typeof place.title === "string") {
    return place.title.trim();
  }
  return "";
}

function nestedVisitFromMinutes(
  place: TripPlannerAiResponseNestedPlace
): number | null {
  if (!("bestVisitTime" in place) || !place.bestVisitTime?.from) return null;
  return parseHhMmMinutes(place.bestVisitTime.from);
}

/**
 * Soft post-filter: drop same-day dining stacks and repeated activity types
 * (e.g. two hammams, or restaurant then café with no break).
 * Saved `{ locationId }` refs are never removed.
 */
export function diversifySameDayActivities(
  itinerary: TripPlannerAiResponseDay[]
): TripPlannerAiResponseDay[] {
  return itinerary.map((day) => ({
    ...day,
    places: (day.places ?? []).map((slot) => {
      const hasWhereToEat = (slot.whereToEat?.length ?? 0) > 0;
      const seenSingleton = new Set<string>();
      const places: TripPlannerAiResponseNestedPlace[] = [];

      const rankedPlaces = [...(slot.places ?? [])].sort((a, b) => {
        const am = nestedVisitFromMinutes(a) ?? 24 * 60;
        const bm = nestedVisitFromMinutes(b) ?? 24 * 60;
        return am - bm;
      });

      for (const place of rankedPlaces) {
        if ("locationId" in place && place.locationId?.trim()) {
          places.push(place);
          continue;
        }

        const category = nestedPlaceCategory(place);
        const title = nestedPlaceTitle(place);

        if (
          hasWhereToEat &&
          category &&
          FOOD_PLACE_CATEGORIES.has(category)
        ) {
          continue;
        }

        if (category && SINGLETON_DAY_CATEGORIES.has(category)) {
          if (seenSingleton.has(category)) continue;
          seenSingleton.add(category);
        }

        if (SPA_TITLE_RE.test(title)) {
          if (seenSingleton.has("spa-title")) continue;
          seenSingleton.add("spa-title");
        }

        places.push(place);
      }

      const whereToEat: TripPlannerAiResponseLocationPlace[] = [];
      const usedMealBuckets = new Set<MealBucket>();
      let lastEatMins: number | null = null;

      const rankedEat = [...(slot.whereToEat ?? [])].sort((a, b) => {
        const am = parseHhMmMinutes(a.bestVisitTime?.from) ?? 24 * 60;
        const bm = parseHhMmMinutes(b.bestVisitTime?.from) ?? 24 * 60;
        return am - bm;
      });

      for (const place of rankedEat) {
        const fromMins = parseHhMmMinutes(place.bestVisitTime?.from);
        const bucket = mealBucketFromMinutes(fromMins);
        if (usedMealBuckets.has(bucket)) continue;
        if (
          lastEatMins != null &&
          fromMins != null &&
          fromMins - lastEatMins < 150
        ) {
          continue;
        }
        usedMealBuckets.add(bucket);
        if (fromMins != null) lastEatMins = fromMins;
        whereToEat.push(place);
      }

      const cleanedPlaces: TripPlannerAiResponseNestedPlace[] = [];
      let prevWasFood = false;
      const placesByTime = [...places].sort((a, b) => {
        const am = nestedVisitFromMinutes(a) ?? 24 * 60;
        const bm = nestedVisitFromMinutes(b) ?? 24 * 60;
        return am - bm;
      });
      for (const place of placesByTime) {
        const isFood =
          !("locationId" in place && place.locationId?.trim()) &&
          Boolean(
            nestedPlaceCategory(place) &&
              FOOD_PLACE_CATEGORIES.has(nestedPlaceCategory(place)!)
          );
        if (isFood && prevWasFood) continue;
        cleanedPlaces.push(place);
        prevWasFood = isFood;
      }

      return {
        ...slot,
        places: cleanedPlaces,
        ...(whereToEat.length ? { whereToEat } : {}),
      };
    }),
  }));
}

function parseTransport(value: unknown): TripRouteTransport | null {
  const s = asString(value)?.toLowerCase();
  if (!s || !TRANSPORT_SET.has(s)) return null;
  return s as TripRouteTransport;
}

function parseRoutePoint(raw: unknown): RoutePoint | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = asString(o.name);
  const city = asString(o.city);
  if (!name || !city) return null;

  const country = asString(o.country) ?? undefined;
  const code = asString(o.code)?.toUpperCase() ?? undefined;
  const placeId = asString(o.placeId) ?? undefined;
  let location: { lat: number; lon: number } | undefined;
  if (o.location && typeof o.location === "object") {
    const loc = o.location as Record<string, unknown>;
    const lat = asNumber(loc.lat);
    const lon = asNumber(loc.lon);
    if (lat != null && lon != null) location = { lat, lon };
  }

  return {
    name,
    city,
    ...(country ? { country } : {}),
    ...(code ? { code } : {}),
    ...(placeId ? { placeId } : {}),
    ...(location ? { location } : {}),
  };
}

function parseRouteInstant(
  raw: unknown,
  fallbackTimezone?: string
):
  | { datetime: string; timezone: string; timeKnown?: boolean }
  | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const datetime = asString(o.datetime);
  if (!datetime || !Number.isFinite(Date.parse(datetime))) return undefined;
  const timezone = asString(o.timezone) || fallbackTimezone?.trim() || "";
  const timeKnown =
    typeof o.timeKnown === "boolean" ? o.timeKnown : undefined;
  return {
    datetime,
    timezone,
    ...(timeKnown !== undefined ? { timeKnown } : {}),
  };
}

function dayTripRouteKey(r: TripPlannerAiResponseRoute): string {
  const from =
    r.from.placeId || `${r.from.city}|${r.from.name}`.toLowerCase();
  const to = r.to.placeId || `${r.to.city}|${r.to.name}`.toLowerCase();
  const dep = r.departure?.datetime ?? "";
  return `${from}->${to}|${r.transport}|${dep}`;
}

function parseDayTripRoute(
  row: Record<string, unknown>,
  dayDate: string,
  destinations: Record<string, TripPlannerAiRequestDestination>
): TripPlannerAiResponseRoute | null {
  const transport = parseTransport(row.transport);
  if (!transport || !DAY_TRIP_TRANSPORT_SET.has(transport)) return null;

  const from = parseRoutePoint(row.from);
  const to = parseRoutePoint(row.to);
  if (!from || !to) return null;

  const cityId =
    asString(row.cityId)?.toLowerCase() || slugifyAscii(from.city);
  const dest =
    (cityId && destinations[cityId]) ||
    Object.values(destinations).find(
      (d) =>
        d?.cityName?.trim().toLowerCase() === from.city.trim().toLowerCase()
    );
  const fallbackTz = dest?.cityInfo?.timezone;

  const departure = parseRouteInstant(row.departure, fallbackTz);
  const arrival = parseRouteInstant(row.arrival, fallbackTz);
  if (!departure || !arrival) return null;

  if (
    !departure.datetime.startsWith(dayDate) ||
    !arrival.datetime.startsWith(dayDate)
  ) {
    return null;
  }
  if (Date.parse(arrival.datetime) <= Date.parse(departure.datetime)) {
    return null;
  }

  const priceAmount = asNumber(row.priceAmount);
  const priceCurrency = asString(row.priceCurrency);
  const priceLabel = asString(row.priceLabel);
  const link = asHttpUrl(row.link);

  return {
    from,
    to,
    transport,
    departure,
    arrival,
    source: "generated",
    ...(priceAmount != null && priceAmount >= 0 ? { priceAmount } : {}),
    ...(priceCurrency && /^[A-Za-z]{3}$/.test(priceCurrency)
      ? { priceCurrency: priceCurrency.toUpperCase() }
      : {}),
    ...(priceLabel ? { priceLabel } : {}),
    ...(link ? { link } : {}),
  };
}

/**
 * Merge AI place fill + non-flight route fare/link + day-trip access routes.
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
  const dayTripRoutesByKey = new Map<string, TripPlannerAiResponseRoute[]>();

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
    const dayTripRoutes: TripPlannerAiResponseRoute[] = [];
    for (const routeRow of Array.isArray(d.routes) ? d.routes : []) {
      if (!routeRow || typeof routeRow !== "object") continue;
      const r = routeRow as Record<string, unknown>;
      const transport = asString(r.transport)?.toLowerCase();
      if (transport === "flight") continue;

      const wantsAdd =
        r.add === true ||
        (asString(r.action)?.toLowerCase() === "add" &&
          r.from != null &&
          r.to != null);
      if (wantsAdd) {
        const draft = parseDayTripRoute(r, date, destinations);
        if (draft) dayTripRoutes.push(draft);
        continue;
      }

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
    if (dayTripRoutes.length > 0) {
      dayTripRoutesByKey.set(key, dayTripRoutes);
      dayTripRoutesByKey.set(`date:${date}`, dayTripRoutes);
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
    const dayTripRoutes =
      dayTripRoutesByKey.get(key) ||
      dayTripRoutesByKey.get(`date:${day.date}`) ||
      [];

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

    const existingKeys = new Set(routes.map(dayTripRouteKey));
    for (const draft of dayTripRoutes) {
      const rk = dayTripRouteKey(draft);
      if (existingKeys.has(rk)) continue;
      existingKeys.add(rk);
      routes.push(draft);
    }

    routes.sort((a, b) => {
      const at = a.departure?.datetime ?? a.arrival?.datetime ?? "";
      const bt = b.departure?.datetime ?? b.arrival?.datetime ?? "";
      if (at && bt) return at.localeCompare(bt);
      if (at) return -1;
      if (bt) return 1;
      return 0;
    });

    return { ...day, places, routes };
  });

  return diversifySameDayActivities(dedupePlacesAcrossItinerary(mergedDays));
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
