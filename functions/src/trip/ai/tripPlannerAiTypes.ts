/**
 * Trip Planner AI request/response types for Cloud Functions.
 * Mirrors src/types/trip-planner-ai-request.ts (client).
 */

import type { CityIntelligenceResult } from "../../city/types";
import type {
  LeisureType,
  PlaceCategory,
  RoutePoint,
  TripRouteContext,
  TripRouteTransport,
} from "../types";

export type TemperatureType = "celsius" | "fahrenheit";

export type TripPlannerAiStopType = "home" | "transit" | "destination";

export type SpendMoneyLevel = "low" | "medium" | "high";
export type TripCreateMode = "ordinary" | "advanced";

export type TripPlannerAiSavedPlace = {
  id: string;
  title: string;
  description: string;
  note?: string;
  lat: number;
  lon: number;
  category?: PlaceCategory;
};

export type TripPlannerAiTransportLocation = {
  placeId: string;
  name: string;
  type: "airport" | "train_station";
  /** Official IATA code when type is "airport"; null when unknown. */
  iataCode?: string | null;
  location: { lat: number; lon: number };
  address?: string;
};

export type TripPlannerAiDestinationTransport = {
  airports: TripPlannerAiTransportLocation[];
  trainStations?: TripPlannerAiTransportLocation[];
  lastCheckedAt: string;
};

export type TripPlannerAiRequestTrip = {
  tripId: string;
  name?: string;
  startDate: string;
  endDate: string;
  from?: string;
  currency?: string;
  leisureType?: LeisureType;
  /** Free-text focus when leisureType is "custom". */
  leisureCustom?: string;
  spendMoney?: SpendMoneyLevel;
  createMode?: TripCreateMode;
};

export type TripPlannerAiCityInfo = {
  lat?: number;
  lon?: number;
  timezone?: string;
  transport?: TripPlannerAiDestinationTransport;
  startDate?: string;
  endDate?: string;
};

export type TripPlannerAiAccommodation = {
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

export type TripPlannerAiRequestDestination = {
  cityId: string;
  cityName: string;
  countryId: string;
  countryName: string;
  leisureType?: LeisureType;
  stopType: TripPlannerAiStopType;
  cityInfo?: TripPlannerAiCityInfo;
  cityIntelligence?: CityIntelligenceResult;
  savedPlaces?: TripPlannerAiSavedPlace[];
  accommodation?: TripPlannerAiAccommodation | TripPlannerAiAccommodation[];
};

/** Full route entity as stored on the trip — same fields as TripRouteContext + tripId. */
export type TripPlannerAiRoute = TripRouteContext & { tripId?: string };

export type TripPlannerAiItineraryRoute = {
  locationId: string;
  order: number;
  status: "planned";
  type: "route";
  routeId: string;
  title?: string;
  route: TripPlannerAiRoute;
  source: "user";
  routeStarted?: boolean;
  routeEnded?: boolean;
};

export type TripPlannerAiRequestDayWeather = {
  available: boolean;
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
  units: "metric" | "imperial";
};

export type TripPlannerAiRequestItineraryDay = {
  day: number;
  date: string;
  title: string;
  description?: string;
  routes: TripPlannerAiItineraryRoute[];
  weather?: TripPlannerAiRequestDayWeather;
};

export type TripPlannerAiRequest = {
  trip: TripPlannerAiRequestTrip;
  destinations: Record<string, TripPlannerAiRequestDestination>;
  itinerary: TripPlannerAiRequestItineraryDay[];
};

export type TripPlannerAiResponseRouteSource = "existing" | "generated";

export type TripPlannerAiResponseRoute = {
  from: RoutePoint;
  to: RoutePoint;
  transport: TripRouteTransport;
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
  priceAmount?: number;
  priceCurrency?: string;
  priceLabel?: string;
  link?: string;
  source: TripPlannerAiResponseRouteSource;
};

export type TripPlannerAiResponseFreeTime = {
  start?: string;
  end?: string;
  durationMinutes?: number;
};

export type TripPlannerAiResponseSavedPlaceRef = {
  locationId: string;
};

export type TripPlannerAiResponseLocationPlace = {
  id: string;
  title: string;
  description: string;
  note?: string;
  cityId: string;
  status: "planned" | "visited" | "cancelled";
  category?: PlaceCategory;
  location: { lat: number; lon: number };
  city: { id: string; name: string };
  country: { id: string; name: string };
  images: Array<{ url: string; storagePath?: string; kind?: string }>;
  price?: { amount?: number; currency?: string; label?: string };
  links?: Array<{ url: string; label?: string }>;
  confidence?: number;
  source?: { type: string };
  ai?: { why: string; model: string };
};

export type TripPlannerAiResponseNestedPlace =
  | TripPlannerAiResponseSavedPlaceRef
  | TripPlannerAiResponseLocationPlace;

export type TripPlannerAiResponsePlace = {
  cityId: string;
  freeTime: TripPlannerAiResponseFreeTime;
  leisureType?: LeisureType;
  places: TripPlannerAiResponseNestedPlace[];
};

export type TripPlannerAiResponseDay = {
  day: number;
  date: string;
  places: TripPlannerAiResponsePlace[];
  routes: TripPlannerAiResponseRoute[];
};

export type TripPlannerAiResponse = {
  itinerary: TripPlannerAiResponseDay[];
};

/** Callable request — client sends only these. */
export type PlanTripAiCallableRequest = {
  tripId: string;
  language?: string;
  temperatureType?: TemperatureType;
  mode?: "generate" | "regenerate";
};

/** Callable success payload returned to PlanTripSheet. */
export type PlanTripAiCallableResult = {
  success: true;
  itinerary: TripPlannerAiResponseDay[];
  model: string;
  creditsCharged: number;
  remainingCredits: number;
  stages: string[];
  warning?: string;
  /** Debug: aggregated request before AI fill. */
  request?: TripPlannerAiRequest;
};
