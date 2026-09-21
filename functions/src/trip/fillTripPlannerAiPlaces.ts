/**
 * fillTripPlannerAiPlaces — AI fills free-time city slots with places.
 * Saved places stay as { locationId }; new places use locations-doc shape.
 */

import { onCall, HttpsError } from "firebase-functions/https";
import { logger } from "firebase-functions";
import { requireAuth } from "../shared/auth";
import {
  DEFAULT_FUNCTIONS_REGION,
  openaiApiKey,
} from "../shared/config";
import { createOpenAIPlacesFiller } from "../shared/openai";
import { recordAIUsage } from "../shared/aiUsage";
import { assertSufficientCredits } from "../shared/creditService";
import { initAdmin, adminDb } from "../shared/admin";
import type { LeisureType } from "./types";
import {
  extractFillPlacesJsonObject,
  parseFillPlacesModelResponse,
  type ParsedFillDay,
  type ParsedFillNestedPlace,
} from "./parseFillPlacesResponse";

type FreeTime = {
  start?: string;
  end?: string;
  durationMinutes?: number;
};

type NestedPlaceIn =
  | { locationId: string }
  | Record<string, unknown>;

type CitySlotIn = {
  cityId: string;
  freeTime?: FreeTime;
  leisureType?: string;
  places?: NestedPlaceIn[];
};

type DayIn = {
  day: number;
  date: string;
  places?: CitySlotIn[];
  routes?: unknown[];
};

type DestIn = {
  cityId?: string;
  cityName?: string;
  countryId?: string;
  countryName?: string;
  stopType?: string;
  leisureType?: string;
  savedPlaces?: Array<{ id?: string; title?: string }>;
  cityInfo?: { lat?: number; lon?: number; timezone?: string };
};

type FillRequest = {
  request: {
    trip?: {
      tripId?: string;
      currency?: string;
      leisureType?: string;
      leisureCustom?: string;
    };
    destinations?: Record<string, DestIn>;
  };
  itinerary: DayIn[];
  language?: string;
};

function isAsciiId(value: string): boolean {
  const id = value.trim().toLowerCase();
  if (!id || id === "unknown") return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}

function slimDestinationsForPrompt(
  destinations: Record<string, DestIn> | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!destinations) return out;
  for (const [key, dest] of Object.entries(destinations)) {
    if (!dest || dest.stopType === "home") continue;
    const cityId = (dest.cityId || key).trim().toLowerCase();
    if (!isAsciiId(cityId)) continue;
    out[cityId] = {
      cityId,
      cityName: dest.cityName,
      countryId: dest.countryId,
      countryName: dest.countryName,
      stopType: dest.stopType,
      ...(dest.leisureType ? { leisureType: dest.leisureType } : {}),
      ...(dest.cityInfo
        ? {
            cityInfo: {
              ...(typeof dest.cityInfo.lat === "number"
                ? { lat: dest.cityInfo.lat }
                : {}),
              ...(typeof dest.cityInfo.lon === "number"
                ? { lon: dest.cityInfo.lon }
                : {}),
              ...(dest.cityInfo.timezone
                ? { timezone: dest.cityInfo.timezone }
                : {}),
            },
          }
        : {}),
      savedPlaces: (dest.savedPlaces ?? [])
        .map((p) => p.id?.trim())
        .filter(Boolean)
        .map((id) => ({ id })),
    };
  }
  return out;
}

function slimItineraryForPrompt(itinerary: DayIn[]): unknown[] {
  return itinerary.map((day) => ({
    day: day.day,
    date: day.date,
    places: (day.places ?? [])
      .filter((s) => s?.cityId && isAsciiId(s.cityId))
      .map((s) => ({
        cityId: s.cityId.trim().toLowerCase(),
        ...(s.leisureType ? { leisureType: s.leisureType } : {}),
        freeTime: s.freeTime ?? {},
        places: (s.places ?? [])
          .map((p) => {
            if (p && typeof p === "object" && "locationId" in p) {
              const id = String(
                (p as { locationId?: unknown }).locationId ?? ""
              ).trim();
              return id ? { locationId: id } : null;
            }
            return null;
          })
          .filter(Boolean),
      })),
  }));
}

function buildCityMeta(destinations: Record<string, DestIn> | undefined) {
  const cityMeta = new Map<
    string,
    { cityName: string; countryId: string; countryName: string }
  >();
  const allowedSavedIdsByCity = new Map<string, Set<string>>();

  if (!destinations) return { cityMeta, allowedSavedIdsByCity };

  for (const [key, dest] of Object.entries(destinations)) {
    if (!dest || dest.stopType === "home") continue;
    const cityId = (dest.cityId || key).trim().toLowerCase();
    if (!isAsciiId(cityId)) continue;
    cityMeta.set(cityId, {
      cityName: dest.cityName?.trim() || cityId,
      countryId: (dest.countryId || "").trim().toLowerCase() || "xx",
      countryName: dest.countryName?.trim() || "",
    });
    const ids = new Set<string>();
    for (const p of dest.savedPlaces ?? []) {
      const id = p.id?.trim();
      if (id) ids.add(id);
    }
    // Also allow locationIds already on itinerary slots for this city.
    allowedSavedIdsByCity.set(cityId, ids);
  }

  return { cityMeta, allowedSavedIdsByCity };
}

function collectAllowedFromItinerary(
  itinerary: DayIn[],
  allowedSavedIdsByCity: Map<string, Set<string>>
): void {
  for (const day of itinerary) {
    for (const slot of day.places ?? []) {
      const cityId = slot.cityId?.trim().toLowerCase();
      if (!cityId || !isAsciiId(cityId)) continue;
      let set = allowedSavedIdsByCity.get(cityId);
      if (!set) {
        set = new Set();
        allowedSavedIdsByCity.set(cityId, set);
      }
      for (const p of slot.places ?? []) {
        if (p && typeof p === "object" && "locationId" in p) {
          const id = String(
            (p as { locationId?: unknown }).locationId ?? ""
          ).trim();
          if (id) set.add(id);
        }
      }
    }
  }
}

function isSavedRef(
  p: NestedPlaceIn
): p is { locationId: string } {
  return Boolean(
    p &&
      typeof p === "object" &&
      typeof (p as { locationId?: unknown }).locationId === "string" &&
      String((p as { locationId: string }).locationId).trim()
  );
}

function mergeDayPlaces(
  original: DayIn,
  parsed: ParsedFillDay | undefined,
  allowedSavedIdsByCity: Map<string, Set<string>>
): CitySlotIn[] {
  const originalSlots = original.places ?? [];
  if (originalSlots.length === 0) return [];

  const parsedByCity = new Map<string, ParsedFillNestedPlace[]>();
  for (const slot of parsed?.places ?? []) {
    parsedByCity.set(slot.cityId, slot.places);
  }

  return originalSlots.map((slot) => {
    const cityId = slot.cityId.trim().toLowerCase();
    const allowed = allowedSavedIdsByCity.get(cityId) ?? new Set();

    // 1) Saved refs from original slot (authoritative order).
    const saved: Array<{ locationId: string }> = [];
    const seenSaved = new Set<string>();
    for (const p of slot.places ?? []) {
      if (!isSavedRef(p)) continue;
      const id = p.locationId.trim();
      if (!id || seenSaved.has(id)) continue;
      if (allowed.size > 0 && !allowed.has(id)) continue;
      seenSaved.add(id);
      saved.push({ locationId: id });
    }

    // 2) AI new places (and any echoed saved not already listed).
    const aiPlaces = parsedByCity.get(cityId) ?? [];
    const merged: NestedPlaceIn[] = [...saved];
    const seenNew = new Set<string>();

    for (const p of aiPlaces) {
      if ("locationId" in p) {
        const id = p.locationId.trim();
        if (!id || seenSaved.has(id)) continue;
        if (allowed.size > 0 && !allowed.has(id)) continue;
        seenSaved.add(id);
        merged.push({ locationId: id });
        continue;
      }
      if (seenNew.has(p.id)) continue;
      seenNew.add(p.id);
      merged.push(p as unknown as Record<string, unknown>);
    }

    return {
      ...slot,
      cityId,
      places: merged,
    };
  });
}

function parseRequest(data: unknown): FillRequest {
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request body is required.");
  }
  const body = data as Record<string, unknown>;
  const request = body.request;
  const itinerary = body.itinerary;
  if (!request || typeof request !== "object") {
    throw new HttpsError("invalid-argument", "request is required.");
  }
  if (!Array.isArray(itinerary) || itinerary.length === 0) {
    throw new HttpsError("invalid-argument", "itinerary is required.");
  }

  const hasSlots = itinerary.some((day) => {
    if (!day || typeof day !== "object") return false;
    const places = (day as DayIn).places;
    return Array.isArray(places) && places.length > 0;
  });
  if (!hasSlots) {
    throw new HttpsError(
      "failed-precondition",
      "No free-time city slots to fill."
    );
  }

  return {
    request: request as FillRequest["request"],
    itinerary: itinerary as DayIn[],
    language:
      typeof body.language === "string" && body.language.trim()
        ? body.language.trim()
        : undefined,
  };
}

export const fillTripPlannerAiPlaces = onCall(
  {
    region: DEFAULT_FUNCTIONS_REGION,
    secrets: [openaiApiKey],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (request) => {
    const uid = requireAuth(request);
    const parsed = parseRequest(request.data);

    const tripId = parsed.request.trip?.tripId?.trim();
    if (!tripId) {
      throw new HttpsError("invalid-argument", "request.trip.tripId is required.");
    }

    // Ownership check when trip exists.
    initAdmin();
    const tripSnap = await adminDb().doc(`users/${uid}/tripPlanner/${tripId}`).get();
    if (!tripSnap.exists) {
      throw new HttpsError("not-found", "Trip not found.");
    }

    const { cityMeta, allowedSavedIdsByCity } = buildCityMeta(
      parsed.request.destinations
    );
    collectAllowedFromItinerary(parsed.itinerary, allowedSavedIdsByCity);

    const destinationsJson = JSON.stringify(
      slimDestinationsForPrompt(parsed.request.destinations)
    );
    const itineraryJson = JSON.stringify(
      slimItineraryForPrompt(parsed.itinerary)
    );

    const leisureType = parsed.request.trip?.leisureType as
      | LeisureType
      | undefined;
    const leisureCustom =
      typeof parsed.request.trip?.leisureCustom === "string"
        ? parsed.request.trip.leisureCustom.trim() || undefined
        : undefined;

    const balanceCheck = await assertSufficientCredits(uid, "planTrip");
    const remainingBefore = balanceCheck.ok
      ? balanceCheck.availableCredits
      : balanceCheck.response.availableCredits;

    const filler = createOpenAIPlacesFiller();
    let modelResult: Awaited<ReturnType<typeof filler.fill>>;
    try {
      modelResult = await filler.fill({
        language: parsed.language,
        leisureType,
        leisureCustom,
        currency: parsed.request.trip?.currency,
        destinationsJson,
        itineraryJson,
      });
    } catch (err) {
      logger.error("fillTripPlannerAiPlaces model failed", {
        uid,
        tripId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError(
        "internal",
        err instanceof Error ? err.message : "Place fill failed."
      );
    }

    let parsedDays: ParsedFillDay[] = [];
    try {
      parsedDays = parseFillPlacesModelResponse(
        extractFillPlacesJsonObject(modelResult.text),
        { allowedSavedIdsByCity, cityMeta }
      );
    } catch (err) {
      logger.error("fillTripPlannerAiPlaces parse failed", {
        uid,
        tripId,
        error: err instanceof Error ? err.message : String(err),
        preview: modelResult.text.slice(0, 600),
      });
      throw new HttpsError("internal", "Could not parse place fill response.");
    }

    const parsedByKey = new Map<string, ParsedFillDay>();
    for (const d of parsedDays) {
      parsedByKey.set(`${d.day}:${d.date}`, d);
    }

    const itinerary = parsed.itinerary.map((day) => {
      const key = `${day.day}:${day.date}`;
      const match =
        parsedByKey.get(key) ||
        parsedDays.find((d) => d.date === day.date) ||
        parsedDays.find((d) => d.day === day.day);

      return {
        ...day,
        places: mergeDayPlaces(day, match, allowedSavedIdsByCity),
      };
    });

    await recordAIUsage({
      operation: "planTrip",
      cost: modelResult.metrics.cost,
      userId: uid,
    });

    return {
      success: true as const,
      itinerary,
      model: modelResult.metrics.model,
      creditsCharged: 0,
      remainingCredits: remainingBefore,
    };
  }
);
