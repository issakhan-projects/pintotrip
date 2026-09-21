/**
 * Client types for the planTrip Cloud Function.
 * Mirrored from functions/src/trip/types.ts for UI + callable payloads.
 */

export const LEISURE_TYPES = [
  "sightseeing",
  "food",
  "nature",
  "nightlife",
  "shopping",
  "relaxation",
  "adventure",
  "family",
  "mixed",
  "custom",
  "umrah",
] as const;

export type LeisureType = (typeof LEISURE_TYPES)[number];

/** Max length for free-text leisure when leisureType is "custom". */
export const LEISURE_CUSTOM_MAX_LENGTH = 120;

export const PLACE_CATEGORIES = [
  "attraction",
  "beach",
  "museum",
  "landmark",
  "food",
  "cafe",
  "park",
  "viewpoint",
  "nightlife",
  "shopping",
  "market",
  "nature",
  "adventure",
  "wellness",
  "neighborhood",
  "transport",
  "other",
] as const;

export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

export const PLACE_CATEGORY_LABELS: Record<PlaceCategory, string> = {
  attraction: "Attraction",
  beach: "Beach",
  museum: "Museum",
  landmark: "Landmark",
  food: "Food",
  cafe: "Cafe",
  park: "Park",
  viewpoint: "Viewpoint",
  nightlife: "Nightlife",
  shopping: "Shopping",
  market: "Market",
  nature: "Nature",
  adventure: "Adventure",
  wellness: "Wellness",
  neighborhood: "Neighborhood",
  transport: "Transport",
  other: "Other",
};

export const LEISURE_TYPE_OPTIONS: Array<{
  value: LeisureType;
  label: string;
  description: string;
}> = [
  {
    value: "sightseeing",
    label: "Sightseeing & culture",
    description: "Landmarks, museums, and neighborhoods",
  },
  {
    value: "food",
    label: "Food & culinary",
    description: "Cafes, markets, and local dining",
  },
  {
    value: "nature",
    label: "Nature & outdoors",
    description: "Parks, viewpoints, and walks",
  },
  {
    value: "nightlife",
    label: "Nightlife",
    description: "Evening entertainment and bars",
  },
  {
    value: "shopping",
    label: "Shopping",
    description: "Markets, boutiques, and crafts",
  },
  {
    value: "relaxation",
    label: "Relaxation",
    description: "Wellness, beaches, and slow days",
  },
  {
    value: "adventure",
    label: "Adventure",
    description: "Active and outdoorsy experiences",
  },
  {
    value: "family",
    label: "Family-friendly",
    description: "Kid-friendly attractions",
  },
  {
    value: "mixed",
    label: "Mixed / balanced",
    description: "Culture, food, and local favorites",
  },
  {
    value: "custom",
    label: "Custom",
    description: "Describe what you want — surfing, diving, skydiving, etc.",
  },
  {
    value: "umrah",
    label: "Umrah planner",
    description: "Worship-first plan for Makkah & Madinah, with rest and optional ziyarat",
  },
];

export type PlanTripMode = "generate" | "regenerate";

/** Still used by PlanTripSheet UI for empty-day preview before the callable. */
export interface PlanTripExistingDay {
  day: number;
  date: string;
  title?: string;
  placeTitles: string[];
}

/** Client → planTrip callable. Server loads trip, routes, places, weather. */
export interface PlanTripRequest {
  tripId: string;
  language?: string;
  /** User temperature preference — drives OpenWeather metric/imperial. */
  temperatureType?: "celsius" | "fahrenheit";
  /** @deprecated Prefer temperatureType. */
  temperatureUnit?: "celsius" | "fahrenheit";
  mode?: PlanTripMode;
}

export interface PlannedPlaceSuggestion {
  title: string;
  description: string;
  lat: number;
  lon: number;
  cityName: string;
  countryName: string;
  /** English/ASCII city slug for location.city.id */
  cityId?: string;
  /** ISO alpha-2 lowercase preferred for location.country.id */
  countryId?: string;
  /** ISO 3166-1 alpha-2 */
  countryCode?: string;
  /** Existing saved location id — prefer this over inventing a new place. */
  locationId?: string;
  why: string;
  category: PlaceCategory;
  /**
   * Estimated unit price for THIS place only (ticket, fare, entry) —
   * never a whole-trip total.
   */
  priceAmount?: number;
  /** ISO 4217, should match request currency when possible. */
  priceCurrency?: string;
  /** Human label e.g. "≈ 45 USD", "Free", "from 12 EUR". */
  priceLabel?: string;
  /** Booking / tickets / timetable URL when available. */
  link?: string;
  /**
   * Google Maps place photo URI when resolved on the client after planTrip.
   * Optional — UI must fall back when empty/null.
   */
  imageUrl?: string | null;
}

export interface PlannedDaySuggestion {
  day: number;
  date: string;
  title: string;
  description?: string;
  places: PlannedPlaceSuggestion[];
}

/**
 * Transport route in the planTrip response.
 * Includes preserved user routes AND AI-generated missing/local legs.
 * Persisted to the existing TripRoute collection (new legs only).
 */
export interface PlannedRouteSuggestion {
  day: number;
  date: string;
  /** 0 = before first place; places.length = after last place. */
  insertAt: number;
  from: {
    name: string;
    city: string;
    country?: string;
    placeId?: string;
    code?: string;
    location?: { lat: number; lon: number };
  };
  to: {
    name: string;
    city: string;
    country?: string;
    placeId?: string;
    code?: string;
    location?: { lat: number; lon: number };
  };
  transport:
    | "flight"
    | "train"
    | "bus"
    | "metro"
    | "taxi"
    | "airport_transfer"
    | "car"
    | "ferry"
    | "other";
  departure?: { datetime: string; timezone: string; timeKnown?: boolean };
  arrival?: { datetime: string; timezone: string; timeKnown?: boolean };
  durationMinutes?: number;
  durationApproximate?: boolean;
  note?: string;
  priceAmount?: number;
  priceCurrency?: string;
  priceLabel?: string;
  link?: string;
  /** user = existing TripRoute; intercity = missing connection; local_transfer = secondary. */
  role?: "user" | "intercity" | "local_transfer";
  /** When role=user — existing route id; client must not create a duplicate. */
  existingRouteId?: string;
}

export interface PlanTripResult {
  success: true;
  leisureType: LeisureType;
  days: PlannedDaySuggestion[];
  routes: PlannedRouteSuggestion[];
  creditsCharged: number;
  remainingCredits: number;
  model: string;
}
