/**
 * City-level Travel Intelligence helpers.
 * Callers accumulate deltas, then write each city once after all reads.
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

export interface CityDelta {
  cityId: string;
  name: string;
  countryId: string;
  countryName: string;
  savedPlacesCount: number;
  plannedCount: number;
  visitedCount: number;
  favoriteCount: number;
  bumpActivity: boolean;
}

export function createCityDelta(
  cityId: string,
  name: string,
  countryId: string,
  countryName: string
): CityDelta {
  return {
    cityId,
    name,
    countryId,
    countryName,
    savedPlacesCount: 0,
    plannedCount: 0,
    visitedCount: 0,
    favoriteCount: 0,
    bumpActivity: false,
  };
}

export function addLocationStatusToCity(
  delta: CityDelta,
  status: LocationStatus,
  sign: 1 | -1
): void {
  delta.savedPlacesCount += sign;
  if (status === "planned") delta.plannedCount += sign;
  if (status === "visited") delta.visitedCount += sign;
  if (sign > 0) delta.bumpActivity = true;
}

export function touchCityDelta(
  map: Map<string, CityDelta>,
  cityId: string,
  name: string,
  countryId: string,
  countryName: string
): CityDelta {
  let d = map.get(cityId);
  if (!d) {
    d = createCityDelta(cityId, name, countryId, countryName);
    map.set(cityId, d);
  } else {
    d.name = name;
    d.countryId = countryId;
    d.countryName = countryName;
  }
  return d;
}

export function writeCityDoc(
  tx: Transaction,
  cityRef: DocumentReference,
  args: {
    delta: CityDelta;
    current: {
      exists: boolean;
      savedPlacesCount: number;
      plannedCount: number;
      visitedCount: number;
      favoriteCount: number;
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
  const favoriteCount = Math.max(0, current.favoriteCount + delta.favoriteCount);

  const popularityScore = calculatePopularityScore({
    savedCount: savedPlacesCount,
    visitedCount,
    plannedCount,
    favoriteCount,
  });
  const trendingScore = calculateTrendingScore({
    savedCount: savedPlacesCount,
    visitedCount,
    plannedCount,
    favoriteCount,
    recentSaves: recentActivity,
    recentGrowth,
  });

  tx.set(
    cityRef,
    {
      cityId: delta.cityId,
      name: delta.name,
      countryId: delta.countryId,
      countryName: delta.countryName,
      savedPlacesCount,
      favoriteCount,
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
