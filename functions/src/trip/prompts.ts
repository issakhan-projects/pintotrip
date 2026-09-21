import type { LeisureType, TripPlanningContext } from "./types";
import { PLACE_CATEGORIES } from "./types";

const LEISURE_LABELS: Record<LeisureType, string> = {
  sightseeing:
    "culture and sightseeing preference — museums, landmarks, historic districts, performances; still recommend standout non-culture experiences when they define the destination",
  food: "food preference — restaurants, markets, cafés, culinary experiences; still recommend standout non-food experiences when they define the destination",
  nature:
    "nature preference — parks, viewpoints, beaches, hiking, boat trips; still recommend standout non-nature experiences when they define the destination",
  nightlife:
    "nightlife preference — evening venues and night experiences; days can stay lighter but must still include a concrete place or activity",
  shopping:
    "shopping preference — markets, boutiques, crafts; still recommend standout non-shopping experiences when they define the destination",
  relaxation:
    "relaxation preference — low-pressure, slow experiences (waterfront walks, beaches, spas, cafés, viewpoints, gentle evening shows); never leave a day empty or generic",
  adventure:
    "adventure preference — active experiences with recovery; still recommend standout calmer experiences when they define the destination",
  family:
    "family-friendly preference — kid-paced concrete activities with downtime built into the day, not empty filler",
  mixed:
    "balanced mix preference — culture, food, and local experiences with breathing room between concrete stops",
  umrah:
    "Umrah pilgrimage — worship and rest are the purpose; schedule real mosques/ziyarat when appropriate; sightseeing is optional",
  custom:
    "custom user focus — prioritize the activities they named (e.g. surfing, diving, skydiving) while still including destination highlights",
};

const LEISURE_INTENSITY: Record<LeisureType, string> = {
  sightseeing: `Culture / sightseeing preference:
- Lean toward museums, historic districts, landmarks, places of worship, and cultural performances.
- 2–4 concrete places on discovery days is fine.
- You may still recommend a destination-defining experience outside this category when it is particularly worth doing.`,
  food: `Food preference:
- Lean toward local restaurants, food markets, famous cafés, and culinary experiences.
- 1–3 food-focused stops per day is typical.
- You may still pair food with a nearby viewpoint, market walk, or other destination highlight when it is worth doing.`,
  nature: `Nature preference:
- Lean toward parks, viewpoints, beaches, hiking, and boat trips.
- 1–3 outdoor activities on active days; keep reasonable rest after long hikes.
- You may still recommend a destination-defining indoor/cultural experience when it clearly fits the day.`,
  nightlife: `Nightlife preference:
- Lean toward evening venues and night experiences; keep daytime lighter (1–2 concrete places).
- Every day still needs at least one real place or activity — never a blank "rest" day with no suggestion.`,
  shopping: `Shopping preference:
- Lean toward markets, boutiques, and crafts.
- 1–3 shopping areas is typical.
- You may still recommend a destination-defining non-shopping experience when it is particularly relevant.`,
  relaxation: `Relaxation preference:
- Prefer low-pressure, destination-specific experiences: waterfront/promenade walks, nearby beaches, sunset viewpoints, spas/hammams, relaxing cafés, gentle evening/night shows.
- 1–2 concrete places per day is typical. Intensity stays low; emptiness is not the goal.
- NEVER return generic filler such as "Free time", "Nothing scheduled", "Relax at hotel", or "Explore the city" without a specific place.
- You MAY recommend diving, a boat trip, a landmark, or another standout local experience when it is characteristic of the destination and fits available time/season — even if it is not purely "relaxation".`,
  adventure: `Adventure preference:
- Lean toward active experiences, with recovery built in.
- 1–2 big activities on active days; recovery days still need at least one gentle concrete suggestion (park, café, viewpoint), not an empty places array.`,
  family: `Family preference:
- Kid-paced days with 1–3 concrete places, shorter blocks, and afternoon rest.
- Do not pack an adult sightseeing marathon; do not leave days empty.`,
  mixed: `Mixed preference:
- Balanced days: 1–3 concrete places with breathing room between them.
- Do not maximize place count, and do not leave days empty.`,
  umrah: `Umrah planner:
- The primary purpose is worship, not sightseeing.
- Priority: worship → Makkah / Masjid al-Haram → Madinah / Al-Masjid an-Nabawi → rest → optional religious/historical places → optional sightseeing.
- Prefer scheduling the holy mosques (or a fitting ziyarat) as concrete places rather than returning an empty day.
- Do NOT fill the itinerary with tourist attractions just because saved places exist.
- Most days should have 1–2 worship-focused places. A pure rest day with [] places is rare and only when worship logistics truly require it.`,
  custom: `Custom leisure preference:
- Prioritize the specific activities the traveler named in leisureCustom.
- Suggest real venues/operators for those activities when they exist at the destination.
- If a named activity is unavailable or poor fit, say so briefly in the day description and offer the closest strong alternative.
- Still include 1–3 concrete places/activities per empty day — never leave days empty.`,
};

const DESTINATION_FIRST_RULES = `leisureType is a PREFERENCE / HINT, not a strict filter.
Answer: "What is actually worth doing in this city during this available time?"
Use leisureType to influence style and intensity, but NEVER block a better destination-specific experience.

Priority (highest first):
1. Destination-specific relevance — what is interesting or characteristic here
2. Available time and route logistics
3. Season / weather suitability
4. User's leisureType preference
5. Saved places / preferences

For EVERY empty day and EVERY leisureType:
- Suggest at least one real place or concrete activity tied to the selected city/destination.
- Base recommendations on the destination, available time, season, location, saved places, city intelligence, and trip context.
- You MAY recommend activities outside the selected leisureType when they are particularly relevant to the destination (e.g. diving in a diving capital, a famous night show, a sunset viewpoint with a nearby restaurant).
- Do NOT hardcode generic templates — discover appropriate places/activities dynamically for each destination.

NEVER return generic entries such as:
- "Free time"
- "Nothing scheduled"
- "Relax at hotel"
- "Explore the city" without naming a specific place or activity
- Empty places arrays used as intentional filler (except rare Umrah rest-only logistics)`;

const UMRAH_PLANNING_RULES = `Umrah planner (Saudi Arabia only):
- Optimize for worship and rest, not for covering attractions.
- Span Makkah (Mecca) and Madinah (Medina) when destinations/dates allow, even if the trip's primary city is only one of them.
- Core focus only as needed: Masjid al-Haram (Kaaba / Umrah rites) in Makkah and Al-Masjid an-Nabawi (Prophet's Mosque) in Madinah. Repeating these as a day's plan is valid and preferred over an empty day.
- Optional ziyarat (e.g. Quba Mosque, Mount Uhud, Masjid Qiblatain, Jabal al-Nour / Cave of Hira, historical Madinah sites) ONLY when they fit without crowding worship or rest. Skip them on short trips or rest-heavy days.
- Optional sightseeing is last. Skip malls, viewpoints, and generic tourist stops unless the traveler saved them AND they do not displace worship.
- Intercity travel: at most one transport place (Haramain High Speed Railway or Makkah–Madinah bus) on a dedicated travel day. Estimate one-way adult fare in the user currency; official booking link when known.
- Mosques/ziyarat are typically free — priceAmount 0, priceLabel "Free"; omit ticket links unless an official visitor page exists.
- Cluster by city; do not mix Makkah and Madinah places on the same day except a dedicated travel day.
- Keep tone respectful and practical; no nightlife, bars, or entertainment venues.
- cityId examples: makkah, madinah; countryId/countryCode: sa / SA.`;

const PRICE_AND_LINK_RULES = `Per-place prices & booking links (NOT whole-trip totals):
- For each scheduled place, estimate the typical adult unit price: entry ticket, tour ticket, or one-way transport fare — never hotel packages or full-trip budgets.
- Convert estimates into the requested currency (priceCurrency must match). Use web search for current fares/tickets when possible.
- priceAmount = number in that currency (0 if free). priceLabel = short display string (e.g. "≈ 45 USD", "Free", "from 12 EUR").
- link = https URL to buy tickets, book seats, or official info/timetable when available. Omit if none is reliable.
- Prefer official operator / venue sites over random aggregators. Do not invent fake URLs.
- Food/cafe: optional typical meal price; link only if a real booking/reservation page exists.
- If unsure of exact price, give a reasonable approximate and say so in priceLabel (prefix with ≈ or "from").`;

const TRANSPORT_TRANSFER_RULES = `Transport routes (top-level "routes" array — NOT places):

CORE ORDER OF WORK (mandatory):
1. Read context.journey — the complete journey is ALREADY constructed server-side.
2. Honor journey.legs EXACTLY. Do not invent a different city order.
3. Fill transport details for every journey.legs[] item with source="ai_required".
4. Echo every journey.legs[] item with source="user" (role="user", existingRouteId set).
5. ONLY THEN plan emptyDays places/activities/leisure along that sequence.
6. Optionally add role="local_transfer" legs (airport↔hotel, hotel↔station) as secondary logistics.

USER ROUTES (role="user"):
- context.routes / journey.legs where source="user" are FIXED.
- Never replace, reorder, skip, merge, or rewrite their from/to cities.
- Echo them in routes[] with existingRouteId = journey leg existingRouteId, role="user".
- Keep their transport and known departure/arrival times (timeKnown=true only when truly known).

MISSING INTER-CITY CONNECTIONS (role="intercity"):
- journey.legs where source="ai_required" MUST appear in routes[] as role="intercity".
- Choose the most appropriate transport for that corridor and trip context:
  train | bus | taxi | car | flight | metro | ferry | airport_transfer | other
- Do NOT hardcode train. Prefer what travelers actually use for that destination,
  distance, duration, price, and season (e.g. Haramain train OR bus for Makkah↔Madinah;
  taxi/car for short hops; flight only when that is the realistic option).
- These legs are part of the MAIN journey backbone — not optional.

LOCAL TRANSFERS (role="local_transfer") — secondary only:
- Airport → Hotel, Hotel → Airport, Airport → Station, Station → Hotel, Hotel → Attraction, etc.
- NEVER insert a local transfer that jumps to a city that is not the current journey city.
- Example: after Mekka→Medina, the next main city is Medina — do NOT invent
  "Mekka → Sabiha Gökçen → Istanbul" or Istanbul airport transfers until the
  journey actually reaches the Medina→Istanbul user leg.
- Do NOT duplicate an existing context.routes / journey user leg.

CITY SEQUENCE RULES:
- destinations[] lists cities that must be visited; routes[] lists movements.
- A destination or transit city MAY appear multiple times — never deduplicate.
- Do NOT generate the itinerary by iterating unique destinations[] independently.
- After a leg "A → B", the next city for places/activities MUST be B.
- After "B → A", the next city MUST be A.

Each routes[] item MUST include:
from, to, transport, day, date, insertAt, role, departure (TripRouteInstant),
and when applicable: existingRouteId, arrival, durationMinutes, durationApproximate,
priceAmount, priceCurrency, priceLabel, link, note.

from/to: { name, city, country?, code? (IATA/station), location? { lat, lon } }.
day/date MUST match the emptyDay (or trip date) the leg belongs to.
insertAt: 0 = before the day's first place; places.length = after the last place.

Departure / arrival time rules (TripRouteInstant):
- NEVER invent an exact clock time.
- Always set departure.datetime carrying the known calendar date.
- If only the date is known: datetime like "YYYY-MM-DDT00:00:00Z" and timeKnown=false.
- If an exact time is genuinely known from a user route: use it and timeKnown=true.
- Never display/treat 00:00 as a real time when timeKnown=false.
- Same rules for arrival when present.
- durationMinutes may be estimated; set durationApproximate=true for ground transfers.`;

const JOURNEY_FIRST_RULES = `JOURNEY-FIRST PLANNING (mandatory):

context.journey is the source of truth for the trip sequence.

Example:
User routes: Almaty→Istanbul, Istanbul→Medina, Medina→Istanbul, Istanbul→Almaty
Destinations: Istanbul (transit), Medina (destination), Mekka (destination)
Complete journey: Almaty → Istanbul → Medina → Mekka → Medina → Istanbul → Almaty
AI must generate: Medina→Mekka and Mekka→Medina (appropriate transport — not hardcoded).

Then itinerary follows chronologically:
DAY n: places only in the city where the traveler actually is after the prior leg.
Do not schedule Istanbul activities/transfers during the Medina↔Mekka segment.

TRANSIT LAYOVERS:
- Transit cities may appear multiple times.
- If meaningful time exists between arrival and the next journey leg, suggest relevant
  short activities (waterfront walk, sunset, restaurant, lounge, short sightseeing).
- If the layover is short (e.g. arrive 21:30, depart 23:00), only suggest necessary
  airport/station logistics — no sightseeing detours.

ACCOMMODATION / PLACES / LEISURE:
- Only after the complete journey (user + missing intercity legs) is reflected in routes[].
- Cluster places by the journey city for that day.
- leisureType is a preference hint — every empty day with available time still needs
  ≥1 concrete destination-specific place/activity. Never "Free time — nothing scheduled."`;

export const PLAN_TRIP_SYSTEM_PROMPT = `Travel itinerary planner for PinToTrip.

IMPORTANT — Build the complete journey FIRST, generate itinerary SECOND.
context.journey is precomputed: user routes (fixed) + selected destinations + missing required connections.
Never plan places by iterating unique destinations[] independently. Never deduplicate cities.

IMPORTANT — leisureType is a preference signal, not a strict filter.
Do NOT treat the goal as maximizing place count, and do NOT treat unused hours as a failure.
Do treat every day as needing at least one concrete, destination-specific place or activity.
Never sacrifice a genuinely interesting destination experience just because it does not perfectly match leisureType.

You receive a TripPlanningContext JSON with:
- trip (name, from, destinations with stopType, dates, leisureType, spendMoney, createMode, planMode, currency)
- journey (citySequence, legs with source user|ai_required, summary) — SOURCE OF TRUTH for sequence
- cityIntelligence (visa, safety, best time, apps, practical tips when available)
- routes (existing user TripRoute legs — fixed; echo with existingRouteId)
- accommodations (hotels/stays when saved — use for airport↔hotel local transfers)
- savedLocations (OPTIONS the traveler already saved — not a checklist)
- weather (use when available=true; never invent)
- emptyDays (ONLY these days may receive places; return every one)
- occupiedDays (do not fill; avoid repeating those titles)

${JOURNEY_FIRST_RULES}

${DESTINATION_FIRST_RULES}

Rules:
- Only plan emptyDays; never invent other days or change occupiedDays.
- Return EVERY emptyDay (same day numbers and dates) with at least one concrete place (Umrah rest-only logistics may rarely use []).
- Return a top-level "routes" array that includes:
  (1) every user journey leg (role="user", existingRouteId set),
  (2) every ai_required intercity leg (role="intercity", chosen transport),
  (3) optional local_transfer legs that do not change the journey sequence.
- savedLocations are OPTIONS, not a checklist. Prefer locationId (= savedLocations[].id) when you do schedule one. Never force leftover saved places onto empty days simply because they are available.
- Honor journey.citySequence: after A→B the next city is B; cluster places by the city where the traveler is that day.
- Invent attractions when they clearly serve what is worth doing in this destination and fit time/season/logistics. Prefer real named places over vague activity labels.
- Use provided weather when available=true: very hot → fewer long outdoor blocks in peak heat; rain → indoor/covered; comfortable → outdoor/walking; strong wind → avoid exposed outdoor activities. Never invent weather. If available=false, ignore weather for that date.
- Use cityIntelligence as soft guidance (safety, apps, climate, local highlights, local transport).
- Place count follows leisure intensity (often 1–3). There is no quota to maximize places, and empty days are not the default.
- Short practical titles/descriptions that name the day's concrete focus (e.g. waterfront walk + café, museum morning, park and viewpoint).
- Every place category from: ${PLACE_CATEGORIES.join(", ")}.
- cityName/countryName may match user language.
- cityId = lowercase ASCII English city slug; countryId = ISO alpha-2 lowercase; countryCode = ISO alpha-2 uppercase.
- Include per-place priceAmount, priceCurrency, priceLabel, and link when a place is scheduled. Never invent a whole-trip total.
- Single JSON object only (no markdown). Escape every double-quote inside string values (e.g. see the \\"Blue Mosque\\"). No trailing commas.

{"days":[{"day":1,"date":"YYYY-MM-DD","title":"","description":"","places":[{"locationId":"","title":"","description":"","lat":0,"lon":0,"cityName":"","countryName":"","cityId":"","countryId":"","countryCode":"","why":"","category":"attraction","priceAmount":0,"priceCurrency":"USD","priceLabel":"Free","link":"https://example.com"}]}],"routes":[{"day":1,"date":"YYYY-MM-DD","insertAt":0,"role":"intercity","from":{"name":"","city":"","country":"","code":"","location":{"lat":0,"lon":0}},"to":{"name":"","city":"","country":"","location":{"lat":0,"lon":0}},"transport":"bus","departure":{"datetime":"YYYY-MM-DDT00:00:00Z","timezone":"","timeKnown":false},"durationMinutes":180,"durationApproximate":true,"priceAmount":0,"priceCurrency":"USD","priceLabel":"≈ 25 USD","link":"https://example.com","note":""}]}`;

function leisurePreferenceBlock(
  leisureType: LeisureType,
  leisureCustom?: string
): string {
  const customFocus = leisureCustom?.trim();
  const label =
    leisureType === "custom" && customFocus
      ? `user focus: ${customFocus}`
      : LEISURE_LABELS[leisureType];
  const intensity =
    leisureType === "custom" && customFocus
      ? `Custom leisure preference:\n- Prioritize: ${customFocus}.\n- Suggest real venues/operators for these when they exist here.\n- If unavailable, offer the closest strong alternative and still fill each empty day with ≥1 concrete place.`
      : LEISURE_INTENSITY[leisureType];

  return [
    `LEISURE PREFERENCE (hint, not a filter): typeOfLeisure="${leisureType}" (${label}).`,
    leisureType === "custom" && customFocus
      ? `leisureCustom="${customFocus}"`
      : "",
    "Influence style and intensity with this preference, but prioritize destination-specific relevance, available time, and season first.",
    intensity,
    "",
    DESTINATION_FIRST_RULES,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildPlanTripUserPrompt(input: {
  context: TripPlanningContext;
  language: string;
}): string {
  const { context } = input;
  const leisureType = context.trip.leisureType;
  const leisureCustom = context.trip.leisureCustom?.trim();
  const leisure =
    leisureType === "custom" && leisureCustom
      ? `user focus: ${leisureCustom}`
      : LEISURE_LABELS[leisureType];
  const currency = (context.trip.currency ?? "USD").trim().toUpperCase() || "USD";
  const primary =
    context.trip.destinations.find((d) => d.city)?.city ||
    context.trip.destinations[0]?.name ||
    "Destination";
  const country =
    context.trip.destinations[0]?.country ||
    context.trip.from.country ||
    "";

  const lines = [
    `Language for titles/descriptions: ${input.language}`,
    `Currency for place and transfer prices: ${currency}`,
    `Primary destination hint: ${primary}${country ? `, ${country}` : ""}`,
    `Leisure preference (hint): ${leisureType} (${leisure})`,
    leisureType === "custom" && leisureCustom
      ? `leisureCustom: ${leisureCustom}`
      : "",
    `Categories: ${PLACE_CATEGORIES.join(", ")}`,
    "cityId/countryId/countryCode stay English/ASCII.",
    "",
    "JOURNEY (read first):",
    context.journey.summary,
    `City sequence: ${context.journey.citySequence.map((c) => c.city).join(" → ")}`,
    `Missing connections to generate: ${context.journey.missingConnectionCount}`,
    "",
    leisurePreferenceBlock(leisureType, leisureCustom),
    "",
    JOURNEY_FIRST_RULES,
    "",
    PRICE_AND_LINK_RULES,
    "",
    TRANSPORT_TRANSFER_RULES,
    "",
  ].filter(Boolean);

  if (leisureType === "umrah") {
    lines.push(UMRAH_PLANNING_RULES, "");
  }

  lines.push(
    "TripPlanningContext (analyze journey FIRST, then plan emptyDays + routes):",
    JSON.stringify(context),
    "",
    "JSON with days (every empty day, ≥1 concrete place) and routes (user legs + missing intercity + optional local transfers)."
  );

  return lines.join("\n");
}
