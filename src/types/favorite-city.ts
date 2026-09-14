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
