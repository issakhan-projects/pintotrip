/**
 * Location AI request/response contracts.
 * OpenAI is called ONLY from Cloud Functions — never from the browser.
 */

import type { PlaceCategory } from "./trip-plan";

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
 * Structured result returned by findPlace Cloud Function.
 * Never present an uncertain guess as confirmed when identified is false.
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
  /** Overall confidence score between 0 and 1. */
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  /** Optional: landmark/place identification confidence. */
  locationConfidence?: number;
  /** Optional: exact viewpoint/coordinates confidence. */
  exactCoordinatesConfidence?: number;
  /** True when adaptive web-search verification ran. */
  verificationPerformed: boolean;
  alternatives?: LocationAlternative[];
}

/**
 * Confidence bands for UI interpretation.
 * Aligned with adaptive verification thresholds.
 */
export function getConfidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.7) return "medium";
  return "low";
}

/**
 * Pluggable verification provider contract.
 * Allows adding Google Places / other search APIs without coupling to OpenAI.
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

export interface LocationVisionAnalyzer {
  readonly name: string;
  analyze(input: AnalyzeLocationRequest): Promise<{
    clues: string[];
    draft?: Partial<AnalyzeLocationResult>;
  }>;
}
