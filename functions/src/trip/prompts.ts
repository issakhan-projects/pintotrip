import type { LeisureType, PlanTripExistingDay } from "./types";
import { PLACE_CATEGORIES } from "./types";

const LEISURE_LABELS: Record<LeisureType, string> = {
  sightseeing: "sightseeing, landmarks, museums, and culture",
  food: "food, cafes, markets, and culinary experiences",
  nature: "nature, parks, viewpoints, and outdoors",
  nightlife: "nightlife, entertainment, and evening experiences",
  shopping: "shopping, markets, and local crafts",
  relaxation: "relaxation, wellness, and slow travel",
  adventure: "adventure and active experiences",
  family: "family-friendly attractions",
  mixed: "a balanced mix of culture, food, and local experiences",
  umrah:
    "Umrah pilgrimage across Makkah and Madinah, including rites, ziyarat, and intercity train or bus",
};

const UMRAH_PLANNING_RULES = `Umrah mode (Saudi Arabia only):
- Plan a real Umrah itinerary spanning BOTH Makkah (Mecca) and Madinah (Medina), even if the trip destination is only one city.
- Include core sacred sites: Masjid al-Haram (Kaaba / Umrah rites area) in Makkah and Masjid an-Nabawi (Prophet's Mosque) in Madinah.
- Add classic ziyarat when days allow (e.g. Quba Mosque, Mount Uhud, Masjid Qiblatain, Jabal al-Nour / Cave of Hira, historical Madinah sites). Prefer real named places with accurate coordinates.
- Include intercity transport as place(s) with category "transport": Haramain High Speed Railway stations and/or Makkah–Madinah bus terminals. Put travel on its own day when possible; mention train vs bus in the day title/description.
- For transport: estimate one-way adult fare in the user currency; link to official Haramain / SAPTCO (or current operator) booking pages when known.
- Mosques/ziyarat are typically free — set priceAmount 0, priceLabel "Free", omit ticket links unless an official visitor page exists.
- Sequence days realistically for the empty-day count (e.g. Madinah days → travel day → Makkah Umrah days, or the reverse). Cluster places by city per day; do not mix Makkah and Madinah places on the same day except on a dedicated travel day.
- Keep tone respectful and practical; no nightlife, bars, or entertainment venues.
- cityId examples: makkah, madinah; countryId/countryCode: sa / SA.`;

const PRICE_AND_LINK_RULES = `Per-place prices & booking links (NOT whole-trip totals):
- For each place, estimate the typical adult unit price: entry ticket, tour ticket, or one-way transport fare — never hotel packages or full-trip budgets.
- Convert estimates into the requested currency (priceCurrency must match). Use web search for current fares/tickets when possible.
- priceAmount = number in that currency (0 if free). priceLabel = short display string (e.g. "≈ 45 USD", "Free", "from 12 EUR").
- link = https URL to buy tickets, book seats, or official info/timetable when available (attraction ticket page, train/bus booking, museum shop). Omit if none is reliable.
- Prefer official operator / venue sites over random aggregators. Do not invent fake URLs.
- Food/cafe: optional typical meal price; link only if a real booking/reservation page exists.
- If unsure of exact price, give a reasonable approximate and say so in priceLabel (prefix with ≈ or "from").`;

export const PLAN_TRIP_SYSTEM_PROMPT = `Travel itinerary planner for PinToTrip. Fill EMPTY trip days only with real visitable places.

Rules:
- Only plan emptyDays; never invent other days.
- 2–4 real places per empty day; fit leisure focus; realistic decimal-degree coordinates.
- No duplicates vs occupiedDays or other suggested days; cluster geographically per day.
- Short practical titles/descriptions.
- Every place category from: ${PLACE_CATEGORIES.join(", ")}.
- cityName/countryName may match user language.
- cityId = lowercase ASCII English city slug; countryId = ISO alpha-2 lowercase; countryCode = ISO alpha-2 uppercase.
- Include per-place priceAmount, priceCurrency, priceLabel, and link when possible (see user prompt). Never invent a whole-trip total.
- Single JSON object only (no markdown).

{"days":[{"day":1,"date":"YYYY-MM-DD","title":"","description":"","places":[{"title":"","description":"","lat":0,"lon":0,"cityName":"","countryName":"","cityId":"","countryId":"","countryCode":"","why":"","category":"attraction","priceAmount":0,"priceCurrency":"USD","priceLabel":"Free","link":"https://example.com"}]}]}`;

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
    PRICE_AND_LINK_RULES,
    "",
  ];

  if (input.leisureType === "umrah") {
    lines.push(UMRAH_PLANNING_RULES, "");
  }

  lines.push(
    "Empty days (return exactly these day numbers/dates):",
    JSON.stringify(input.emptyDays),
    "",
    "Occupied (do not fill; avoid these titles):",
    JSON.stringify(input.occupiedDays),
    "",
    "JSON for empty days only."
  );

  return lines.join("\n");
}
