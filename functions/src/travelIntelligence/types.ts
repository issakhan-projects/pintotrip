/**
 * Travel Intelligence — shared types for Cloud Functions aggregation.
 * Mirrors src/types/travel-intelligence.ts and location contribution shapes.
 */

import type { Timestamp } from "firebase-admin/firestore";

export type LocationStatus = "planned" | "visited" | "cancelled";

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
  countedAsUniqueSaver: boolean;
}

export interface FavoriteCityIntelligenceContribution {
  cityId: string;
  countryId: string;
  cityName: string;
  countryName: string;
  countedAsUniqueFavorite: boolean;
}

/** Source location shape used during aggregation (subset of UserLocation). */
export interface SourceLocation {
  title: string;
  lat: number;
  lon: number;
  country: { id?: string; name: string };
  city: { id?: string; name: string };
  status: LocationStatus;
  aggregated?: boolean;
  aggregatedAt?: Timestamp;
  deleted?: boolean;
  intelligenceContribution?: LocationIntelligenceContribution;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface SourceFavoriteCity {
  cityId: string;
  cityName: string;
  country: string;
  lat: number;
  lon: number;
  status?: LocationStatus;
  aggregated?: boolean;
  aggregatedAt?: Timestamp;
  deleted?: boolean;
  intelligenceContribution?: FavoriteCityIntelligenceContribution;
  createdAt?: Timestamp;
}

export interface TravelIntelligencePlace {
  placeId: string;
  title: string;
  city: { id?: string; name: string };
  country: { id?: string; name: string };
  lat: number;
  lon: number;
  savedCount: number;
  visitedCount: number;
  plannedCount: number;
  cancelledCount: number;
  firstSavedAt: Timestamp;
  lastSavedAt: Timestamp;
  popularityScore: number;
  trendingScore: number;
  updatedAt: Timestamp;
}

export interface TravelIntelligenceCity {
  cityId: string;
  name: string;
  countryId?: string;
  countryName: string;
  savedPlacesCount: number;
  favoriteCount: number;
  visitedCount: number;
  plannedCount: number;
  firstActivityAt: Timestamp;
  lastActivityAt: Timestamp;
  popularityScore: number;
  trendingScore: number;
  updatedAt: Timestamp;
}

export interface TravelIntelligenceCountry {
  countryId: string;
  name: string;
  savedPlacesCount: number;
  favoriteCitiesCount: number;
  visitedCount: number;
  plannedCount: number;
  firstActivityAt: Timestamp;
  lastActivityAt: Timestamp;
  popularityScore: number;
  trendingScore: number;
  updatedAt: Timestamp;
}

export interface DailyTopPlace {
  placeId: string;
  title: string;
  cityName: string;
  countryName: string;
  saves: number;
  score: number;
}

export interface DailyTopCity {
  cityId: string;
  name: string;
  countryName: string;
  score: number;
}

export interface DailyTopCountry {
  countryId: string;
  name: string;
  score: number;
}

export interface TravelIntelligenceDaily {
  date: string;
  newPlaces: number;
  newSavedLocations: number;
  newFavoriteCities: number;
  topPlaces: DailyTopPlace[];
  topCities: DailyTopCity[];
  topCountries: DailyTopCountry[];
  generatedAt: Timestamp;
}

/** In-memory counters for today's snapshot. */
export interface DailyRunStats {
  newPlaces: number;
  newSavedLocations: number;
  newFavoriteCities: number;
  placeSaves: Map<
    string,
    { title: string; cityName: string; countryName: string; saves: number }
  >;
  cityActivity: Map<
    string,
    { name: string; countryName: string; activity: number }
  >;
  countryActivity: Map<string, { name: string; activity: number }>;
  placesUpdated: Set<string>;
  citiesUpdated: Set<string>;
  countriesUpdated: Set<string>;
}

export interface AggregationRunResult {
  locationsFound: number;
  favoriteCitiesFound: number;
  locationsProcessed: number;
  locationsFailed: number;
  favoritesProcessed: number;
  favoritesFailed: number;
  placesUpdated: number;
  citiesUpdated: number;
  countriesUpdated: number;
  durationMs: number;
}

export const BATCH_SIZE = 500;

export const TI_PATHS = {
  places: "travelIntelligence/places/items",
  place: (placeId: string) => `travelIntelligence/places/items/${placeId}`,
  cities: "travelIntelligence/cities/items",
  city: (cityId: string) => `travelIntelligence/cities/items/${cityId}`,
  countries: "travelIntelligence/countries/items",
  country: (countryId: string) =>
    `travelIntelligence/countries/items/${countryId}`,
  daily: "travelIntelligence/daily/items",
  dailyDay: (date: string) => `travelIntelligence/daily/items/${date}`,
  /** Admin-only unique-user link docs (hashed ids, no raw userId field). */
  placeSavers: "travelIntelligence/_meta/placeSavers",
  placeSaver: (linkId: string) =>
    `travelIntelligence/_meta/placeSavers/${linkId}`,
  cityFavoriters: "travelIntelligence/_meta/cityFavoriters",
  cityFavoriter: (linkId: string) =>
    `travelIntelligence/_meta/cityFavoriters/${linkId}`,
} as const;
