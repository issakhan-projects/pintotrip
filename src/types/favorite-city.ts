import type { Timestamp } from "firebase/firestore";
import type { LocationStatus } from "./location";

/**
 * Snapshot of the last favorite-city contribution to Travel Intelligence.
 * Written only by Cloud Functions (Admin SDK).
 */
export interface FavoriteCityIntelligenceContribution {
  cityId: string;
  countryId: string;
  cityName: string;
  countryName: string;
  /** Whether this favorite incremented city.favoriteCount for the user. */
  countedAsUniqueFavorite: boolean;
}

/** Optional City Intelligence snapshot stored on a favorite. */
export interface FavoriteCitySafeRate {
  score: number;
  outOf: number;
  summary: string;
  source?: string;
}

export interface FavoriteCityVisa {
  required: boolean | "unknown";
  type?: string | null;
  cost?: {
    amount?: number | null;
    currency?: string | null;
  } | null;
  description?: string;
  verificationRequired?: boolean;
}

export interface FavoriteCityApproximateDailyBudget {
  amount?: number;
  currency?: string;
  summary?: string;
}

export interface FavoriteCityBestTimeToVisit {
  summary: string;
  months?: string[];
  source?: string;
}

/** Travel-info fields copied from City Intelligence onto a favorite. */
export type FavoriteCityTravelInfo = {
  safeRate?: FavoriteCitySafeRate;
  /** Destination currency ISO code (e.g. "TRY"). */
  currency?: string;
  /** Language the intelligence text was generated in (e.g. "en"). */
  language?: string;
  approximateDailyBudget?: FavoriteCityApproximateDailyBudget;
  bestTimeToVisit?: FavoriteCityBestTimeToVisit;
  visa?: FavoriteCityVisa;
};

/**
 * Firestore document: users/{userId}/favoriteCities/{cityId}
 */
export interface FavoriteCity {
  cityId: string;
  cityName: string;
  country: string;

  lat: number;
  lon: number;

  status: LocationStatus;

  safeRate?: FavoriteCitySafeRate;
  currency?: string;
  language?: string;
  approximateDailyBudget?: FavoriteCityApproximateDailyBudget;
  bestTimeToVisit?: FavoriteCityBestTimeToVisit;
  visa?: FavoriteCityVisa;

  /**
   * Travel Intelligence incremental flag.
   * false / missing → pending aggregation; true → already applied.
   */
  aggregated?: boolean;
  aggregatedAt?: Timestamp;

  /** Soft-delete for aggregate reversal before hard removal. */
  deleted?: boolean;

  /** Server-only contribution snapshot (Admin SDK). */
  intelligenceContribution?: FavoriteCityIntelligenceContribution;

  createdAt: Timestamp;
}

export type FavoriteCityCreateInput = Omit<
  FavoriteCity,
  | "createdAt"
  | "aggregated"
  | "aggregatedAt"
  | "deleted"
  | "intelligenceContribution"
>;
