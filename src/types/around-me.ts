/**
 * Around Me — client types mirrored from Cloud Functions.
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

export type AroundMePlaceResult = {
  googlePlaceId: string;
  id: string;
  title: string;
  description: string;
  note?: string;
  status: "planned";
  category?: import("./trip-plan").PlaceCategory;
  lat: number;
  lon: number;
  city: { id: string; name: string };
  country: { id: string; name: string };
  images: Array<{ url: string; source: "user" | "external" }>;
  price?: { amount?: number; currency?: string; label?: string };
  links?: Array<{ url: string; label?: string }>;
  confidence: number;
  ai: { why: string; model: string };
  source: { type: "around_me" };
};

export type FindAroundMeRequest = {
  lat: number;
  lon: number;
  typeId: AroundMeTypeId;
  /** Search radius in km: 5 | 10 | 20 | 30 */
  radiusKm?: AroundMeRadiusKm;
  language?: string;
  /** Optional client-resolved English/ASCII ids (preferred over server geocode). */
  cityId?: string;
  countryId?: string;
  cityName?: string;
  countryName?: string;
};

export type FindAroundMeSuccess = {
  success: true;
  typeId: AroundMeTypeId;
  radiusKm?: AroundMeRadiusKm;
  places: AroundMePlaceResult[];
};
