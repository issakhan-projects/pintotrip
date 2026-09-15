import { onCall, HttpsError } from "firebase-functions/https";
import { logger } from "firebase-functions";
import { requireAuth, assertNonEmptyString } from "../shared/auth";
import { DEFAULT_FUNCTIONS_REGION, openaiApiKey } from "../shared/config";
import { createOpenAITripPlanner } from "../shared/openai";
import { recordAIUsage } from "../shared/aiUsage";
import {
  assertSufficientCredits,
  deductCredits,
} from "../shared/creditService";
import type { InsufficientAICreditsError } from "../shared/credits";
import {
  getRequiredCredits,
  planTripRegenerateOperation,
} from "../shared/credits";
import { initAdmin, adminDb } from "../shared/admin";
import {
  AI_CACHE_TTL,
  executeCachedAI,
  planTripFingerprint,
} from "../shared/ai";
import {
  LEISURE_TYPES,
  type LeisureType,
  type PlanTripExistingDay,
  type PlanTripMode,
  type PlanTripRequest,
  type PlanTripResult,
  type PlannedDaySuggestion,
  type PlanTripDestination,
  type PlanTripSavedPlace,
  type PlanTripWeatherDay,
} from "./types";

function isLeisureType(value: unknown): value is LeisureType {
  return (
    typeof value === "string" &&
    (LEISURE_TYPES as readonly string[]).includes(value)
  );
}

/** Accept country id/code, common labels, and holy-city destinations. */
function isSaudiArabiaDestination(input: {
  countryName: string;
  countryId?: string;
  cityName?: string;
  cityId?: string;
}): boolean {
  const countryId = input.countryId?.trim().toLowerCase() ?? "";
  if (countryId === "sa" || countryId === "ksa") return true;

  const country = input.countryName.trim().toLowerCase();
  if (country === "sa" || country === "ksa") return true;
  if (country.includes("saudi")) return true;
  // المملكة العربية السعودية / السعودية
  if (country.includes("سعود")) return true;

  const city = `${input.cityId ?? ""} ${input.cityName ?? ""}`
    .trim()
    .toLowerCase();
  if (
    /\b(makkah|mecca|madinah|medina|jeddah|riyadh)\b/.test(city) ||
    city.includes("مكة") ||
    city.includes("مدينة") ||
    city.includes("المدينة") ||
    city.includes("جدة") ||
    city.includes("الرياض")
  ) {
    return true;
  }

  return false;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseExistingDays(value: unknown): PlanTripExistingDay[] {
  if (!Array.isArray(value)) {
    throw new HttpsError(
      "invalid-argument",
      "existingDays must be an array."
    );
  }

  return value.map((row, index) => {
    if (!row || typeof row !== "object") {
      throw new HttpsError(
        "invalid-argument",
        `existingDays[${index}] must be an object.`
      );
    }
    const body = row as Record<string, unknown>;
    if (typeof body.day !== "number" || !Number.isFinite(body.day)) {
      throw new HttpsError(
        "invalid-argument",
        `existingDays[${index}].day must be a number.`
      );
    }
    assertNonEmptyString(body.date, `existingDays[${index}].date`);
    if (!isIsoDate(body.date.trim())) {
      throw new HttpsError(
        "invalid-argument",
        `existingDays[${index}].date must be YYYY-MM-DD.`
      );
    }
    const placeTitles = Array.isArray(body.placeTitles)
      ? body.placeTitles
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    return {
      day: Math.floor(body.day),
      date: body.date.trim(),
      title:
        typeof body.title === "string" && body.title.trim()
          ? body.title.trim()
          : undefined,
      placeTitles,
    };
  });
}

function parseDestinations(value: unknown): PlanTripDestination[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const destinations: PlanTripDestination[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const body = row as Record<string, unknown>;
    if (typeof body.cityName !== "string" || !body.cityName.trim()) continue;
    if (typeof body.countryName !== "string" || !body.countryName.trim()) {
      continue;
    }
    destinations.push({
      cityName: body.cityName.trim(),
      countryName: body.countryName.trim(),
      ...(typeof body.countryId === "string" && body.countryId.trim()
        ? { countryId: body.countryId.trim().toLowerCase() }
        : {}),
      ...(typeof body.cityId === "string" && body.cityId.trim()
        ? { cityId: body.cityId.trim().toLowerCase() }
        : {}),
      ...(typeof body.lat === "number" && Number.isFinite(body.lat)
        ? { lat: body.lat }
        : {}),
      ...(typeof body.lon === "number" && Number.isFinite(body.lon)
        ? { lon: body.lon }
        : {}),
      ...(typeof body.startDate === "string" && isIsoDate(body.startDate.trim())
        ? { startDate: body.startDate.trim() }
        : {}),
      ...(typeof body.endDate === "string" && isIsoDate(body.endDate.trim())
        ? { endDate: body.endDate.trim() }
        : {}),
    });
  }
  return destinations.length > 0 ? destinations : undefined;
}

function parseSavedPlaces(value: unknown): PlanTripSavedPlace[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const places: PlanTripSavedPlace[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const body = row as Record<string, unknown>;
    if (typeof body.locationId !== "string" || !body.locationId.trim()) continue;
    if (typeof body.title !== "string" || !body.title.trim()) continue;
    const lat = body.lat;
    const lon = body.lon;
    if (typeof lat !== "number" || !Number.isFinite(lat)) continue;
    if (typeof lon !== "number" || !Number.isFinite(lon)) continue;
    places.push({
      locationId: body.locationId.trim(),
      title: body.title.trim(),
      lat,
      lon,
      cityName:
        typeof body.cityName === "string" ? body.cityName.trim() : "",
      countryName:
        typeof body.countryName === "string" ? body.countryName.trim() : "",
      ...(typeof body.cityId === "string" && body.cityId.trim()
        ? { cityId: body.cityId.trim() }
        : {}),
      ...(typeof body.countryId === "string" && body.countryId.trim()
        ? { countryId: body.countryId.trim() }
        : {}),
      status: typeof body.status === "string" ? body.status : "planned",
      ...(typeof body.category === "string" && body.category.trim()
        ? { category: body.category.trim() }
        : {}),
    });
  }
  return places.length > 0 ? places : undefined;
}

function parseWeather(value: unknown): PlanTripWeatherDay[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const days: PlanTripWeatherDay[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const body = row as Record<string, unknown>;
    if (typeof body.date !== "string" || !isIsoDate(body.date.trim())) continue;
    days.push({
      date: body.date.trim(),
      available: body.available === true,
      ...(typeof body.cityName === "string" && body.cityName.trim()
        ? { cityName: body.cityName.trim() }
        : {}),
      ...(typeof body.tempMin === "number" ? { tempMin: body.tempMin } : {}),
      ...(typeof body.tempMax === "number" ? { tempMax: body.tempMax } : {}),
      ...(typeof body.temp === "number" ? { temp: body.temp } : {}),
      ...(typeof body.description === "string" && body.description.trim()
        ? { description: body.description.trim() }
        : {}),
      ...(typeof body.icon === "string" && body.icon.trim()
        ? { icon: body.icon.trim() }
        : {}),
      ...(typeof body.humidity === "number" ? { humidity: body.humidity } : {}),
      ...(typeof body.precipitationChance === "number"
        ? { precipitationChance: body.precipitationChance }
        : {}),
      ...(typeof body.windSpeed === "number" ? { windSpeed: body.windSpeed } : {}),
      ...(body.units === "metric" || body.units === "imperial"
        ? { units: body.units }
        : {}),
    });
  }
  return days.length > 0 ? days : undefined;
}

function parseRequest(data: unknown): PlanTripRequest {
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request body is required.");
  }

  const body = data as Record<string, unknown>;
  assertNonEmptyString(body.tripId, "tripId");
  assertNonEmptyString(body.startDate, "startDate");
  assertNonEmptyString(body.endDate, "endDate");

  if (!isIsoDate(body.startDate.trim()) || !isIsoDate(body.endDate.trim())) {
    throw new HttpsError(
      "invalid-argument",
      "startDate and endDate must be YYYY-MM-DD."
    );
  }

  if (!isLeisureType(body.leisureType)) {
    throw new HttpsError(
      "invalid-argument",
      `leisureType must be one of: ${LEISURE_TYPES.join(", ")}.`
    );
  }

  const destRaw = body.destination;
  if (!destRaw || typeof destRaw !== "object") {
    throw new HttpsError("invalid-argument", "destination is required.");
  }
  const dest = destRaw as Record<string, unknown>;
  assertNonEmptyString(dest.cityName, "destination.cityName");
  assertNonEmptyString(dest.countryName, "destination.countryName");

  const countryName = dest.countryName.trim();
  const countryId =
    typeof dest.countryId === "string" && dest.countryId.trim()
      ? dest.countryId.trim().toLowerCase()
      : undefined;
  const cityId =
    typeof dest.cityId === "string" && dest.cityId.trim()
      ? dest.cityId.trim().toLowerCase()
      : undefined;
  const cityName = dest.cityName.trim();
  const extraDestinations = parseDestinations(body.destinations);
  const savedPlaces = parseSavedPlaces(body.savedPlaces);
  const weather = parseWeather(body.weather);

  const umrahDestinations = [
    { countryName, countryId, cityName, cityId },
    ...(extraDestinations ?? []).map((d) => ({
      countryName: d.countryName,
      countryId: d.countryId,
      cityName: d.cityName,
      cityId: d.cityId,
    })),
  ];
  if (
    body.leisureType === "umrah" &&
    !umrahDestinations.some((d) => isSaudiArabiaDestination(d))
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Umrah planner is only available for trips in Saudi Arabia."
    );
  }

  const lat =
    typeof dest.lat === "number" && Number.isFinite(dest.lat)
      ? dest.lat
      : undefined;
  const lon =
    typeof dest.lon === "number" && Number.isFinite(dest.lon)
      ? dest.lon
      : undefined;

  const mode: PlanTripMode =
    body.mode === "regenerate" ? "regenerate" : "generate";

  const currencyRaw =
    typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";
  const currency =
    currencyRaw && /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : undefined;

  return {
    tripId: body.tripId.trim(),
    destination: {
      cityName,
      countryName,
      ...(countryId ? { countryId } : {}),
      ...(cityId ? { cityId } : {}),
      lat,
      lon,
    },
    startDate: body.startDate.trim(),
    endDate: body.endDate.trim(),
    leisureType: body.leisureType,
    mode,
    language:
      typeof body.language === "string" && body.language.trim()
        ? body.language.trim()
        : undefined,
    ...(currency ? { currency } : {}),
    existingDays: parseExistingDays(body.existingDays),
    ...(extraDestinations ? { destinations: extraDestinations } : {}),
    ...(savedPlaces ? { savedPlaces } : {}),
    ...(weather ? { weather } : {}),
  };
}

async function loadTripCreateMode(
  uid: string,
  tripId: string
): Promise<"ordinary" | "advanced"> {
  const tripRef = adminDb().doc(`users/${uid}/tripPlanner/${tripId}`);
  const snap = await tripRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Trip not found.");
  }
  const trip = snap.data() ?? {};
  const ownerId = typeof trip.userId === "string" ? trip.userId : uid;
  if (ownerId !== uid) {
    throw new HttpsError("permission-denied", "You cannot plan this trip.");
  }
  return trip.createMode === "advanced" ? "advanced" : "ordinary";
}

const MAX_PLACES_PER_DAY = 4;

function defaultFreeDaySuggestion(
  empty: PlanTripExistingDay,
  leisureType: LeisureType
): PlannedDaySuggestion {
  if (leisureType === "umrah") {
    return {
      day: empty.day,
      date: empty.date,
      title: empty.title?.trim() || "Worship and rest",
      description:
        "Time for worship and rest. Extra sightseeing is optional and not required today.",
      places: [],
    };
  }
  if (leisureType === "relaxation") {
    return {
      day: empty.day,
      date: empty.date,
      title: empty.title?.trim() || "Free time",
      description:
        "Unstructured rest. A successful day can have no scheduled places.",
      places: [],
    };
  }
  return {
    day: empty.day,
    date: empty.date,
    title: empty.title?.trim() || "Open day",
    description:
      "Left open on purpose. Add a place only if it serves this trip's leisure type.",
    places: [],
  };
}

/**
 * Keep every empty itinerary day, including rest/worship days with 0 places.
 * Leisure type decides intensity — unused time is not treated as a failure.
 */
function filterToEmptyDays(
  suggestions: PlannedDaySuggestion[],
  emptyDays: PlanTripExistingDay[],
  leisureType: LeisureType
): PlannedDaySuggestion[] {
  const emptyDayNumbers = new Set(emptyDays.map((d) => d.day));
  const byDay = new Map<number, PlannedDaySuggestion>();
  for (const suggestion of suggestions) {
    if (!emptyDayNumbers.has(suggestion.day)) continue;
    byDay.set(suggestion.day, {
      ...suggestion,
      places: suggestion.places.slice(0, MAX_PLACES_PER_DAY),
    });
  }

  return emptyDays.map(
    (empty) =>
      byDay.get(empty.day) ?? defaultFreeDaySuggestion(empty, leisureType)
  );
}

function mapOpenAIError(err: unknown): HttpsError {
  const message =
    err instanceof Error ? err.message : "Trip planning failed.";

  if (/OPENAI_API_KEY/i.test(message)) {
    return new HttpsError(
      "failed-precondition",
      "OPENAI_API_KEY is not configured for Cloud Functions."
    );
  }

  if (/Invalid|missing|not an object|empty|no usable/i.test(message)) {
    return new HttpsError(
      "internal",
      "The trip planner model returned an invalid response. Please try again."
    );
  }

  return new HttpsError("internal", message);
}

export type PlanTripResponse = PlanTripResult | InsufficientAICreditsError;

/**
 * planTrip
 *
 * Pipeline:
 * 1. Authenticate caller
 * 2. Generate is included (no credit charge). Recreate charges
 *    ordinary 10 / advanced 30 BEFORE OpenAI
 * 3. Suggest an itinerary for empty days shaped by leisureType
 *    (purpose, intensity, free time). Saved places are options, not a quota.
 * 4. On success: deduct regenerate credits + record aiUsage
 * 5. On AI failure: do not deduct credits
 *
 * Persistence of locations / itinerary is done by the client after user confirms.
 */
export const planTrip = onCall(
  {
    region: DEFAULT_FUNCTIONS_REGION,
    secrets: [openaiApiKey],
    invoker: "public",
    cors: true,
    timeoutSeconds: 180,
    memory: "512MiB",
  },
  async (request): Promise<PlanTripResponse> => {
    initAdmin();
    const uid = requireAuth(request);
    const input = parseRequest(request.data);

    const emptyDays = input.existingDays.filter(
      (d) => d.placeTitles.length === 0
    );
    const occupiedDays = input.existingDays.filter(
      (d) => d.placeTitles.length > 0
    );

    if (emptyDays.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "All trip days already have places. Clear a day or extend dates first."
      );
    }

    const createMode = await loadTripCreateMode(uid, input.tripId);
    const chargeOperation =
      input.mode === "regenerate"
        ? planTripRegenerateOperation(createMode)
        : null;

    const emptyDaysKey = JSON.stringify(
      emptyDays.map((d) => ({ day: d.day, date: d.date }))
    );
    const occupiedDaysKey = JSON.stringify(
      occupiedDays.map((d) => ({
        day: d.day,
        date: d.date,
        titles: d.placeTitles,
      }))
    );
    const fingerprint = planTripFingerprint({
      cityName: input.destination.cityName,
      countryName: input.destination.countryName,
      leisureType: input.leisureType,
      language: input.language ?? "en",
      currency: input.currency ?? "USD",
      mode: input.mode ?? "generate",
      emptyDaysKey,
      occupiedDaysKey,
      lat: input.destination.lat,
      lon: input.destination.lon,
      savedPlacesKey: JSON.stringify(
        (input.savedPlaces ?? []).map((p) => p.locationId).sort()
      ),
      weatherKey: JSON.stringify(
        (input.weather ?? []).map((w) => ({
          date: w.date,
          available: w.available,
          temp: w.temp,
        }))
      ),
    });

    try {
      const cachedOrLive = await executeCachedAI<{
        days: PlannedDaySuggestion[];
        model: string;
      }>({
        functionName: "planTrip",
        fingerprint,
        operation: "planTrip",
        ttlMs: AI_CACHE_TTL.planTrip,
        // regenerate always needs a fresh plan; still dedupe in-flight.
        skipCache: input.mode === "regenerate",
        execute: async () => {
          if (chargeOperation) {
            const creditCheck = await assertSufficientCredits(
              uid,
              chargeOperation
            );
            if (!creditCheck.ok) {
              throw Object.assign(
                new Error("INSUFFICIENT_AI_CREDITS"),
                creditCheck.response
              );
            }
          }

          const analyzer = createOpenAITripPlanner();
          const { resultDays, metrics } = await analyzer.plan({
            cityName: input.destination.cityName,
            countryName: input.destination.countryName,
            lat: input.destination.lat,
            lon: input.destination.lon,
            leisureType: input.leisureType,
            language: input.language ?? "en",
            currency: input.currency ?? "USD",
            emptyDays,
            occupiedDays,
            destinations: input.destinations,
            savedPlaces: input.savedPlaces,
            weather: input.weather,
          });

          const days = filterToEmptyDays(
            resultDays,
            emptyDays,
            input.leisureType
          );

          if (days.length === 0) {
            throw new Error("Plan trip model returned no usable empty days.");
          }

          const dateByDay = new Map(emptyDays.map((d) => [d.day, d.date]));
          const normalizedDays = days.map((d) => ({
            ...d,
            date: dateByDay.get(d.day) ?? d.date,
          }));

          return {
            result: { days: normalizedDays, model: metrics.model },
            model: metrics.model,
            usage: metrics.usage,
            cost: metrics.cost,
          };
        },
      });

      let remainingCredits = 0;
      let creditsCharged = 0;
      if (cachedOrLive.billable && chargeOperation) {
        remainingCredits = await deductCredits(uid, chargeOperation);
        creditsCharged = getRequiredCredits(chargeOperation);
        await recordAIUsage({
          operation: chargeOperation,
          cost: cachedOrLive.cost,
          userId: uid,
        });
      } else {
        // Generate (free) or cache/dedupe hit — report balance without charging.
        const balanceCheck = await assertSufficientCredits(uid, "planTrip");
        remainingCredits = balanceCheck.ok
          ? balanceCheck.availableCredits
          : balanceCheck.response.availableCredits;
        if (cachedOrLive.billable) {
          await recordAIUsage({
            operation: "planTrip",
            cost: cachedOrLive.cost,
            userId: uid,
          });
        }
      }

      logger.info("planTrip success", {
        uid,
        tripId: input.tripId,
        leisureType: input.leisureType,
        mode: input.mode ?? "generate",
        emptyDayCount: emptyDays.length,
        filledDayCount: cachedOrLive.result.days.length,
        freeDayCount: cachedOrLive.result.days.filter(
          (d) => d.places.length === 0
        ).length,
        placeCount: cachedOrLive.result.days.reduce(
          (n, d) => n + d.places.length,
          0
        ),
        creditsCharged,
        outcome: cachedOrLive.outcome,
        billable: cachedOrLive.billable,
      });

      return {
        success: true,
        leisureType: input.leisureType,
        days: cachedOrLive.result.days,
        creditsCharged,
        remainingCredits,
        model: cachedOrLive.result.model,
      };
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "error" in err &&
        (err as { error: unknown }).error === "INSUFFICIENT_AI_CREDITS"
      ) {
        const response = err as InsufficientAICreditsError;
        logger.info("planTrip blocked: insufficient credits", {
          uid,
          operation: chargeOperation,
          requiredCredits: response.requiredCredits,
          availableCredits: response.availableCredits,
        });
        return response;
      }

      logger.error("planTrip failed", {
        uid,
        tripId: input.tripId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw mapOpenAIError(err);
    }
  }
);
