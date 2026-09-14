import type { Timestamp } from "firebase/firestore";

/**
 * Global Travel Intelligence aggregates (Admin write / signed-in read).
 * Paths (Firestore-valid nesting):
 *   travelIntelligence/places/items/{placeId}
 *   travelIntelligence/cities/items/{cityId}
 *   travelIntelligence/countries/items/{countryId}
 *   travelIntelligence/daily/items/{YYYY-MM-DD}
 *
 * Never contains userId or private user data.
 */

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

export interface TravelIntelligenceDailyTopPlace {
  placeId: string;
  title: string;
  cityName: string;
  countryName: string;
  saves: number;
  score: number;
}

export interface TravelIntelligenceDailyTopCity {
  cityId: string;
  name: string;
  countryName: string;
  score: number;
}

export interface TravelIntelligenceDailyTopCountry {
  countryId: string;
  name: string;
  score: number;
}

export interface TravelIntelligenceDaily {
  date: string;
  newPlaces: number;
  newSavedLocations: number;
  newFavoriteCities: number;
  topPlaces: TravelIntelligenceDailyTopPlace[];
  topCities: TravelIntelligenceDailyTopCity[];
  topCountries: TravelIntelligenceDailyTopCountry[];
  generatedAt: Timestamp;
}
