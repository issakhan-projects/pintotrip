/**
 * Prompts for findAroundMe — enrich Nearby Search hits into locations shape.
 */

import type { AroundMeTypeId } from "./aroundMeTypes";
import { aroundMeTypeLabel } from "./aroundMeTypes";

export const AROUND_ME_SYSTEM_PROMPT = `You enrich Google Places nearby results into PinToTrip location documents.

RULES:
1. Output ONLY valid JSON matching the schema below.
2. Enrich EVERY provided place (same count and order). Do not invent new places.
3. Keep googlePlaceId, lat, lon EXACTLY as given — never invent or change coordinates.
4. city.name / country.name MUST match the provided user city/country (do not move places to another country).
5. title may be localized to the user language; placeId / city.id / country.id must be English/ASCII lowercase slugs (or ISO country alpha-2 lowercase). Never use localized script in ids. Never use "unknown".
6. country.id MUST be the provided ISO country id (e.g. "kz" for Kazakhstan).
7. category must be one of: attraction, beach, museum, landmark, food, cafe, park, viewpoint, nightlife, shopping, market, nature, adventure, wellness, neighborhood, transport, other.
8. description: 1–3 useful traveler sentences about THIS place in THIS city (most interesting facts).
9. ai.why: short reason this is one of the most interesting nearby picks for the requested type.
10. Include price + links when reasonably known (local currency preferred):
   - price: { amount, currency, label } or Free
   - links: [{ url, label }] official / tickets / maps https URLs
11. status is always "planned". images is always [].
12. source.type is always "around_me".
13. confidence is 0–1 (how well this place matches the requested type and how noteworthy it is).
14. NEVER invent famous places from other countries (especially USA) that were not in the input list.

OUTPUT SCHEMA:
{
  "places": [
    {
      "googlePlaceId": "",
      "id": "english-ascii-slug",
      "title": "",
      "description": "",
      "note": "",
      "status": "planned",
      "category": "attraction",
      "location": { "lat": 0, "lon": 0 },
      "city": { "id": "city-slug", "name": "City" },
      "country": { "id": "xx", "name": "Country" },
      "images": [],
      "price": { "amount": 0, "currency": "USD", "label": "Free" },
      "links": [{ "url": "https://…", "label": "Official site" }],
      "confidence": 0.85,
      "ai": { "why": "", "model": "findAroundMe" },
      "source": { "type": "around_me" }
    }
  ]
}`;

export function buildAroundMeUserPrompt(input: {
  language?: string;
  typeId: AroundMeTypeId;
  cityNameEn?: string;
  countryNameEn?: string;
  countryId?: string;
  cityId?: string;
  userLat: number;
  userLon: number;
  placesJson: string;
}): string {
  const language = input.language?.trim() || "en";
  const typeLabel = aroundMeTypeLabel(input.typeId);
  return [
    `User language for display strings: ${language}`,
    `Requested around-me type: ${input.typeId} (${typeLabel})`,
    `User coordinates: ${input.userLat}, ${input.userLon}`,
    `User city (REQUIRED for city.name / city.id): ${input.cityNameEn || ""} (id: ${input.cityId || ""})`,
    `User country (REQUIRED for country.name / country.id): ${input.countryNameEn || ""} (id: ${input.countryId || ""})`,
    "Only enrich the Google Places hits below. They are already near the user — do not relocate them.",
    "",
    "Google Places hits (keep googlePlaceId + lat + lon unchanged):",
    input.placesJson,
  ].join("\n");
}
