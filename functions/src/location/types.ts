/**
 * Shared request/response types for location AI.
 * Mirrored conceptually with src/types/ai.ts on the web app.
 */

import type { PlaceCategory } from "../trip/types";
import { PLACE_CATEGORIES } from "../trip/types";

export type { PlaceCategory };
export { PLACE_CATEGORIES };

export type AnalyzeLocationInputType = "image" | "link";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface AnalyzeLocationImageRequest {
  type: "image";
  imageUrl: string;
  /**
   * User language (e.g. "en", "ru") — display names and narrative text use this.
   * placeId / cityId / countryId stay English/ASCII.
   */
  language?: string;
}

export interface AnalyzeLocationLinkRequest {
  type: "link";
  link: string;
  /**
   * User language (e.g. "en", "ru") — display names and narrative text use this.
   * placeId / cityId / countryId stay English/ASCII.
   */
  language?: string;
}

export type AnalyzeLocationRequest =
  | AnalyzeLocationImageRequest
  | AnalyzeLocationLinkRequest;

export interface LocationAlternative {
  title: string;
  placeId?: string;
  city?: string;
  cityId?: string;
  country: string;
  countryId?: string;
  confidence: number;
}

/**
 * Structured result returned by findPlace.
 * `identified: false` means do not treat the guess as confirmed.
 */
export interface AnalyzeLocationResult {
  identified: boolean;
  title: string;
  /** English/ASCII slug for the place (stable machine id). */
  placeId?: string;
  description: string;
  lat: number;
  lon: number;
  why: string;
  /** Display city name (may match user language). */
  city: string;
  /** English/ASCII city slug for location.city.id. */
  cityId?: string;
  /** Display country name (may match user language). */
  country: string;
  /** English/ASCII country id — prefer ISO alpha-2 lowercase. */
  countryId?: string;
  /** ISO 3166-1 alpha-2 when the model provided it. */
  countryCode?: string;
  /** Place type (beach, attraction, museum, …). */
  category?: PlaceCategory;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  locationConfidence?: number;
  exactCoordinatesConfidence?: number;
  /** True only when adaptive verification (web search) ran. */
  verificationPerformed: boolean;
  alternatives?: LocationAlternative[];
}

/**
 * Verification provider boundary — add Places/Geocoding later without
 * coupling the callable to OpenAI.
 */
export interface LocationCandidate {
  title: string;
  description?: string;
  lat: number;
  lon: number;
  city?: string;
  country?: string;
  placeId?: string;
  score?: number;
}

export interface LocationVerificationProvider {
  readonly name: string;
  searchCandidates(query: {
    clues: string[];
    latHint?: number;
    lonHint?: number;
  }): Promise<LocationCandidate[]>;
}
