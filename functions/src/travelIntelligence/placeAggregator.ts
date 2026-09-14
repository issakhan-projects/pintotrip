/**
 * Place-level Travel Intelligence helpers.
 * Callers must perform all transaction reads before any writes.
 */

import { FieldValue, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import {
  calculatePopularityScore,
  calculateTrendingScore,
} from "./trendCalculator";
import type {
  LocationIntelligenceContribution,
  LocationStatus,
  SourceLocation,
} from "./types";

export function statusCountDelta(
  status: LocationStatus,
  sign: 1 | -1
): { plannedCount: number; visitedCount: number; cancelledCount: number } {
  return {
    plannedCount: status === "planned" ? sign : 0,
    visitedCount: status === "visited" ? sign : 0,
    cancelledCount: status === "cancelled" ? sign : 0,
  };
}

export function clampNonNegative(current: number, delta: number): number {
  return Math.max(0, current + delta);
}

export interface PlaceDocState {
  savedCount: number;
  plannedCount: number;
  visitedCount: number;
  cancelledCount: number;
  exists: boolean;
}

export function readPlaceState(
  data: Record<string, unknown> | undefined,
  exists: boolean
): PlaceDocState {
  return {
    exists,
    savedCount: typeof data?.savedCount === "number" ? data.savedCount : 0,
    plannedCount: typeof data?.plannedCount === "number" ? data.plannedCount : 0,
    visitedCount: typeof data?.visitedCount === "number" ? data.visitedCount : 0,
    cancelledCount:
      typeof data?.cancelledCount === "number" ? data.cancelledCount : 0,
  };
}

export function applyStatusToPlace(
  state: PlaceDocState,
  status: LocationStatus,
  sign: 1 | -1
): void {
  const d = statusCountDelta(status, sign);
  state.plannedCount = clampNonNegative(state.plannedCount, d.plannedCount);
  state.visitedCount = clampNonNegative(state.visitedCount, d.visitedCount);
  state.cancelledCount = clampNonNegative(state.cancelledCount, d.cancelledCount);
}

export function writePlaceDoc(
  tx: Transaction,
  placeRef: DocumentReference,
  args: {
    placeId: string;
    state: PlaceDocState;
    location?: SourceLocation;
    recentSaves: number;
    recentGrowth: number;
    setMetadata: boolean;
  }
): void {
  const { placeId, state, location, recentSaves, recentGrowth, setMetadata } =
    args;

  const popularityScore = calculatePopularityScore({
    savedCount: state.savedCount,
    visitedCount: state.visitedCount,
    plannedCount: state.plannedCount,
    cancelledCount: state.cancelledCount,
  });
  const trendingScore = calculateTrendingScore({
    savedCount: state.savedCount,
    visitedCount: state.visitedCount,
    plannedCount: state.plannedCount,
    cancelledCount: state.cancelledCount,
    recentSaves,
    recentGrowth,
  });

  const payload: Record<string, unknown> = {
    placeId,
    savedCount: state.savedCount,
    plannedCount: state.plannedCount,
    visitedCount: state.visitedCount,
    cancelledCount: state.cancelledCount,
    popularityScore,
    trendingScore,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (setMetadata && location) {
    payload.title = location.title;
    payload.city = {
      ...(location.city.id ? { id: location.city.id } : {}),
      name: location.city.name,
    };
    payload.country = {
      ...(location.country.id ? { id: location.country.id } : {}),
      name: location.country.name,
    };
    payload.lat = location.lat;
    payload.lon = location.lon;
    if (!state.exists) {
      payload.firstSavedAt = FieldValue.serverTimestamp();
    }
    payload.lastSavedAt = FieldValue.serverTimestamp();
  }

  tx.set(placeRef, payload, { merge: true });
}

export function buildLocationContribution(args: {
  placeId: string;
  cityId: string;
  countryId: string;
  location: SourceLocation;
  countedAsUniqueSaver: boolean;
}): LocationIntelligenceContribution {
  const { placeId, cityId, countryId, location, countedAsUniqueSaver } = args;
  return {
    placeId,
    cityId,
    countryId,
    status: location.status,
    title: location.title,
    lat: location.lat,
    lon: location.lon,
    cityName: location.city.name,
    countryName: location.country.name,
    countedAsUniqueSaver,
  };
}
