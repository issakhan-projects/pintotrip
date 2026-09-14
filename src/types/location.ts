import type { Timestamp } from "firebase/firestore";
import type { PlaceCategory } from "./trip-plan";

export type LocationStatus = "planned" | "visited" | "cancelled";

export type LocationImageSource = "user" | "external";

export interface LocationImage {
  url: string;
  source: LocationImageSource;
}

export interface LocationCountry {
  id: string;
  name: string;
}

export interface LocationCity {
  id: string;
  name: string;
  /**
   * Google Places Place ID for this locality (e.g. `ChIJ…`).
   * Used for Maps Data-Driven Styling city boundaries.
   * Not the same as `id`, which is an internal slug.
   */
  googlePlaceId?: string;
}

export interface LocationAiMetadata {
  why: string;
  model: string;
  processedAt: Timestamp;
}

export type LocationSourceType = "image" | "link" | "manual" | "city";

export interface LocationSource {
  type: LocationSourceType;
  url?: string;
}

/** Estimated unit price (ticket, fare, entry) — not a trip total. */
export interface LocationPrice {
  amount?: number;
  /** ISO 4217 */
  currency?: string;
  /** Human label e.g. "≈ 45 USD", "Free". */
  label?: string;
}

export interface LocationLink {
  url: string;
  /** Optional short label e.g. "Tickets", "Timetable". */
  label?: string;
}

/**
 * Optional future confidence dimensions.
 * `confidence` remains the primary overall score (0–1).
 */
export interface LocationConfidenceBreakdown {
  /** Overall place identification confidence (0–1). */
  confidence: number;
  /** Confidence that the landmark/place is correct. */
  locationConfidence?: number;
  /** Confidence that the exact viewpoint/coordinates are correct. */
  exactCoordinatesConfidence?: number;
}

/**
 * Snapshot of the last contribution applied to Travel Intelligence.
 * Written only by Cloud Functions (Admin SDK). Used to reverse
 * prior aggregate state when a location changes or is removed.
 */
export interface LocationIntelligenceContribution {
  placeId: string;
  cityId: string;
  countryId: string;
  status: LocationStatus;
  title: string;
  lat: number;
  lon: number;
  cityName: string;
  countryName: string;
  /** Whether this location incremented place.savedCount for the user. */
  countedAsUniqueSaver: boolean;
}

/**
 * Firestore document: users/{userId}/locations/{locationId}
 */
export interface UserLocation extends LocationConfidenceBreakdown {
  title: string;
  description: string;
  note?: string;

  lat: number;
  lon: number;

  country: LocationCountry;
  city: LocationCity;

  status: LocationStatus;

  /** Place type from AI plan / classification (beach, attraction, …). */
  category?: PlaceCategory;

  /** Unit price estimate from AI plan / enrichment. */
  price?: LocationPrice;

  /** Booking / tickets / info URLs. */
  links?: LocationLink[];

  images: LocationImage[];

  ai: LocationAiMetadata;

  source: LocationSource;

  /**
   * Travel Intelligence incremental flag.
   * false / missing → pending aggregation; true → already applied.
   */
  aggregated?: boolean;
  aggregatedAt?: Timestamp;

  /** Soft-delete for aggregate reversal before hard removal. */
  deleted?: boolean;

  /** Server-only contribution snapshot (Admin SDK). */
  intelligenceContribution?: LocationIntelligenceContribution;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type UserLocationCreateInput = Omit<
  UserLocation,
  | "createdAt"
  | "updatedAt"
  | "aggregated"
  | "aggregatedAt"
  | "deleted"
  | "intelligenceContribution"
>;

export type UserLocationUpdateInput = Partial<
  Omit<
    UserLocation,
    | "createdAt"
    | "source"
    | "aggregatedAt"
    | "intelligenceContribution"
  >
>;

/** Fields that affect Travel Intelligence aggregates when changed. */
export const LOCATION_AGGREGATION_FIELDS = [
  "title",
  "lat",
  "lon",
  "city",
  "country",
  "status",
] as const;
