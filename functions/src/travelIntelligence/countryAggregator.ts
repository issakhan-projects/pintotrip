/**
 * Country-level Travel Intelligence helpers.
 * Callers accumulate deltas, then write each country once after all reads.
 */

import {
  FieldValue,
  type DocumentReference,
  type Transaction,
} from "firebase-admin/firestore";
import {
  calculatePopularityScore,
  calculateTrendingScore,
} from "./trendCalculator";
import type { LocationStatus } from "./types";

export interface CountryDelta {
  countryId: string;
  name: string;
  savedPlacesCount: number;
  plannedCount: number;
  visitedCount: number;
  favoriteCitiesCount: number;
  bumpActivity: boolean;
}

export function createCountryDelta(
  countryId: string,
  name: string
): CountryDelta {
  return {
    countryId,
    name,
    savedPlacesCount: 0,
    plannedCount: 0,
    visitedCount: 0,
    favoriteCitiesCount: 0,
    bumpActivity: false,
  };
}

export function addLocationStatusToCountry(
  delta: CountryDelta,
  status: LocationStatus,
  sign: 1 | -1
): void {
  delta.savedPlacesCount += sign;
  if (status === "planned") delta.plannedCount += sign;
  if (status === "visited") delta.visitedCount += sign;
  if (sign > 0) delta.bumpActivity = true;
}

export function touchCountryDelta(
  map: Map<string, CountryDelta>,
  countryId: string,
  name: string
): CountryDelta {
  let d = map.get(countryId);
  if (!d) {
    d = createCountryDelta(countryId, name);
    map.set(countryId, d);
  } else {
    d.name = name;
  }
  return d;
}

export function writeCountryDoc(
  tx: Transaction,
  countryRef: DocumentReference,
  args: {
    delta: CountryDelta;
    current: {
      exists: boolean;
      savedPlacesCount: number;
      plannedCount: number;
      visitedCount: number;
      favoriteCitiesCount: number;
    };
    recentActivity: number;
    recentGrowth: number;
  }
): void {
  const { delta, current, recentActivity, recentGrowth } = args;

  const savedPlacesCount = Math.max(
    0,
    current.savedPlacesCount + delta.savedPlacesCount
  );
  const plannedCount = Math.max(0, current.plannedCount + delta.plannedCount);
  const visitedCount = Math.max(0, current.visitedCount + delta.visitedCount);
  const favoriteCitiesCount = Math.max(
    0,
    current.favoriteCitiesCount + delta.favoriteCitiesCount
  );

  const popularityScore = calculatePopularityScore({
    savedCount: savedPlacesCount,
    visitedCount,
    plannedCount,
    favoriteCount: favoriteCitiesCount,
  });
  const trendingScore = calculateTrendingScore({
    savedCount: savedPlacesCount,
    visitedCount,
    plannedCount,
    favoriteCount: favoriteCitiesCount,
    recentSaves: recentActivity,
    recentGrowth,
  });

  tx.set(
    countryRef,
    {
      countryId: delta.countryId,
      name: delta.name,
      savedPlacesCount,
      favoriteCitiesCount,
      visitedCount,
      plannedCount,
      ...(!current.exists
        ? { firstActivityAt: FieldValue.serverTimestamp() }
        : {}),
      ...(delta.bumpActivity
        ? { lastActivityAt: FieldValue.serverTimestamp() }
        : {}),
      popularityScore,
      trendingScore,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}
