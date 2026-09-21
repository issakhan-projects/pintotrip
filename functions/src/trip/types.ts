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

export type PlanTripMode = "generate" | "regenerate";

/** Client → planTrip callable. Server loads the rest from Firestore. */
export interface PlanTripRequest {
  tripId: string;
  mode?: PlanTripMode;
  language?: string;
  /** User temperature preference — OpenWeather metric (°C) / imperial (°F). */
  temperatureType?: "celsius" | "fahrenheit";
}

export const TRIP_STOP_TYPES = ["destination", "transit"] as const;
export type TripStopType = (typeof TRIP_STOP_TYPES)[number];

/** Endpoint of a trip route / city pin for AI context. */
export type RoutePoint = {
  name: string;
  city: string;
  country?: string;
  /** Google Place id or city id when known (ASCII). */
  placeId?: string;
  /** IATA / station code when known (e.g. "ALA"). */
  code?: string;
  location?: {
    lat: number;
    lon: number;
  };
  /** Destination date window when set on the trip stop. */
  startDate?: string;
  endDate?: string;
  cityId?: string;
  countryId?: string;
  /** Advanced multi-city: stay destination vs pass-through. */
  stopType?: TripStopType;
};

/** One city appearance in the complete journey (repeats allowed). */
export type TripPlanningJourneyCity = {
  name: string;
  city: string;
  country?: string;
  cityId?: string;
  countryId?: string;
  placeId?: string;
  code?: string;
  location?: { lat: number; lon: number };
  stopType?: TripStopType | "origin";
};

/**
 * One movement in the complete journey.
 * `user` = existing TripRoute (fixed). `ai_required` = missing connection AI must generate.
 */
export type TripPlanningJourneyLeg = {
  order: number;
  from: TripPlanningJourneyCity;
  to: TripPlanningJourneyCity;
  source: "user" | "ai_required";
  existingRouteId?: string;
  transport?: TripRouteTransport;
  departure?: TripRouteInstant;
  arrival?: TripRouteInstant;
  durationMinutes?: number;
  note?: string;
  reason?: string;
};

/**
 * Complete journey constructed BEFORE itinerary generation.
 * Do not deduplicate cities; transit/destination cities may appear multiple times.
 */
export type TripPlanningJourney = {
  citySequence: TripPlanningJourneyCity[];
  legs: TripPlanningJourneyLeg[];
  summary: string;
  missingConnectionCount: number;
};

export const TRIP_ROUTE_TRANSPORTS = [
  "flight",
  "train",
  "bus",
  "metro",
  "taxi",
  "airport_transfer",
  "car",
  "ferry",
  "other",
] as const;

export type TripRouteTransport = (typeof TRIP_ROUTE_TRANSPORTS)[number];

export type TripRouteStatus = "planned" | "in_progress" | "done";

export type TripRouteInstant = {
  datetime: string;
  timezone: string;
  /**
   * false = only the calendar date is known (time in datetime is a placeholder).
   * true = exact clock time is known. Omit/undefined treated as unknown legacy data.
   */
  timeKnown?: boolean;
};

/** Slim route leg for AI (attachments omitted). */
export type TripRouteContext = {
  id: string;
  order: number;
  from: RoutePoint;
  to: RoutePoint;
  transport: TripRouteTransport;
  departure?: TripRouteInstant;
  arrival?: TripRouteInstant;
  durationMinutes?: number;
  durationApproximate?: boolean;
  status: TripRouteStatus;
  note?: string;
  airline?: string;
  flightNumber?: string;
  priceAmount?: number;
  priceCurrency?: string;
  priceLabel?: string;
  link?: string;
};

/** Stay already saved on the trip — used for airport ↔ hotel transfers. */
export type TripPlanningAccommodation = {
  id: string;
  name?: string;
  address?: string;
  cityName?: string;
  countryName?: string;
  lat?: number;
  lon?: number;
  startDate?: string;
  endDate?: string;
  link?: string;
};

export type TripPlanningSavedLocation = {
  id: string;
  title: string;
  description?: string;
  city: string;
  country: string;
  location: {
    lat: number;
    lon: number;
  };
  images?: string[];
  note?: string;
  status?: "planned" | "visited" | "cancelled";
  category?: string;
  cityId?: string;
  countryId?: string;
};

export type TripPlanningCityIntelligence = {
  city: {
    name: string;
    country: string;
    cityId: string;
    countryId: string;
  };
  visa?: {
    required: boolean | "unknown";
    type?: string | null;
    description?: string;
  };
  safeRate?: {
    score: number;
    outOf: number;
    summary: string;
  };
  bestTimeToVisit?: {
    summary: string;
    months?: string[];
  };
  usefulApps?: Array<{
    name: string;
    category: string;
    whyUseful: string;
  }>;
  climate?: string;
  transport?: string;
  tips?: string[];
};

export type PlanTripWeatherDay = {
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
};

export type PlanTripExistingDay = {
  day: number;
  /** YYYY-MM-DD */
  date: string;
  title?: string;
  /** Titles of places already on this day (day is skipped if non-empty). */
  placeTitles: string[];
};

/**
 * Full context assembled server-side and sent to the trip planner model.
 */
export type TripPlanningContext = {
  trip: {
    name?: string;
    from: RoutePoint;
    destinations: RoutePoint[];
    startDate: string;
    endDate: string;
    leisureType: LeisureType;
    /** Free-text focus when leisureType is "custom". */
    leisureCustom?: string;
    planMode: PlanTripMode;
    currency?: string;
    spendMoney?: "low" | "medium" | "high";
    createMode?: "ordinary" | "advanced";
  };
  /**
   * Complete journey (user routes + selected destinations + missing connections).
   * Construct itinerary ONLY after honoring this sequence.
   */
  journey: TripPlanningJourney;
  cityIntelligence: TripPlanningCityIntelligence[];
  /** Existing user-created routes — fixed; never replace/reorder/ignore. */
  routes: TripRouteContext[];
  /** Hotels/stays from trip preparation — for airport↔hotel transfers. */
  accommodations: TripPlanningAccommodation[];
  savedLocations: TripPlanningSavedLocation[];
  weather: PlanTripWeatherDay[];
  emptyDays: PlanTripExistingDay[];
  occupiedDays: PlanTripExistingDay[];
};

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

/**
 * Role of a route in the planTrip response.
 * - user: echo of an existing TripRoute (existingRouteId set) — do not recreate
 * - intercity: AI-generated missing connection between journey cities
 * - local_transfer: secondary logistics (airport↔hotel, etc.) — never overrides journey
 */
export type PlannedRouteRole = "user" | "intercity" | "local_transfer";

/**
 * Transport route in the planTrip response (existing TripRoute shape + plan metadata).
 * Includes preserved user routes AND AI-generated missing/local legs.
 * Persisted to users/{uid}/tripPlanner/{tripId}/routes/{routeId} (new legs only).
 */
export interface PlannedRouteSuggestion {
  /** Itinerary day this transfer belongs to (for chronological display). */
  day: number;
  /** YYYY-MM-DD */
  date: string;
  /**
   * Insert position among that day's places:
   * 0 = before first place, places.length = after last place.
   */
  insertAt: number;
  from: RoutePoint;
  to: RoutePoint;
  transport: TripRouteTransport;
  departure?: TripRouteInstant;
  arrival?: TripRouteInstant;
  durationMinutes?: number;
  durationApproximate?: boolean;
  note?: string;
  priceAmount?: number;
  priceCurrency?: string;
  priceLabel?: string;
  link?: string;
  /** How this leg relates to the journey. Defaults inferred when omitted. */
  role?: PlannedRouteRole;
  /** When role=user — existing TripRoute id; client must not create a duplicate. */
  existingRouteId?: string;
}

export interface PlanTripResult {
  success: true;
  leisureType: LeisureType;
  days: PlannedDaySuggestion[];
  /** Transport transfers — separate from places; shown chronologically in the itinerary. */
  routes: PlannedRouteSuggestion[];
  creditsCharged: number;
  remainingCredits: number;
  model: string;
}
