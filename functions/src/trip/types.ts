/**
 * planTrip — AI itinerary suggestions for empty trip days.
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

export type PlanTripMode = "generate" | "regenerate";

export interface PlanTripExistingDay {
  day: number;
  /** YYYY-MM-DD */
  date: string;
  title?: string;
  /** Titles of places already on this day (day is skipped if non-empty). */
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
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
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
  /** Existing saved location id when organizing the traveler's places. */
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
   * Google Maps place photo URI — filled by the client after planTrip
   * (not returned by the Cloud Function). Optional; UI must handle null.
   */
  imageUrl?: string | null;
}

export interface PlannedDaySuggestion {
  day: number;
  /** YYYY-MM-DD */
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
