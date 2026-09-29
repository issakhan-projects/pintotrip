/**
 * Shared result types for findAroundMe (locations subcollection shape).
 */

import type { PlaceCategory } from "../trip/types";
import type { AroundMeRadiusKm, AroundMeTypeId } from "./aroundMeTypes";

export type AroundMePlaceResult = {
  /** Google Places resource id — for client dedupe / display. */
  googlePlaceId: string;
  /** English/ASCII place slug (not a Firestore doc id yet). */
  id: string;
  title: string;
  description: string;
  note?: string;
  status: "planned";
  category?: PlaceCategory;
  lat: number;
  lon: number;
  city: { id: string; name: string };
  country: { id: string; name: string };
  images: Array<{ url: string; source: "user" | "external" }>;
  price?: { amount?: number; currency?: string; label?: string };
  links?: Array<{ url: string; label?: string }>;
  confidence: number;
  ai: { why: string; model: string };
  source: { type: "around_me" };
};

export type FindAroundMeRequest = {
  lat: number;
  lon: number;
  typeId: AroundMeTypeId;
  /** Search radius in km: 5 | 10 | 20 | 30 */
  radiusKm: AroundMeRadiusKm;
  language?: string;
  /** Optional client-resolved English/ASCII ids (preferred over server geocode). */
  cityId?: string;
  countryId?: string;
  cityName?: string;
  countryName?: string;
};

export type FindAroundMeSuccess = {
  success: true;
  typeId: AroundMeTypeId;
  radiusKm: AroundMeRadiusKm;
  places: AroundMePlaceResult[];
};
