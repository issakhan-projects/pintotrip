/**
 * Structured Trip Planner AI request — input to a future itinerary planner.
 *
 * Shape: { trip, destinations, itinerary }
 * Core fields aggregate existing Firestore / app data. Per-day `weather` is
 * attached from OpenWeather (getTripWeather) using the user's temperature unit.
 */

import type { CityIntelligenceResult } from "./city-intelligence";
import type {
  LocationImage,
  LocationLink,
  LocationPrice,
  LocationSource,
  LocationStatus,
  UserLocation,
} from "./location";
import type { LeisureType, PlaceCategory } from "./trip-plan";
import type {
  RoutePoint,
  SpendMoneyLevel,
  TripAccommodation,
  TripAirport,
  TripCreateMode,
  TripPlannerDoc,
  TripRoute,
  TripTransportLocation,
} from "./trip-planner";
import type { TemperatureUnit } from "./user";

/** Role of a city in the AI request destinations map. */
export type TripPlannerAiStopType = "home" | "transit" | "destination";

/**
 * Slim saved place for the AI request.
 * Omits city, status, source, images, price, links, country, ai, timestamps.
 */
export type TripPlannerAiSavedPlace = {
  id: string;
  title: string;
  description: string;
  note?: string;
  lat: number;
  lon: number;
  category?: PlaceCategory;
};

/** Full location docs used as builder input (before slim mapping). */
export type TripPlannerAiSavedPlaceSource = UserLocation & { id: string };

/** Transport pin without googleMapsUri / types (not sent to the model). */
export type TripPlannerAiTransportLocation = Omit<
  TripTransportLocation,
  "googleMapsUri" | "types"
>;

/** Airport pin without types[] (not sent to the model). */
export type TripPlannerAiAirport = Omit<TripAirport, "types">;

export type TripPlannerAiDestinationTransport = {
  airports: TripPlannerAiAirport[];
  trainStations?: TripPlannerAiTransportLocation[];
  lastCheckedAt: string;
};

/**
 * Basic trip header for the AI request.
 * Dates are ISO calendar days (`YYYY-MM-DD`).
 */
export type TripPlannerAiRequestTrip = {
  tripId: string;
  name?: string;
  startDate: string;
  endDate: string;
  /** Origin city id (preferred) or display name. */
  from?: string;
  /** ISO 4217 currency code. */
  currency?: string;
  /** Trip leisure preference — copied onto destinations that explore places. */
  leisureType?: LeisureType;
  /** Free-text focus when leisureType is "custom". */
  leisureCustom?: string;
  /** Budget preference from trip create (low | medium | high). */
  spendMoney?: SpendMoneyLevel;
  /** How the trip was created (ordinary | advanced). */
  createMode?: TripCreateMode;
};

/**
 * Extra city facts for transit/destination stops.
 * Identity (cityId/name, countryId/name) lives on the parent destination entry.
 */
export type TripPlannerAiCityInfo = {
  lat?: number;
  lon?: number;
  timezone?: string;
  transport?: TripPlannerAiDestinationTransport;
  /** ISO calendar day when the stop has a date window. */
  startDate?: string;
  endDate?: string;
};

/**
 * One city in `destinations` keyed by `cityId`.
 *
 * - `home`: minimal — origin/return pin only (no cityInfo / intelligence / places / stay).
 * - `transit` | `destination`: full city context when available.
 */
export type TripPlannerAiRequestDestination = {
  cityId: string;
  cityName: string;
  countryId: string;
  countryName: string;
  /** From trip.leisureType when this stop explores places. */
  leisureType?: LeisureType;
  stopType: TripPlannerAiStopType;

  /** From trip destinations[] for this cityId — omitted for `home`. */
  cityInfo?: TripPlannerAiCityInfo;
  /**
   * Matching entry from trip.cityIntelligence.results by cityId.
   * Omitted when no match (do not invent / fetch).
   */
  cityIntelligence?: CityIntelligenceResult;
  /**
   * Trip saved places for this city with status === "planned" only.
   * Always `[]` for transit/destination cities (even when empty).
   */
  savedPlaces?: TripPlannerAiSavedPlace[];
  /** Stay for this city — omit when none. */
  accommodation?: TripAccommodation | TripAccommodation[];
};

/**
 * Route slot on the AI *request* itinerary (pre-generation).
 * Built from the routes subcollection only.
 */
export type TripPlannerAiItineraryRoute = {
  locationId: string;
  order: number;
  status: "planned";
  type: "route";
  routeId: string;
  title?: string;
  route: TripRoute;
  source: "user";
  routeStarted?: boolean;
  routeEnded?: boolean;
};

/**
 * One calendar day in the AI *request* itinerary.
 */
export type TripPlannerAiRequestItineraryDay = {
  day: number;
  /** ISO calendar day (`YYYY-MM-DD`). */
  date: string;
  title: string;
  description?: string;
  routes: TripPlannerAiItineraryRoute[];
  /**
   * OpenWeather forecast for this calendar day at the owning destination.
   * Temps use the user's temperature preference (metric °C / imperial °F).
   * Omitted when forecast unavailable or not yet attached.
   */
  weather?: TripPlannerAiRequestDayWeather;
};

/**
 * Slim daily forecast on a request itinerary day (from getTripWeather / OpenWeather).
 * Never invent — only attach real forecast rows.
 */
export type TripPlannerAiRequestDayWeather = {
  available: boolean;
  /** Owning destination city id when known (ASCII slug). */
  cityId?: string;
  cityName?: string;
  tempMin?: number;
  tempMax?: number;
  temp?: number;
  description?: string;
  icon?: string;
  humidity?: number;
  windSpeed?: number;
  precipitationChance?: number;
  /**
   * OpenWeather units: metric (°C, m/s) or imperial (°F, mph).
   * Matches user preferences.temperatureUnit (celsius→metric, fahrenheit→imperial).
   */
  units: "metric" | "imperial";
};

export type TripPlannerAiRequest = {
  trip: TripPlannerAiRequestTrip;
  destinations: Record<string, TripPlannerAiRequestDestination>;
  itinerary: TripPlannerAiRequestItineraryDay[];
};

/** Route entry in the AI *response* day itinerary. */
export type TripPlannerAiResponseRouteSource = "existing" | "generated";

export type TripPlannerAiResponseRoute = {
  from: RoutePoint;
  to: RoutePoint;
  transport: TripRoute["transport"];
  departure?: {
    datetime: string;
    timezone: string;
    timeKnown?: boolean;
  };
  arrival?: {
    datetime: string;
    timezone: string;
    timeKnown?: boolean;
  };
  /**
   * Approximate one-way adult fare — non-flight only when provided by AI
   * (or already stored on an existing TripRoute). Never invented client-side.
   */
  priceAmount?: number;
  priceCurrency?: string;
  priceLabel?: string;
  /** Official booking / timetable URL — non-flight only when provided by AI. */
  link?: string;
  source: TripPlannerAiResponseRouteSource;
};

/**
 * Approximate free window in a city on a calendar day, derived from routes.
 * `start` / `end` may be omitted when times cannot be calculated.
 */
export type TripPlannerAiResponseFreeTime = {
  /** ISO datetime with offset when known (e.g. after arrival). */
  start?: string;
  /** ISO datetime with offset when known (e.g. before departure). */
  end?: string;
  /** Minutes between start and end when both known; else soft full-day approx. */
  durationMinutes?: number;
};

/** Existing saved place — reference only (do not expand the location doc). */
export type TripPlannerAiResponseSavedPlaceRef = {
  locationId: string;
};

/**
 * New / suggested place — locations subcollection shape (+ id), JSON-safe.
 * No `googlePhotoUrl`. No Firestore Timestamps / aggregation fields.
 */
export type TripPlannerAiResponseLocationPlace = {
  id: string;
  title: string;
  description: string;
  note?: string;
  cityId: string;
  status: LocationStatus;
  category?: PlaceCategory;
  /** Coordinates (locations docs use top-level lat/lon; nested here for the AI response). */
  location: { lat: number; lon: number };
  city: { id: string; name: string };
  country: { id: string; name: string };
  images: LocationImage[];
  price?: LocationPrice;
  links?: LocationLink[];
  confidence?: number;
  source?: LocationSource;
  ai?: { why: string; model: string };
};

export type TripPlannerAiResponseNestedPlace =
  | TripPlannerAiResponseSavedPlaceRef
  | TripPlannerAiResponseLocationPlace;

/**
 * City free-time slot on a response day.
 * A day may list multiple cities when travel crosses cities that day.
 */
export type TripPlannerAiResponsePlace = {
  cityId: string;
  freeTime: TripPlannerAiResponseFreeTime;
  /** From destinations[cityId].leisureType when set. */
  leisureType?: LeisureType;
  /**
   * Places for this free-time window.
   * - From savedPlaces → `{ locationId }` only
   * - Otherwise → full location place payload (no googlePhotoUrl)
   */
  places: TripPlannerAiResponseNestedPlace[];
};

export type TripPlannerAiResponseDay = {
  day: number;
  /** ISO calendar day (`YYYY-MM-DD`). */
  date: string;
  /** Free-time windows per city, derived from that day's routes (+ overnight stay). */
  places: TripPlannerAiResponsePlace[];
  routes: TripPlannerAiResponseRoute[];
};

/**
 * Route-generation step output.
 * Day-by-day itinerary only — no citySequence / generatedRoutes / places.
 */
export type TripPlannerAiResponse = {
  itinerary: TripPlannerAiResponseDay[];
};

/** Client → fillTripPlannerAiPlaces callable. */
export type FillTripPlannerAiPlacesRequest = {
  /** Aggregated trip request (destinations + leisure context). */
  request: TripPlannerAiRequest;
  /**
   * Route-generated itinerary (freeTime + saved `{ locationId }` refs already set).
   * AI appends new location places after saved refs.
   */
  itinerary: TripPlannerAiResponseDay[];
  language?: string;
};

export type FillTripPlannerAiPlacesResult = {
  success: true;
  itinerary: TripPlannerAiResponseDay[];
  model: string;
  creditsCharged: number;
  remainingCredits: number;
};

/**
 * planTrip callable success — full AI itinerary built server-side.
 * Client sends only tripId + language + temperatureType.
 */
export type PlanTripAiResult = {
  success: true;
  itinerary: TripPlannerAiResponseDay[];
  model: string;
  creditsCharged: number;
  remainingCredits: number;
  stages: string[];
  warning?: string;
  /** Aggregated request (debug). */
  request?: TripPlannerAiRequest;
};

/** Inputs already loaded from the app / Firestore — builder does not fetch. */
export type BuildTripPlannerAiRequestInput = {
  trip: TripPlannerDoc;
  /** User locations (with id) — filtered by savedPlaceIds + cityId + planned. */
  locations: TripPlannerAiSavedPlaceSource[];
  /**
   * Existing trip routes. Overnight legs stay one TripRoute; itinerary days
   * may reference the same routeId on multiple days without duplicating the entity.
   */
  routes?: TripRoute[];
  /**
   * Optional pre-fetched OpenWeather days keyed by ISO date (`YYYY-MM-DD`).
   * Prefer {@link applyWeatherToTripPlannerAiRequest} / weatherForTrip.
   */
  weatherByIsoDate?: Map<string, TripPlannerAiRequestDayWeather>;
  /** User temperature preference — only used when fetching weather externally. */
  temperatureUnit?: TemperatureUnit;
};
