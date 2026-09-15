import type {
  LeisureType,
  PlanTripDestination,
  PlanTripExistingDay,
  PlanTripSavedPlace,
  PlanTripWeatherDay,
} from "./types";
import { PLACE_CATEGORIES } from "./types";

const LEISURE_LABELS: Record<LeisureType, string> = {
  sightseeing: "sightseeing, landmarks, museums, and culture — an active discovery trip",
  food: "food, cafes, markets, and culinary experiences — meals are the purpose, not packing attractions",
  nature:
    "nature, parks, viewpoints, hiking, and outdoors — with reasonable rest between active days",
  nightlife:
    "nightlife and evening experiences — days stay lighter so nights can be the focus",
  shopping: "shopping, markets, and local crafts — browsing, not a sightseeing marathon",
  relaxation:
    "relaxation, wellness, beach, and slow travel — free time is the point, not a gap to fill",
  adventure:
    "adventure and active experiences — intense activity with recovery time",
  family:
    "family-friendly travel — kid-paced days with downtime, not a packed adult schedule",
  mixed: "a balanced mix of culture, food, and local experiences with unscheduled time",
  umrah:
    "Umrah pilgrimage — worship and rest are the purpose; sightseeing is optional",
};

const LEISURE_INTENSITY: Record<LeisureType, string> = {
  sightseeing: `City / sightseeing:
- Discovery is the purpose. A more active itinerary is appropriate.
- 2–4 places on sightseeing days is fine.
- Still leave some open time; do not treat every hour as a slot to fill.`,
  food: `Food:
- Culinary experiences are the purpose.
- 1–3 food-focused stops per day. Do not pad remaining hours with unrelated attractions.`,
  nature: `Nature:
- Prioritize nature activities, hiking, parks, and viewpoints.
- 1–3 outdoor activities on active days; keep reasonable rest after long hikes.
- Do not fill leftover hours with city sightseeing by default.`,
  nightlife: `Nightlife:
- Evenings are the purpose. Daytime should stay light (0–2 places).
- 1–3 evening venues. Days may be mostly free.`,
  shopping: `Shopping:
- Markets, boutiques, and crafts are the purpose.
- 1–3 shopping areas. Do not fill remaining hours with museums by default.`,
  relaxation: `Beach / relaxation:
- A person may travel for 7 days and spend most of the trip relaxing at the beach.
- Do NOT fill all days with attractions.
- Priority: relaxation → free time → a few selected activities → optional sightseeing.
- 0–2 places per day is typical. Consecutive days with an empty places array are correct.
- A relaxed schedule with significant free time is the right outcome.`,
  adventure: `Adventure:
- Active experiences are the purpose, with recovery.
- 1–2 big activities on active days; recovery days with 0–1 places are correct.`,
  family: `Family:
- Kid-paced days. 1–3 places, shorter blocks, afternoon rest.
- Do not pack an adult sightseeing marathon.`,
  mixed: `Mixed:
- Balanced days: 1–3 places and unscheduled time every day.
- Do not maximize place count.`,
  umrah: `Umrah planner:
- The primary purpose is worship, not sightseeing.
- Priority: worship → Makkah / Masjid al-Haram → Madinah / Al-Masjid an-Nabawi → rest → optional religious/historical places → optional sightseeing.
- In Makkah, spending most of the time around Masjid al-Haram is completely valid.
- Do NOT fill the itinerary with tourist attractions just because saved places exist.
- Most days should have 0–2 places. Rest/worship days with [] places are correct.`,
};

const UMRAH_PLANNING_RULES = `Umrah planner (Saudi Arabia only):
- Optimize for worship and rest, not for covering attractions.
- Span Makkah (Mecca) and Madinah (Medina) when destinations/dates allow, even if the trip's primary city is only one of them.
- Core focus only as needed: Masjid al-Haram (Kaaba / Umrah rites) in Makkah and Al-Masjid an-Nabawi (Prophet's Mosque) in Madinah. Repeating these as a day's entire plan is valid.
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
- If unsure of exact price, give a reasonable approximate and say so in priceLabel (prefix with ≈ or "from").
- Rest/free/worship days with no scheduled places need no prices.`;

export const PLAN_TRIP_SYSTEM_PROMPT = `Travel itinerary planner for PinToTrip.

IMPORTANT — leisure type controls the itinerary.
Do NOT assume the goal is to visit as many places as possible.
typeOfLeisure is the PRIMARY PURPOSE and must decide: intensity, how much free time remains, which saved places (if any) get scheduled, and whether sightseeing is primary or optional.
Trip duration ≠ number of places to visit. Unused time is not a problem. A successful itinerary can intentionally contain large amounts of free time.

Rules:
- Only plan emptyDays; never invent other days or change occupiedDays.
- Return EVERY emptyDay (same day numbers and dates), even when places is [].
- savedPlaces are OPTIONS, not a checklist. Prefer locationId when you do schedule one. Never force leftover saved places onto empty days simply because they are available.
- Invent extra attractions only when they clearly serve the leisure purpose AND saved options are insufficient for that purpose. Never invent filler to "use up" the day.
- Cluster geographically: nearby places on the same day; avoid back-and-forth between distant cities. Honor city startDate/endDate windows when given.
- Use provided weather when available=true: very hot → fewer long outdoor blocks in peak heat; rain → indoor/covered; comfortable → outdoor/walking; strong wind → avoid exposed outdoor activities. Never invent weather. If available=false, ignore weather for that date.
- Place count follows leisure intensity (often 0). There is no quota of 2–4 places per day.
- Short practical titles/descriptions that state the day's purpose (e.g. rest, worship, beach, sightseeing).
- Every place category from: ${PLACE_CATEGORIES.join(", ")}.
- cityName/countryName may match user language.
- cityId = lowercase ASCII English city slug; countryId = ISO alpha-2 lowercase; countryCode = ISO alpha-2 uppercase.
- Include per-place priceAmount, priceCurrency, priceLabel, and link when a place is scheduled. Never invent a whole-trip total.
- Single JSON object only (no markdown).

{"days":[{"day":1,"date":"YYYY-MM-DD","title":"","description":"","places":[{"locationId":"","title":"","description":"","lat":0,"lon":0,"cityName":"","countryName":"","cityId":"","countryId":"","countryCode":"","why":"","category":"attraction","priceAmount":0,"priceCurrency":"USD","priceLabel":"Free","link":"https://example.com"}]},{"day":2,"date":"YYYY-MM-DD","title":"Free time","description":"Unstructured rest. Nothing scheduled.","places":[]}]}`;

function leisurePurposeBlock(leisureType: LeisureType): string {
  return [
    `PRIMARY PURPOSE: typeOfLeisure="${leisureType}" (${LEISURE_LABELS[leisureType]}).`,
    "Optimize the trip for this purpose, not for the maximum number of places.",
    LEISURE_INTENSITY[leisureType],
  ].join("\n");
}

export function buildPlanTripUserPrompt(input: {
  cityName: string;
  countryName: string;
  lat?: number;
  lon?: number;
  leisureType: LeisureType;
  language: string;
  currency: string;
  emptyDays: PlanTripExistingDay[];
  occupiedDays: PlanTripExistingDay[];
  destinations?: PlanTripDestination[];
  savedPlaces?: PlanTripSavedPlace[];
  weather?: PlanTripWeatherDay[];
}): string {
  const leisure = LEISURE_LABELS[input.leisureType];
  const currency = input.currency.trim().toUpperCase() || "USD";
  const coords =
    typeof input.lat === "number" && typeof input.lon === "number"
      ? `Center: ${input.lat}, ${input.lon}`
      : "Coordinates unknown — use city center.";

  const lines = [
    `Destination: ${input.cityName}, ${input.countryName}`,
    coords,
    `Leisure: ${input.leisureType} (${leisure})`,
    `Language: ${input.language}`,
    `Currency for place prices: ${currency}`,
    `Categories: ${PLACE_CATEGORIES.join(", ")}`,
    "cityId/countryId/countryCode stay English/ASCII.",
    "",
    leisurePurposeBlock(input.leisureType),
    "",
    PRICE_AND_LINK_RULES,
    "",
  ];

  if (input.destinations && input.destinations.length > 0) {
    lines.push(
      "All destinations (honor city dates when set):",
      JSON.stringify(input.destinations),
      ""
    );
  }

  if (input.savedPlaces && input.savedPlaces.length > 0) {
    lines.push(
      "SAVED PLACES are OPTIONS (not a quota). Schedule only those that serve this leisure type. Copy locationId, title, lat, lon, city when used. Leave the rest unscheduled:",
      JSON.stringify(input.savedPlaces),
      ""
    );
  }

  if (input.weather && input.weather.length > 0) {
    lines.push(
      "WEATHER by date (use when available=true; never invent missing values):",
      JSON.stringify(input.weather),
      ""
    );
  }

  if (input.leisureType === "umrah") {
    lines.push(UMRAH_PLANNING_RULES, "");
  }

  lines.push(
    "Empty days (return exactly these day numbers/dates; places may be []):",
    JSON.stringify(input.emptyDays),
    "",
    "Occupied (do not fill; avoid these titles):",
    JSON.stringify(input.occupiedDays),
    "",
    "JSON for empty days only."
  );

  return lines.join("\n");
}
