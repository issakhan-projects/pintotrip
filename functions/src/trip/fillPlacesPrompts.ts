/**
 * Prompts for fillTripPlannerAiPlaces — fill free-time city slots with places.
 * Saved places stay as { locationId }; new places use locations-doc shape.
 */

import type { LeisureType } from "./types";

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
2. PRESERVE every existing {"locationId":"..."} entry in that slot — list them first unchanged.
3. Then ADD new places only when free time remains after saved places.
4. New places MUST use the locations subcollection shape (no googlePhotoUrl).
5. cityId / city.id / country.id must be English ASCII (never localized script).
6. locationId values must come from destinations[].savedPlaces[].id or the slot. Never invent locationIds.
7. NO DUPLICATES ACROSS DAYS: each locationId / place id / title (same city) on at most one day.
7b. EVERY place MUST include bestVisitTime { from, to } as HH:mm and durationMinutes (realistic local window + approx visit length; do not copy example times like 09:00–12:00).
8. Do NOT schedule places in stopType home cities.
9. Respect freeTime.durationMinutes. Rough guide: <90→0–1, 90–240→1–2, 240–480→2–3, 480+→2–4 new places. Arrival/departure half-days with durationMinutes ≥ 90 must still get places — do not leave those slots empty.
10. leisureType is a preference hint, not a hard filter.
11. Prefer real named places. Include approximate lat/lon (server verifies against Google Maps).
12. ALWAYS include price + links on every NEW place when known:
    - price: { amount, currency, label } for ticket/entry/service (or Free).
    - links: [{ url, label }] official / tickets / booking https URLs (label "Tickets", "Book", "Official site").

PART B — NON-FLIGHT ROUTES (price + link):
11. For each route with transport NOT "flight", return approximate one-way adult fare + official https booking/timetable URL when known.
12. NEVER add priceAmount / priceCurrency / priceLabel / link for transport "flight".
13. Identify each route by day + routeIndex (0-based in that day's routes array).

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
            { "id": "new-slug", "title": "", "description": "", "cityId": "", "status": "planned", "category": "attraction", "location": { "lat": 0, "lon": 0 }, "city": { "id": "", "name": "" }, "country": { "id": "", "name": "" }, "images": [], "price": { "amount": 45, "currency": "AED", "label": "≈ 45 AED" }, "links": [{ "url": "https://example.com/tickets", "label": "Tickets" }], "ai": { "why": "", "model": "fillTripPlannerAiPlaces" }, "source": { "type": "manual" }, "confidence": 0.7 }
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

Return strict JSON only.`;

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
    "DESTINATIONS:",
    input.destinationsJson,
    "",
    "ITINERARY (places + routes with routeIndex; fill places and non-flight fare/link):",
    input.itineraryJson,
    "",
    "Return itinerary with places filled and non-flight route price/link enrichment. Never fare flights.",
  ].join("\n");
}
