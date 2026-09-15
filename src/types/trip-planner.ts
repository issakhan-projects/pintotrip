import type { Timestamp } from "firebase/firestore";
import type { CityIntelligenceResult } from "./city-intelligence";
import type { LocationStatus } from "./location";

export type TripStatus =
  | "planning"
  | "upcoming"
  | "ongoing"
  | "completed"
  | "cancelled";

export type TripPlace = {
  countryId?: string;
  countryName: string;
  cityId?: string;
  cityName?: string;
  lat?: number;
  lon?: number;
};

export type TripDestination = {
  countryId?: string;
  countryName: string;
  cityId?: string;
  cityName: string;
  lat?: number;
  lon?: number;
  /** Google Place photo URIs (and/or saved place image URLs) for covers. */
  photos?: string[];
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
  /** Full callable result when available (practical for UI reuse). */
  result?: CityIntelligenceResult;
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
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  category: PreparationCategory;
  order: number;
};

/** Stay details for a trip — booking link and/or map pin. */
export type TripAccommodation = {
  /** Stable id when stored in `tripEssentials.accommodation`. */
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
};

/** Flight details stored under `tripEssentials.flights`. */
export type TripFlightEssential = {
  id: string;
  airline?: string;
  flightNumber?: string;
  departureAirport?: string;
  arrivalAirport?: string;
  /** ISO datetime string when known. */
  departureAt?: string;
  arrivalAt?: string;
  bookingLink?: string;
  notes?: string;
};

/** Document refs / notes stored under `tripEssentials.documents`. */
export type TripDocumentEssential = {
  id: string;
  label?: string;
  kind?: string;
  /** Local travel-document id (device-only) when linked. */
  linkedDocumentId?: string;
  notes?: string;
};

/**
 * Trip essentials on `users/{uid}/tripPlanner/{tripId}`.
 * Arrays so a trip can hold multiple stays, flights, and docs.
 */
export type TripEssentials = {
  flights?: TripFlightEssential[];
  accommodation?: TripAccommodation[];
  documents?: TripDocumentEssential[];
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
  accommodation?: TripAccommodation | null;
  documents?: TripDocumentDetails | null;
  visa?: TripVisaDetails | null;
};

export type TripItineraryStatus = "empty" | "generated" | "edited";

export type ItineraryPlaceStatus = LocationStatus;

export type ItineraryPlace = {
  locationId: string;
  order: number;
  status: ItineraryPlaceStatus;
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
  destination: TripDestination;

  startDate: Timestamp;
  endDate: Timestamp;
  status: TripStatus;
  currency: TripCurrency;

  cityIntelligence: TripCityIntelligence;

  preparation: TripPreparation;

  /** Flights, stays, and trip docs (coords preferred when known). */
  tripEssentials?: TripEssentials;

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
  | "tripEssentials"
  | "itinerary"
  | "savedPlaceIds"
  | "status"
> & {
  status?: TripStatus;
  cityIntelligence?: TripCityIntelligence;
  preparation?: TripPreparation;
  tripEssentials?: TripEssentials;
  savedPlaceIds?: string[];
  itinerary?: TripItinerary;
};

export type TripPlannerUpdateInput = Partial<
  Omit<TripPlanner, "userId" | "createdAt">
>;

export type TripPlannerStep = "details" | "preparation" | "places";
