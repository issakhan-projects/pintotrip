/**
 * Around Me — place type catalog + Google Places search mapping.
 * Machine `id` values are English/ASCII; labels are display-only.
 */

export const AROUND_ME_TYPES = [
  { id: "attractions", label: "Attractions", icon: "📸" },
  { id: "museums", label: "Museums", icon: "🏛️" },
  { id: "beaches", label: "Beaches", icon: "🏖️" },
  { id: "nature", label: "Nature", icon: "🌿" },
  { id: "viewpoints", label: "Viewpoints", icon: "🌅" },
  { id: "parks", label: "Parks", icon: "🌳" },
  { id: "cafes", label: "Cafés", icon: "☕" },
  { id: "restaurants", label: "Restaurants", icon: "🍽️" },
  { id: "shopping", label: "Shopping", icon: "🛍️" },
  { id: "entertainment", label: "Entertainment", icon: "🎭" },
  { id: "nightlife", label: "Nightlife", icon: "🌙" },
  { id: "religious", label: "Religious Sites", icon: "🕌" },
  { id: "historic", label: "Historic Places", icon: "🏛️" },
  { id: "family", label: "Family", icon: "👨‍👩‍👧" },
  { id: "activities", label: "Activities", icon: "🎯" },
  { id: "hidden_gems", label: "Hidden Gems", icon: "💎" },
  { id: "mix", label: "Mix", icon: "✨" },
] as const;

export type AroundMeTypeId = (typeof AROUND_ME_TYPES)[number]["id"];

/** Allowed search radii (km) for Around Me. */
export const AROUND_ME_RADIUS_KM_OPTIONS = [5, 10, 20, 30] as const;
export type AroundMeRadiusKm = (typeof AROUND_ME_RADIUS_KM_OPTIONS)[number];
export const DEFAULT_AROUND_ME_RADIUS_KM: AroundMeRadiusKm = 5;

const AROUND_ME_RADIUS_KM_SET = new Set<number>(AROUND_ME_RADIUS_KM_OPTIONS);

export function isAroundMeRadiusKm(value: number): value is AroundMeRadiusKm {
  return AROUND_ME_RADIUS_KM_SET.has(value);
}

const AROUND_ME_TYPE_IDS = new Set<string>(
  AROUND_ME_TYPES.map((t) => t.id)
);

export function isAroundMeTypeId(value: string): value is AroundMeTypeId {
  return AROUND_ME_TYPE_IDS.has(value);
}

export function aroundMeTypeLabel(typeId: AroundMeTypeId): string {
  return AROUND_ME_TYPES.find((t) => t.id === typeId)?.label ?? typeId;
}

/** Nearby Search (New) includedTypes, or text query when Nearby is a poor fit. */
export type AroundMeSearchStrategy =
  | { mode: "nearby"; includedTypes: string[] }
  | { mode: "text"; textQuery: string; includedType?: string };

export const AROUND_ME_SEARCH: Record<AroundMeTypeId, AroundMeSearchStrategy> =
  {
    attractions: { mode: "nearby", includedTypes: ["tourist_attraction"] },
    museums: { mode: "nearby", includedTypes: ["museum"] },
    beaches: { mode: "nearby", includedTypes: ["beach"] },
    nature: {
      mode: "nearby",
      includedTypes: ["park", "national_park", "hiking_area"],
    },
    viewpoints: {
      mode: "text",
      textQuery: "scenic viewpoint lookout",
    },
    parks: { mode: "nearby", includedTypes: ["park"] },
    cafes: { mode: "nearby", includedTypes: ["cafe"] },
    restaurants: { mode: "nearby", includedTypes: ["restaurant"] },
    shopping: {
      mode: "nearby",
      includedTypes: ["shopping_mall"],
    },
    entertainment: {
      mode: "nearby",
      includedTypes: ["amusement_park", "movie_theater", "bowling_alley"],
    },
    nightlife: { mode: "nearby", includedTypes: ["night_club", "bar"] },
    religious: { mode: "nearby", includedTypes: ["place_of_worship"] },
    historic: {
      mode: "nearby",
      includedTypes: ["historical_landmark"],
    },
    family: {
      mode: "nearby",
      includedTypes: ["zoo", "aquarium", "amusement_park"],
    },
    activities: { mode: "nearby", includedTypes: ["tourist_attraction"] },
    hidden_gems: {
      mode: "text",
      textQuery: "hidden gems local favorites",
    },
    mix: {
      mode: "text",
      textQuery: "popular places to visit",
    },
  };
