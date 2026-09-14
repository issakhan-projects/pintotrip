import type { Timestamp } from "firebase/firestore";

export const TRAVEL_EXPERIENCES = [
  "first_time",
  "some_experience",
  "frequent_traveler",
] as const;

export type TravelExperience = (typeof TRAVEL_EXPERIENCES)[number];

export const PREFERRED_TRAVEL_TYPES = [
  "beach",
  "city",
  "nature",
  "adventure",
  "culture",
  "history",
  "food",
  "shopping",
  "luxury",
  "relaxation",
  "business",
] as const;

export type PreferredTravelType = (typeof PREFERRED_TRAVEL_TYPES)[number];

export const PREFERRED_TRIP_STYLES = [
  "budget",
  "mid_range",
  "luxury",
] as const;

export type PreferredTripStyle = (typeof PREFERRED_TRIP_STYLES)[number];

export const ACCOMMODATION_PREFERENCES = [
  "hotel",
  "resort",
  "apartment",
  "hostel",
  "villa",
] as const;

export type AccommodationPreference =
  (typeof ACCOMMODATION_PREFERENCES)[number];

export const TRANSPORTATION_PREFERENCES = [
  "flight",
  "train",
  "car",
  "bus",
  "walking",
] as const;

export type TransportationPreference =
  (typeof TRANSPORTATION_PREFERENCES)[number];

export const TRAVEL_COMPANIONS = [
  "solo",
  "couple",
  "family",
  "friends",
  "business",
] as const;

export type TravelCompanions = (typeof TRAVEL_COMPANIONS)[number];

export const PLANNING_STYLES = [
  "spontaneous",
  "balanced",
  "detailed",
] as const;

export type PlanningStyle = (typeof PLANNING_STYLES)[number];

export interface PreferredTripDuration {
  minDays?: number;
  maxDays?: number;
}

/**
 * Nested on users/{userId}.travelProfile.
 * Collected once after signup/onboarding; editable later from preferences.
 */
export interface TravelProfile {
  birthday?: Timestamp;
  /** Required when the user completes the sheet; may be omitted if skipped. */
  travelExperience?: TravelExperience;
  countriesVisited?: number;

  preferredTravelTypes?: PreferredTravelType[];
  preferredTripStyle?: PreferredTripStyle;
  preferredTripDuration?: PreferredTripDuration;

  accommodationPreference?: AccommodationPreference[];
  transportationPreference?: TransportationPreference[];

  travelCompanions?: TravelCompanions;
  planningStyle?: PlanningStyle;

  updatedAt: Timestamp;
}

/** Payload saved from the onboarding sheet (updatedAt set by the service). */
export type TravelProfileInput = Omit<TravelProfile, "updatedAt">;

export const TRAVEL_EXPERIENCE_OPTIONS: Array<{
  value: TravelExperience;
  label: string;
  description: string;
}> = [
  {
    value: "first_time",
    label: "First-time traveler",
    description: "Just getting started",
  },
  {
    value: "some_experience",
    label: "Some experience",
    description: "A few trips under my belt",
  },
  {
    value: "frequent_traveler",
    label: "Frequent traveler",
    description: "I travel often",
  },
];

export const PREFERRED_TRAVEL_TYPE_LABELS: Record<PreferredTravelType, string> =
  {
    beach: "Beach",
    city: "City",
    nature: "Nature",
    adventure: "Adventure",
    culture: "Culture",
    history: "History",
    food: "Food",
    shopping: "Shopping",
    luxury: "Luxury",
    relaxation: "Relaxation",
    business: "Business",
  };

export const PREFERRED_TRIP_STYLE_OPTIONS: Array<{
  value: PreferredTripStyle;
  label: string;
  description: string;
}> = [
  {
    value: "budget",
    label: "Budget",
    description: "Keep costs low",
  },
  {
    value: "mid_range",
    label: "Mid-range",
    description: "Balance comfort and cost",
  },
  {
    value: "luxury",
    label: "Luxury",
    description: "Premium experiences",
  },
];

export const ACCOMMODATION_PREFERENCE_LABELS: Record<
  AccommodationPreference,
  string
> = {
  hotel: "Hotel",
  resort: "Resort",
  apartment: "Apartment",
  hostel: "Hostel",
  villa: "Villa",
};

export const TRANSPORTATION_PREFERENCE_LABELS: Record<
  TransportationPreference,
  string
> = {
  flight: "Flight",
  train: "Train",
  car: "Car",
  bus: "Bus",
  walking: "Walking",
};

export const TRAVEL_COMPANION_OPTIONS: Array<{
  value: TravelCompanions;
  label: string;
}> = [
  { value: "solo", label: "Solo" },
  { value: "couple", label: "Couple" },
  { value: "family", label: "Family" },
  { value: "friends", label: "Friends" },
  { value: "business", label: "Business" },
];

export const PLANNING_STYLE_OPTIONS: Array<{
  value: PlanningStyle;
  label: string;
  description: string;
}> = [
  {
    value: "spontaneous",
    label: "Spontaneous",
    description: "Go with the flow",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Some structure, some freedom",
  },
  {
    value: "detailed",
    label: "Detailed",
    description: "Plan every day carefully",
  },
];
