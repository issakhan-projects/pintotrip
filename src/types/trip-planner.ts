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

export type TripItineraryStatus = "empty" | "generated" | "edited";

export type ItineraryPlaceStatus = LocationStatus;

export type ItineraryPlace = {
  locationId: string;
  order: number;
  status: ItineraryPlaceStatus;
};

export type ItineraryDay = {
  day: number;
  date: Timestamp;
  title: string;
  description?: string;
  places: ItineraryPlace[];
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

  preparation: {
    items: PreparationItem[];
  };

  /** References to users/{uid}/locations/{id} — no duplicated place docs. */
  savedPlaceIds: string[];

  itinerary: TripItinerary;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type TripPlannerDoc = TripPlanner & { id: string };

export type TripPlannerCreateInput = Omit<
  TripPlanner,
  "createdAt" | "updatedAt" | "cityIntelligence" | "preparation" | "itinerary" | "savedPlaceIds" | "status"
> & {
  status?: TripStatus;
  cityIntelligence?: TripCityIntelligence;
  preparation?: { items: PreparationItem[] };
  savedPlaceIds?: string[];
  itinerary?: TripItinerary;
};

export type TripPlannerUpdateInput = Partial<
  Omit<TripPlanner, "userId" | "createdAt">
>;

export type TripPlannerStep = "details" | "preparation" | "places";
