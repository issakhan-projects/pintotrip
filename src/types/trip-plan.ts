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
  "umrah",
] as const;

export type LeisureType = (typeof LEISURE_TYPES)[number];

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
    value: "umrah",
    label: "Umrah planner",
    description: "Worship-first plan for Makkah & Madinah, with rest and optional ziyarat",
  },
];

export type PlanTripMode = "generate" | "regenerate";

export interface PlanTripExistingDay {
  day: number;
  date: string;
  title?: string;
  placeTitles: string[];
}

export interface PlanTripSavedPlace {
  locationId: string;
  title: string;
  lat: number;
  lon: number;
  cityName: string;
  countryName: string;
  cityId?: string;
  countryId?: string;
  status: string;
  category?: string;
}

export interface PlanTripWeatherDay {
  date: string;
  cityName?: string;
  available: boolean;
  tempMin?: number;
  tempMax?: number;
  temp?: number;
  description?: string;
  icon?: string;
  humidity?: number;
  windSpeed?: number;
  precipitationChance?: number;
  units?: "metric" | "imperial";
}

export interface PlanTripDestination {
  cityName: string;
  countryName: string;
  countryId?: string;
  cityId?: string;
  lat?: number;
  lon?: number;
  /** YYYY-MM-DD when the traveler set city dates. */
  startDate?: string;
  endDate?: string;
}

export interface PlanTripRequest {
  tripId: string;
  destination: {
    cityName: string;
    countryName: string;
    /** ISO alpha-2 lowercase when known (e.g. "sa"). */
    countryId?: string;
    cityId?: string;
    lat?: number;
    lon?: number;
  };
  startDate: string;
  endDate: string;
  leisureType: LeisureType;
  mode?: PlanTripMode;
  language?: string;
  /** ISO 4217 currency for per-place price estimates (trip currency). */
  currency?: string;
  existingDays: PlanTripExistingDay[];
  destinations?: PlanTripDestination[];
  savedPlaces?: PlanTripSavedPlace[];
  weather?: PlanTripWeatherDay[];
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

export interface PlanTripResult {
  success: true;
  leisureType: LeisureType;
  days: PlannedDaySuggestion[];
  creditsCharged: number;
  remainingCredits: number;
  model: string;
}
