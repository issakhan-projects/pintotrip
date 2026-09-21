import type { Timestamp } from "firebase/firestore";
import type { CityIntelligenceResult } from "./city-intelligence";
import type { LocationStatus } from "./location";
import type { LeisureType } from "./trip-plan";

export type TripStatus =
  | "planning"
  | "upcoming"
  | "ongoing"
  | "completed"
  | "cancelled";

/** Normalized transport pin from Google Places (train stations, etc.). */
export type TripTransportLocation = {
  placeId: string;
  name: string;
  type: "airport" | "train_station";
  location: {
    lat: number;
    lon: number;
  };
  address?: string;
  types?: string[];
  /** Google Maps place URL (from Places Text Search). */
  googleMapsUri?: string;
};

/** Airport pin with optional IATA enrichment (AI metadata only). */
export type TripAirport = {
  placeId: string;
  name: string;
  type: "airport";
  /** Official IATA code when resolved; null when unknown. */
  iataCode?: string | null;
  location: {
    lat: number;
    lon: number;
  };
  address?: string;
  types?: string[];
};

/**
 * Per-destination transport discovered async after trip create.
 * Single-city trips omit `trainStations`.
 */
export type TripDestinationTransport = {
  airports: TripAirport[];
  trainStations?: TripTransportLocation[];
  /** ISO timestamp when discovery last completed for this city. */
  lastCheckedAt: string;
};

export type TripPlace = {
  countryId?: string;
  countryName: string;
  cityId?: string;
  cityName?: string;
  lat?: number;
  lon?: number;
  /** IANA timezone id for the origin city (e.g. "Asia/Tashkent"). */
  timezone?: string;
  /**
   * Origin transport enrichment (airports only).
   * Filled by onTripPlannerCreated — same shape as destination.transport,
   * without trainStations.
   */
  transport?: TripDestinationTransport;
};

export type TripDestination = {
  countryId?: string;
  countryName: string;
  cityId?: string;
  cityName: string;
  lat?: number;
  lon?: number;
  /** IANA timezone id for the city (e.g. "Europe/Istanbul"). */
  timezone?: string;
  /** Cover image URLs (Pexels and/or saved place images). */
  photos?: string[];
  /** Nearby airports / stations — filled by onTripPlannerCreated. */
  transport?: TripDestinationTransport;

  /** Hotel / stay for this city (singular or list). */
  accommodation?: TripAccommodation | TripAccommodation[] | null;
};

/** How the trip was created in the Create Trip sheet. */
export type TripCreateMode = "ordinary" | "advanced";

export const SPEND_MONEY_LEVELS = ["low", "medium", "high"] as const;
export type SpendMoneyLevel = (typeof SPEND_MONEY_LEVELS)[number];

export const SPEND_MONEY_OPTIONS: Array<{
  id: SpendMoneyLevel;
  label: string;
}> = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

/**
 * One city on a multi-destination trip.
 * City dates are optional; trip-level startDate/endDate remain required.
 * Destination + transit stops share this cap (advanced create / edit).
 */
export const MAX_TRIP_DESTINATIONS = 5;

/** Inclusive max length of a trip (start → end). */
export const MAX_TRIP_DAYS = 14;

export const TRIP_STOP_TYPES = ["destination", "transit"] as const;
export type TripStopType = (typeof TRIP_STOP_TYPES)[number];

export const TRIP_STOP_TYPE_OPTIONS: Array<{
  id: TripStopType;
  label: string;
  description: string;
}> = [
  {
    id: "destination",
    label: "Destination",
    description: "A city you stay in and explore",
  },
  {
    id: "transit",
    label: "Transit",
    description: "Pass-through / layover city",
  },
];

export type TripDestinationStop = TripDestination & {
  startDate?: Timestamp;
  endDate?: Timestamp;
  /** Advanced multi-city: stay destination vs pass-through city. */
  stopType?: TripStopType;
};

export type TripCurrency = {
  code: string;
  name: string;
  symbol: string;
};

export type CityIntelligenceStatus =
  | "pending"
  | "loading"
  | "ready"
  | "error";

export type TripCityIntelligence = {
  status: CityIntelligenceStatus;
  /** One entry per trip destination city (length 1 for single-city trips). */
  results?: CityIntelligenceResult[];
  errorMessage?: string;
  lastUpdatedAt?: Timestamp;
};

export type PreparationCategory =
  | "documents"
  | "money"
  | "booking"
  | "health"
  | "transport"
  | "packing"
  | "other";

export type PreparationItem = {
  /** Stable system id (e.g. `visa:sa`) or `custom:{uuid}`. */
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  category: PreparationCategory;
  order: number;
  /** Official/user-saved http(s) URL only — never invent. */
  link?: string;
  /** Button label for `link` (e.g. "Visit Saudi visa", "Booking.com"). */
  linkLabel?: string;
};

/** Stay details for a trip — booking link and/or map pin. */
export type TripAccommodation = {
  id?: string;
  name?: string;
  /** Booking.com / Airbnb / hotel confirmation URL. */
  link?: string;
  address?: string;
  /** Google Place id when picked from search/map (ASCII). */
  placeId?: string;
  lat?: number;
  lon?: number;
  cityName?: string;
  countryName?: string;
  notes?: string;
  source?: "link" | "map" | "search";
  /** Optional stay window (ISO date `YYYY-MM-DD`). */
  startDate?: string;
  /** Optional stay window (ISO date `YYYY-MM-DD`). */
  endDate?: string;
};

/** Airport pin resolved for a trip city (IATA + coords when known). */
export type TripFlightAirport = {
  /** IATA code, uppercase ASCII (e.g. "DXB"). */
  code: string;
  name?: string;
  cityName?: string;
  countryName?: string;
  lat?: number;
  lon?: number;
};

/** One-way flight details (UI / sheet payload — not stored on the trip doc). */
export type TripFlightEssential = {
  id: string;
  airline?: string;
  flightNumber?: string;
  /** Display route, e.g. "Tashkent → Istanbul". */
  routeLabel?: string;
  fromCityName?: string;
  toCityName?: string;
  departure?: TripFlightAirport;
  arrival?: TripFlightAirport;
  routeAirports?: TripFlightAirport[];
  departureAirport?: string;
  arrivalAirport?: string;
  /** ISO datetime string when known. */
  departureAt?: string;
  arrivalAt?: string;
  bookingLink?: string;
  notes?: string;
};

export type TripVisaStatus =
  | "unknown"
  | "not_needed"
  | "not_started"
  | "applied"
  | "approved";

export type TripVisaDetails = {
  status: TripVisaStatus;
  type?: string;
  applicationLink?: string;
  notes?: string;
};

/**
 * Trip-level document prep notes.
 * Do not store passport/ID numbers here — those stay in on-device My Documents.
 */
export type TripDocumentDetails = {
  notes?: string;
  passportReady?: boolean;
  idReady?: boolean;
  insuranceReady?: boolean;
  /** Local travel-document ids linked for this trip (device-only). */
  linkedDocumentIds?: string[];
};

export type TripPreparation = {
  items: PreparationItem[];
  documents?: TripDocumentDetails | null;
  visa?: TripVisaDetails | null;
};

export type TripItineraryStatus = "empty" | "generated" | "edited";

export type ItineraryPlaceStatus = LocationStatus;

/**
 * Place slot on an itinerary day.
 * Trip Planner may also write `type: "gap"` layover blocks (no separate gaps collection)
 * and `type: "route"` pointers to users/.../routes/{routeId} (no separate AI-routes model).
 */
export type ItineraryPlace = {
  /** Saved location id — may be a synthetic id for `type: "gap"` / `"route"` entries. */
  locationId: string;
  order: number;
  status: ItineraryPlaceStatus;
  /** `"gap"` = layover block; `"route"` = transport transfer shown in the day timeline. */
  type?: "place" | "gap" | "route";
  /**
   * Display title — for gap/route entries, and for place slots the AI plan title
   * (kept so the itinerary matches the plan preview even if the location doc differs).
   */
  title?: string;
  /** AI / plan description for place slots (mirrors plan preview). */
  description?: string;
  /** Plan preview image URL for place slots (kept in sync with AI thumb). */
  imageUrl?: string;
  /** Gap length when type is `"gap"`. */
  durationMinutes?: number;
  /** City the gap is spent in (when known). */
  cityName?: string;
  /** Existing TripRoute id when type is `"route"`. */
  routeId?: string;
};

/** Cached daily forecast on an itinerary day (from getTripWeather). */
export type ItineraryDayWeather = {
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
  /** ISO timestamp when this forecast was fetched. */
  fetchedAt: string;
};

export type ItineraryDay = {
  day: number;
  date: Timestamp;
  title: string;
  description?: string;
  places: ItineraryPlace[];
  /** Cached destination forecast for this day — avoids re-calling OpenWeather. */
  weather?: ItineraryDayWeather;
};

export type TripItinerary = {
  status: TripItineraryStatus;
  days: ItineraryDay[];
};

/**
 * Firestore document: users/{userId}/tripPlanner/{tripId}
 */
export interface TripPlanner {
  /** Owner uid — mirrors the path segment for convenience. */
  userId: string;
  name: string;

  from: TripPlace;
  /** All trip cities (always set — even for a single-city trip). */
  destinations: TripDestinationStop[];

  /**
   * User-uploaded trip cover (Firebase Storage download URL).
   * Prefer over destination place photos when present.
   */
  photoUrl?: string;

  startDate: Timestamp;
  endDate: Timestamp;
  status: TripStatus;
  currency: TripCurrency;

  /** Stable leisure id from LEISURE_TYPES (not a display label). */
  leisureType?: LeisureType;
  /**
   * Free-text focus when leisureType is "custom"
   * (e.g. "surfing, diving, parachute jump").
   */
  leisureCustom?: string;
  /** Spend level id: low | medium | high. */
  spendMoney?: SpendMoneyLevel;
  createMode?: TripCreateMode;
  /** Legacy: previously set when create-trip credits were charged (now unused). */
  createCreditsCharged?: boolean;

  cityIntelligence: TripCityIntelligence;

  preparation: TripPreparation;

  /** References to users/{uid}/locations/{id} — no duplicated place docs. */
  savedPlaceIds: string[];

  itinerary: TripItinerary;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type TripPlannerDoc = TripPlanner & { id: string };

export type TripPlannerCreateInput = Omit<
  TripPlanner,
  | "createdAt"
  | "updatedAt"
  | "cityIntelligence"
  | "preparation"
  | "itinerary"
  | "savedPlaceIds"
  | "status"
> & {
  status?: TripStatus;
  cityIntelligence?: TripCityIntelligence;
  preparation?: TripPreparation;
  savedPlaceIds?: string[];
  itinerary?: TripItinerary;
};

export type TripPlannerUpdateInput = Partial<
  Omit<TripPlanner, "userId" | "createdAt">
>;


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
  /** ISO-8601 datetime with offset, e.g. 2026-10-10T10:00:00+05:00 */
  datetime: string;
  /** IANA timezone when known (e.g. "Asia/Almaty"). */
  timezone: string;
  /**
   * true = clock time in datetime is exact.
   * false = only the calendar date is known (time is a placeholder, usually 00:00).
   * Never invent an exact time when only the date is known.
   */
  timeKnown?: boolean;
};

/** Ticket / boarding pass / receipt attached to a route. */
export type TripRouteAttachment = {
  id: string;
  name: string;
  contentType: string;
  url: string;
  storagePath: string;
  kind: "image" | "pdf";
};



/** Endpoint of a trip route (city, airport, or station). */
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
};

/**
 * A single leg between trip cities.
 * Stored at users/{uid}/tripPlanner/{tripId}/routes/{routeId}.
 */
export type TripRoute = {
  id: string;
  tripId: string;
  order: number;
  from: RoutePoint;
  to: RoutePoint;
  transport: TripRouteTransport;
  departure?: TripRouteInstant;
  arrival?: TripRouteInstant;
  durationMinutes?: number;
  /** True when duration is user-estimated (bus/metro/taxi/car/ferry/other). */
  durationApproximate?: boolean;
  status: TripRouteStatus;
  note?: string;
  /** Airline name when transport is flight (optional). */
  airline?: string;
  /** Flight number when transport is flight, e.g. "TK 123" (optional). */
  flightNumber?: string;
  /** Approximate one-way adult fare for this transfer (not a whole-trip total). */
  priceAmount?: number;
  /** ISO 4217 currency for priceAmount. */
  priceCurrency?: string;
  /** Human label e.g. "≈ 25 USD", "Free", "from 12 EUR". */
  priceLabel?: string;
  /** Booking / official operator / timetable URL when available. */
  link?: string;
  /** Ticket PDFs / photos for this leg. */
  attachments?: TripRouteAttachment[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type TripRouteCreateInput = Omit<
  TripRoute,
  "id" | "createdAt" | "updatedAt"
>;

export type TripRouteUpdateInput = Partial<
  Omit<TripRoute, "id" | "tripId" | "createdAt">
>;

export type TripPlannerStep =
  | "details"
  | "preparation"
  | "routes"
  | "places";
