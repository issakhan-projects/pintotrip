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
2. PRESERVE every existing {"locationId":"..."} entry — list them first unchanged.
3. Then ADD new places only when free time remains after saved places.
4. New places MUST use the locations subcollection shape (no googlePhotoUrl).
5. cityId / city.id / country.id must be English ASCII (never localized script).
6. Do NOT invent locationId values. Only echo ids from the slot's existing places.
7. Do NOT schedule places in stopType home cities.
8. Respect freeTime.durationMinutes. Rough guide: <90→0–1, 90–240→1–2, 240–480→2–3, 480+→2–4 new places.
9. leisureType is a preference hint, not a hard filter.
10. Prefer real named places with plausible lat/lon. Omit place price/links when unknown.

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
            { "id": "new-slug", "title": "", "description": "", "cityId": "", "status": "planned", "category": "attraction", "location": { "lat": 0, "lon": 0 }, "city": { "id": "", "name": "" }, "country": { "id": "", "name": "" }, "images": [], "ai": { "why": "", "model": "fillTripPlannerAiPlaces" }, "source": { "type": "manual" }, "confidence": 0.7 }
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
