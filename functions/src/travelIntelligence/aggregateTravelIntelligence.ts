/**
 * Scheduled Travel Intelligence aggregation.
 *
 * Runs once daily. Processes only documents with aggregated == false.
 * Idempotent: reverses prior contribution metadata before applying the new state.
 * Never exposes an HTTP endpoint. Admin SDK writes only.
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import {
  FieldValue,
  FieldPath,
  type DocumentReference,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { adminDb } from "../shared/admin";
import {
  placeIdFromLocation,
  resolveCityId,
  resolveCountryId,
  uniqueLinkId,
} from "./placeIdentity";
import {
  addLocationStatusToCity,
  touchCityDelta,
  writeCityDoc,
  type CityDelta,
} from "./cityAggregator";
import {
  addLocationStatusToCountry,
  touchCountryDelta,
  writeCountryDoc,
  type CountryDelta,
} from "./countryAggregator";
import {
  applyStatusToPlace,
  buildLocationContribution,
  readPlaceState,
  writePlaceDoc,
  type PlaceDocState,
} from "./placeAggregator";
import type {
  AggregationRunResult,
  DailyRunStats,
  FavoriteCityIntelligenceContribution,
  SourceFavoriteCity,
  SourceLocation,
} from "./types";
import { BATCH_SIZE, TI_PATHS } from "./types";

const TOP_N = 10;

function emptyStats(): DailyRunStats {
  return {
    newPlaces: 0,
    newSavedLocations: 0,
    newFavoriteCities: 0,
    placeSaves: new Map(),
    cityActivity: new Map(),
    countryActivity: new Map(),
    placesUpdated: new Set(),
    citiesUpdated: new Set(),
    countriesUpdated: new Set(),
  };
}

function utcDateString(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function daysAgoUtc(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return utcDateString(d);
}

/**
 * Load recent daily snapshots to estimate recentSaves / recentGrowth.
 * Privacy-safe: daily docs contain no user ids.
 */
async function loadRecentTrendSignals(
  db: ReturnType<typeof adminDb>
): Promise<{ recentSaves: number; recentGrowth: number }> {
  const recentDates = Array.from({ length: 7 }, (_, i) => daysAgoUtc(i));
  const priorDates = Array.from({ length: 7 }, (_, i) => daysAgoUtc(i + 7));

  const [recentSnaps, priorSnaps] = await Promise.all([
    Promise.all(recentDates.map((date) => db.doc(TI_PATHS.dailyDay(date)).get())),
    Promise.all(priorDates.map((date) => db.doc(TI_PATHS.dailyDay(date)).get())),
  ]);

  const sumSaves = (
    snaps: Array<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  ) =>
    snaps.reduce((acc, snap) => {
      if (!snap.exists) return acc;
      const n = snap.data()?.newSavedLocations;
      return acc + (typeof n === "number" ? n : 0);
    }, 0);

  const recentSaves = sumSaves(recentSnaps);
  const priorSaves = sumSaves(priorSnaps);
  return { recentSaves, recentGrowth: recentSaves - priorSaves };
}

function userIdFromPath(path: string, segment: "locations" | "favoriteCities"): string {
  // users/{userId}/locations/{id} or users/{userId}/favoriteCities/{id}
  const parts = path.split("/");
  const idx = parts.indexOf(segment);
  if (idx < 1) return "";
  return parts[idx - 1] ?? "";
}

async function processLocationDoc(
  snap: QueryDocumentSnapshot,
  stats: DailyRunStats,
  trend: { recentSaves: number; recentGrowth: number }
): Promise<void> {
  const db = adminDb();
  const userId = userIdFromPath(snap.ref.path, "locations");
  if (!userId) {
    throw new Error(`Could not resolve userId from ${snap.ref.path}`);
  }

  const txResult = await db.runTransaction(async (tx) => {
    // Re-read source inside the transaction for idempotency under overlap.
    const liveSnap = await tx.get(snap.ref);
    if (!liveSnap.exists) return null;

    const location = liveSnap.data() as SourceLocation;
    if (location.aggregated === true && location.deleted !== true) {
      return null;
    }

    const previous = location.intelligenceContribution;
    const isDeleted = location.deleted === true;

    const placeId =
      isDeleted && previous ? previous.placeId : placeIdFromLocation(location);
    const countryId =
      isDeleted && previous
        ? previous.countryId
        : resolveCountryId(location.country);
    const cityId =
      isDeleted && previous
        ? previous.cityId
        : resolveCityId(location.city, countryId);

    const cityDeltas = new Map<string, CityDelta>();
    const countryDeltas = new Map<string, CountryDelta>();

    if (previous) {
      addLocationStatusToCity(
        touchCityDelta(
          cityDeltas,
          previous.cityId,
          previous.cityName,
          previous.countryId,
          previous.countryName
        ),
        previous.status,
        -1
      );
      addLocationStatusToCountry(
        touchCountryDelta(
          countryDeltas,
          previous.countryId,
          previous.countryName
        ),
        previous.status,
        -1
      );
    }

    if (!isDeleted) {
      addLocationStatusToCity(
        touchCityDelta(
          cityDeltas,
          cityId,
          location.city.name,
          countryId,
          location.country.name
        ),
        location.status,
        1
      );
      addLocationStatusToCountry(
        touchCountryDelta(countryDeltas, countryId, location.country.name),
        location.status,
        1
      );
    }

    // ---------- READS ----------
    const placeIdsToTouch = new Set<string>();
    if (previous) placeIdsToTouch.add(previous.placeId);
    if (!isDeleted) placeIdsToTouch.add(placeId);

    const placeReads = new Map<
      string,
      { ref: DocumentReference; state: PlaceDocState; saverRef: DocumentReference; saverRefCount: number }
    >();

    for (const pid of placeIdsToTouch) {
      const placeRef = db.doc(TI_PATHS.place(pid));
      const saverRef = db.doc(TI_PATHS.placeSaver(uniqueLinkId(pid, userId)));
      const placeSnap = await tx.get(placeRef);
      const saverSnap = await tx.get(saverRef);
      placeReads.set(pid, {
        ref: placeRef,
        state: readPlaceState(
          placeSnap.data() as Record<string, unknown> | undefined,
          placeSnap.exists
        ),
        saverRef,
        saverRefCount:
          saverSnap.exists && typeof saverSnap.data()?.refCount === "number"
            ? (saverSnap.data()!.refCount as number)
            : 0,
      });
    }

    const cityReads = new Map<
      string,
      {
        ref: DocumentReference;
        exists: boolean;
        savedPlacesCount: number;
        plannedCount: number;
        visitedCount: number;
        favoriteCount: number;
      }
    >();
    for (const cid of cityDeltas.keys()) {
      const ref = db.doc(TI_PATHS.city(cid));
      const citySnap = await tx.get(ref);
      const data = (citySnap.data() ?? {}) as Record<string, unknown>;
      cityReads.set(cid, {
        ref,
        exists: citySnap.exists,
        savedPlacesCount:
          typeof data.savedPlacesCount === "number" ? data.savedPlacesCount : 0,
        plannedCount: typeof data.plannedCount === "number" ? data.plannedCount : 0,
        visitedCount: typeof data.visitedCount === "number" ? data.visitedCount : 0,
        favoriteCount:
          typeof data.favoriteCount === "number" ? data.favoriteCount : 0,
      });
    }

    const countryReads = new Map<
      string,
      {
        ref: DocumentReference;
        exists: boolean;
        savedPlacesCount: number;
        plannedCount: number;
        visitedCount: number;
        favoriteCitiesCount: number;
      }
    >();
    for (const cid of countryDeltas.keys()) {
      const ref = db.doc(TI_PATHS.country(cid));
      const countrySnap = await tx.get(ref);
      const data = (countrySnap.data() ?? {}) as Record<string, unknown>;
      countryReads.set(cid, {
        ref,
        exists: countrySnap.exists,
        savedPlacesCount:
          typeof data.savedPlacesCount === "number" ? data.savedPlacesCount : 0,
        plannedCount: typeof data.plannedCount === "number" ? data.plannedCount : 0,
        visitedCount: typeof data.visitedCount === "number" ? data.visitedCount : 0,
        favoriteCitiesCount:
          typeof data.favoriteCitiesCount === "number"
            ? data.favoriteCitiesCount
            : 0,
      });
    }

    // ---------- COMPUTE PLACE STATE ----------
    // Reverse previous place contribution
    if (previous) {
      const prevRead = placeReads.get(previous.placeId);
      if (prevRead) {
        applyStatusToPlace(prevRead.state, previous.status, -1);
        if (previous.countedAsUniqueSaver) {
          prevRead.saverRefCount = Math.max(0, prevRead.saverRefCount - 1);
          if (prevRead.saverRefCount === 0) {
            prevRead.state.savedCount = Math.max(0, prevRead.state.savedCount - 1);
          }
        }
      }
    }

    let nextContribution =
      null as ReturnType<typeof buildLocationContribution> | null;
    let countedAsUniqueSaver = false;
    let addedNewPlace = false;
    let addedNewSave = false;
    let saveMeta:
      | {
          placeId: string;
          title: string;
          cityName: string;
          countryName: string;
        }
      | undefined;

    if (!isDeleted) {
      const cur = placeReads.get(placeId);
      if (!cur) throw new Error(`Missing place read for ${placeId}`);

      applyStatusToPlace(cur.state, location.status, 1);

      const wasUnique = cur.saverRefCount > 0;
      cur.saverRefCount += 1;
      countedAsUniqueSaver = true;

      if (!wasUnique) {
        cur.state.savedCount += 1;
        const isReapplySame = Boolean(previous && previous.placeId === placeId);
        if (!isReapplySame) {
          addedNewSave = true;
          saveMeta = {
            placeId,
            title: location.title,
            cityName: location.city.name,
            countryName: location.country.name,
          };
        }
      }

      if (!cur.state.exists) addedNewPlace = true;

      nextContribution = buildLocationContribution({
        placeId,
        cityId,
        countryId,
        location,
        countedAsUniqueSaver,
      });
    }

    // ---------- WRITES ----------
    const touchedPlaces: string[] = [];
    const touchedCities: Array<{ id: string; delta: CityDelta }> = [];
    const touchedCountries: Array<{ id: string; delta: CountryDelta }> = [];

    for (const [pid, read] of placeReads) {
      const isCurrent = !isDeleted && pid === placeId;
      writePlaceDoc(tx, read.ref, {
        placeId: pid,
        state: read.state,
        location: isCurrent ? location : undefined,
        recentSaves: trend.recentSaves,
        recentGrowth: trend.recentGrowth,
        setMetadata: isCurrent,
      });
      touchedPlaces.push(pid);

      if (read.saverRefCount <= 0) {
        tx.delete(read.saverRef);
      } else {
        tx.set(read.saverRef, { refCount: read.saverRefCount }, { merge: true });
      }
    }

    for (const [cid, delta] of cityDeltas) {
      const read = cityReads.get(cid);
      if (!read) continue;
      writeCityDoc(tx, read.ref, {
        delta,
        current: read,
        recentActivity: trend.recentSaves,
        recentGrowth: trend.recentGrowth,
      });
      touchedCities.push({ id: cid, delta });
    }

    for (const [cid, delta] of countryDeltas) {
      const read = countryReads.get(cid);
      if (!read) continue;
      writeCountryDoc(tx, read.ref, {
        delta,
        current: read,
        recentActivity: trend.recentSaves,
        recentGrowth: trend.recentGrowth,
      });
      touchedCountries.push({ id: cid, delta });
    }

    // Mark source only after successful aggregate writes in this transaction.
    if (isDeleted) {
      tx.delete(snap.ref);
    } else {
      tx.update(snap.ref, {
        aggregated: true,
        aggregatedAt: FieldValue.serverTimestamp(),
        intelligenceContribution: nextContribution,
        deleted: FieldValue.delete(),
      });
    }

    return {
      addedNewPlace,
      addedNewSave,
      saveMeta,
      touchedPlaces,
      touchedCities,
      touchedCountries,
    };
  });

  // Apply run stats only after the transaction commits (avoids retry double-count).
  if (!txResult) return;
  if (txResult.addedNewPlace) stats.newPlaces += 1;
  if (txResult.addedNewSave && txResult.saveMeta) {
    stats.newSavedLocations += 1;
    const { placeId, title, cityName, countryName } = txResult.saveMeta;
    const entry = stats.placeSaves.get(placeId) ?? {
      title,
      cityName,
      countryName,
      saves: 0,
    };
    entry.saves += 1;
    entry.title = title;
    entry.cityName = cityName;
    entry.countryName = countryName;
    stats.placeSaves.set(placeId, entry);
  }
  for (const pid of txResult.touchedPlaces) stats.placesUpdated.add(pid);
  for (const { id, delta } of txResult.touchedCities) {
    stats.citiesUpdated.add(id);
    if (delta.bumpActivity || delta.savedPlacesCount > 0) {
      const entry = stats.cityActivity.get(id) ?? {
        name: delta.name,
        countryName: delta.countryName,
        activity: 0,
      };
      entry.name = delta.name;
      entry.countryName = delta.countryName;
      if (
        delta.savedPlacesCount > 0 ||
        delta.plannedCount > 0 ||
        delta.visitedCount > 0
      ) {
        entry.activity += 1;
      }
      stats.cityActivity.set(id, entry);
    }
  }
  for (const { id, delta } of txResult.touchedCountries) {
    stats.countriesUpdated.add(id);
    if (delta.bumpActivity || delta.savedPlacesCount > 0) {
      const entry = stats.countryActivity.get(id) ?? {
        name: delta.name,
        activity: 0,
      };
      entry.name = delta.name;
      if (
        delta.savedPlacesCount > 0 ||
        delta.plannedCount > 0 ||
        delta.visitedCount > 0
      ) {
        entry.activity += 1;
      }
      stats.countryActivity.set(id, entry);
    }
  }
}

async function processFavoriteDoc(
  snap: QueryDocumentSnapshot,
  stats: DailyRunStats,
  trend: { recentSaves: number; recentGrowth: number }
): Promise<void> {
  const db = adminDb();
  const userId = userIdFromPath(snap.ref.path, "favoriteCities");
  if (!userId) {
    throw new Error(`Could not resolve userId from ${snap.ref.path}`);
  }

  const txResult = await db.runTransaction(async (tx) => {
    const liveSnap = await tx.get(snap.ref);
    if (!liveSnap.exists) return null;

    const favorite = liveSnap.data() as SourceFavoriteCity;
    if (favorite.aggregated === true && favorite.deleted !== true) {
      return null;
    }

    const previous = favorite.intelligenceContribution;
    const isDeleted = favorite.deleted === true;

    const countryId =
      isDeleted && previous
        ? previous.countryId
        : resolveCountryId(favorite.country);
    const cityId =
      isDeleted && previous
        ? previous.cityId
        : favorite.cityId?.trim() ||
          resolveCityId({ name: favorite.cityName }, countryId);

    const cityDeltas = new Map<string, CityDelta>();
    const countryDeltas = new Map<string, CountryDelta>();

    // ---------- READS ----------
    const linkReads = new Map<
      string,
      { ref: DocumentReference; refCount: number; cityId: string }
    >();

    const linksToRead: Array<{ cityKey: string; linkId: string }> = [];
    if (previous) {
      linksToRead.push({
        cityKey: previous.cityId,
        linkId: uniqueLinkId(previous.cityId, userId),
      });
    }
    if (!isDeleted || (previous && previous.cityId === cityId)) {
      linksToRead.push({
        cityKey: cityId,
        linkId: uniqueLinkId(cityId, userId),
      });
    }

    const seenLinks = new Set<string>();
    for (const item of linksToRead) {
      if (seenLinks.has(item.linkId)) continue;
      seenLinks.add(item.linkId);
      const ref = db.doc(TI_PATHS.cityFavoriter(item.linkId));
      const linkSnap = await tx.get(ref);
      linkReads.set(item.cityKey, {
        ref,
        cityId: item.cityKey,
        refCount:
          linkSnap.exists && typeof linkSnap.data()?.refCount === "number"
            ? (linkSnap.data()!.refCount as number)
            : 0,
      });
    }

    const cityIds = new Set<string>();
    const countryIds = new Set<string>();
    if (previous) {
      cityIds.add(previous.cityId);
      countryIds.add(previous.countryId);
    }
    if (!isDeleted) {
      cityIds.add(cityId);
      countryIds.add(countryId);
    }

    const cityReads = new Map<
      string,
      {
        ref: DocumentReference;
        exists: boolean;
        savedPlacesCount: number;
        plannedCount: number;
        visitedCount: number;
        favoriteCount: number;
      }
    >();
    for (const cid of cityIds) {
      const ref = db.doc(TI_PATHS.city(cid));
      const citySnap = await tx.get(ref);
      const data = (citySnap.data() ?? {}) as Record<string, unknown>;
      cityReads.set(cid, {
        ref,
        exists: citySnap.exists,
        savedPlacesCount:
          typeof data.savedPlacesCount === "number" ? data.savedPlacesCount : 0,
        plannedCount:
          typeof data.plannedCount === "number" ? data.plannedCount : 0,
        visitedCount:
          typeof data.visitedCount === "number" ? data.visitedCount : 0,
        favoriteCount:
          typeof data.favoriteCount === "number" ? data.favoriteCount : 0,
      });
    }

    const countryReads = new Map<
      string,
      {
        ref: DocumentReference;
        exists: boolean;
        savedPlacesCount: number;
        plannedCount: number;
        visitedCount: number;
        favoriteCitiesCount: number;
      }
    >();
    for (const cid of countryIds) {
      const ref = db.doc(TI_PATHS.country(cid));
      const countrySnap = await tx.get(ref);
      const data = (countrySnap.data() ?? {}) as Record<string, unknown>;
      countryReads.set(cid, {
        ref,
        exists: countrySnap.exists,
        savedPlacesCount:
          typeof data.savedPlacesCount === "number" ? data.savedPlacesCount : 0,
        plannedCount:
          typeof data.plannedCount === "number" ? data.plannedCount : 0,
        visitedCount:
          typeof data.visitedCount === "number" ? data.visitedCount : 0,
        favoriteCitiesCount:
          typeof data.favoriteCitiesCount === "number"
            ? data.favoriteCitiesCount
            : 0,
      });
    }

    // ---------- COMPUTE ----------
    let addedNewFavorite = false;
    let nextContribution: FavoriteCityIntelligenceContribution | null = null;

    const adjustFavorite = (
      cId: string,
      cName: string,
      coId: string,
      coName: string,
      sign: 1 | -1
    ) => {
      const city = touchCityDelta(cityDeltas, cId, cName, coId, coName);
      city.favoriteCount += sign;
      if (sign > 0) city.bumpActivity = true;
      const country = touchCountryDelta(countryDeltas, coId, coName);
      country.favoriteCitiesCount += sign;
      if (sign > 0) country.bumpActivity = true;
    };

    if (previous?.countedAsUniqueFavorite) {
      const prevLink = linkReads.get(previous.cityId);
      if (prevLink) {
        prevLink.refCount = Math.max(0, prevLink.refCount - 1);
        if (prevLink.refCount === 0) {
          adjustFavorite(
            previous.cityId,
            previous.cityName,
            previous.countryId,
            previous.countryName,
            -1
          );
        }
      }
    }

    if (!isDeleted) {
      let curLink = linkReads.get(cityId);
      if (!curLink) {
        curLink = {
          ref: db.doc(TI_PATHS.cityFavoriter(uniqueLinkId(cityId, userId))),
          cityId,
          refCount: 0,
        };
        linkReads.set(cityId, curLink);
      }

      const wasUnique = curLink.refCount > 0;
      curLink.refCount += 1;

      if (!wasUnique) {
        const isReapply = Boolean(previous && previous.cityId === cityId);
        adjustFavorite(
          cityId,
          favorite.cityName,
          countryId,
          favorite.country,
          1
        );
        if (!isReapply) addedNewFavorite = true;
      }

      nextContribution = {
        cityId,
        countryId,
        cityName: favorite.cityName,
        countryName: favorite.country,
        countedAsUniqueFavorite: true,
      };
    }

    if (!isDeleted) {
      touchCityDelta(
        cityDeltas,
        cityId,
        favorite.cityName,
        countryId,
        favorite.country
      );
      touchCountryDelta(countryDeltas, countryId, favorite.country);
    }

    // ---------- WRITES ----------
    for (const [, link] of linkReads) {
      if (link.refCount <= 0) {
        tx.delete(link.ref);
      } else {
        tx.set(link.ref, { refCount: link.refCount }, { merge: true });
      }
    }

    const touchedCities: Array<{ id: string; delta: CityDelta }> = [];
    const touchedCountries: Array<{ id: string; delta: CountryDelta }> = [];

    for (const [cid, delta] of cityDeltas) {
      const read = cityReads.get(cid);
      if (!read) continue;
      writeCityDoc(tx, read.ref, {
        delta,
        current: read,
        recentActivity: trend.recentSaves,
        recentGrowth: trend.recentGrowth,
      });
      touchedCities.push({ id: cid, delta });
    }

    for (const [cid, delta] of countryDeltas) {
      const read = countryReads.get(cid);
      if (!read) continue;
      writeCountryDoc(tx, read.ref, {
        delta,
        current: read,
        recentActivity: trend.recentSaves,
        recentGrowth: trend.recentGrowth,
      });
      touchedCountries.push({ id: cid, delta });
    }

    if (isDeleted) {
      tx.delete(snap.ref);
    } else {
      tx.update(snap.ref, {
        aggregated: true,
        aggregatedAt: FieldValue.serverTimestamp(),
        intelligenceContribution: nextContribution,
        deleted: FieldValue.delete(),
      });
    }

    return {
      addedNewFavorite,
      favoriteMeta: addedNewFavorite
        ? {
            cityId,
            name: favorite.cityName,
            countryName: favorite.country,
          }
        : undefined,
      touchedCities,
      touchedCountries,
    };
  });

  if (!txResult) return;
  if (txResult.addedNewFavorite) {
    stats.newFavoriteCities += 1;
    if (txResult.favoriteMeta) {
      const { cityId, name, countryName } = txResult.favoriteMeta;
      const entry = stats.cityActivity.get(cityId) ?? {
        name,
        countryName,
        activity: 0,
      };
      entry.activity += 1;
      entry.name = name;
      entry.countryName = countryName;
      stats.cityActivity.set(cityId, entry);
    }
  }
  for (const { id } of txResult.touchedCities) stats.citiesUpdated.add(id);
  for (const { id, delta } of txResult.touchedCountries) {
    stats.countriesUpdated.add(id);
    if (delta.bumpActivity || delta.favoriteCitiesCount > 0) {
      const entry = stats.countryActivity.get(id) ?? {
        name: delta.name,
        activity: 0,
      };
      entry.name = delta.name;
      if (delta.favoriteCitiesCount > 0) entry.activity += 1;
      stats.countryActivity.set(id, entry);
    }
  }
}

async function writeDailySnapshot(
  stats: DailyRunStats,
  trend: { recentSaves: number; recentGrowth: number }
): Promise<void> {
  const db = adminDb();
  const date = utcDateString();

  const topPlaces = [...stats.placeSaves.entries()]
    .map(([placeId, v]) => ({
      placeId,
      title: v.title,
      cityName: v.cityName,
      countryName: v.countryName,
      saves: v.saves,
      score: v.saves * 3 + trend.recentGrowth * 0.1,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  const topCities = [...stats.cityActivity.entries()]
    .map(([cityId, v]) => ({
      cityId,
      name: v.name,
      countryName: v.countryName,
      score: v.activity,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  const topCountries = [...stats.countryActivity.entries()]
    .map(([countryId, v]) => ({
      countryId,
      name: v.name,
      score: v.activity,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  await db.doc(TI_PATHS.dailyDay(date)).set(
    {
      date,
      newPlaces: stats.newPlaces,
      newSavedLocations: stats.newSavedLocations,
      newFavoriteCities: stats.newFavoriteCities,
      topPlaces,
      topCities,
      topCountries,
      generatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Process all unaggregated locations / favorite cities in pages of BATCH_SIZE.
 */
export async function runTravelIntelligenceAggregation(): Promise<AggregationRunResult> {
  const started = Date.now();
  const db = adminDb();
  const stats = emptyStats();

  logger.info("aggregateTravelIntelligence.started");

  const trend = await loadRecentTrendSignals(db);

  let locationsFound = 0;
  let locationsProcessed = 0;
  let locationsFailed = 0;
  let favoritesFound = 0;
  let favoritesProcessed = 0;
  let favoritesFailed = 0;

  // ---- Locations ----
  let lastLoc: QueryDocumentSnapshot | undefined;
  for (;;) {
    let q = db
      .collectionGroup("locations")
      .where("aggregated", "==", false)
      .orderBy(FieldPath.documentId())
      .limit(BATCH_SIZE);

    if (lastLoc) {
      q = q.startAfter(lastLoc);
    }

    const page = await q.get();
    if (page.empty) break;

    locationsFound += page.size;
    lastLoc = page.docs[page.docs.length - 1];

    for (const docSnap of page.docs) {
      try {
        await processLocationDoc(docSnap, stats, trend);
        locationsProcessed += 1;
      } catch (err) {
        locationsFailed += 1;
        logger.error("aggregateTravelIntelligence.locationFailed", {
          path: docSnap.ref.path,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (page.size < BATCH_SIZE) break;
  }

  // ---- Favorite cities ----
  let lastFav: QueryDocumentSnapshot | undefined;
  for (;;) {
    let q = db
      .collectionGroup("favoriteCities")
      .where("aggregated", "==", false)
      .orderBy(FieldPath.documentId())
      .limit(BATCH_SIZE);

    if (lastFav) {
      q = q.startAfter(lastFav);
    }

    const page = await q.get();
    if (page.empty) break;

    favoritesFound += page.size;
    lastFav = page.docs[page.docs.length - 1];

    for (const docSnap of page.docs) {
      try {
        await processFavoriteDoc(docSnap, stats, trend);
        favoritesProcessed += 1;
      } catch (err) {
        favoritesFailed += 1;
        logger.error("aggregateTravelIntelligence.favoriteFailed", {
          path: docSnap.ref.path,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (page.size < BATCH_SIZE) break;
  }

  await writeDailySnapshot(stats, trend);

  const result: AggregationRunResult = {
    locationsFound,
    favoriteCitiesFound: favoritesFound,
    locationsProcessed,
    locationsFailed,
    favoritesProcessed,
    favoritesFailed,
    placesUpdated: stats.placesUpdated.size,
    citiesUpdated: stats.citiesUpdated.size,
    countriesUpdated: stats.countriesUpdated.size,
    durationMs: Date.now() - started,
  };

  logger.info("aggregateTravelIntelligence.completed", {
    locationsFound: result.locationsFound,
    favoriteCitiesFound: result.favoriteCitiesFound,
    locationsProcessed: result.locationsProcessed,
    locationsFailed: result.locationsFailed,
    favoritesProcessed: result.favoritesProcessed,
    favoritesFailed: result.favoritesFailed,
    placesUpdated: result.placesUpdated,
    citiesUpdated: result.citiesUpdated,
    countriesUpdated: result.countriesUpdated,
    durationMs: result.durationMs,
  });

  return result;
}

/**
 * Daily scheduled Cloud Function — server-only, not an HTTP endpoint.
 */
export const aggregateTravelIntelligence = onSchedule(
  {
    schedule: "every day 03:00",
    timeZone: "UTC",
    timeoutSeconds: 540,
    memory: "1GiB",
  },
  async () => {
    await runTravelIntelligenceAggregation();
  }
);
