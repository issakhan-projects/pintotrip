/**
 * planTrip — build TripPlannerAiRequest server-side, AI-fill missing routes +
 * places, return TripPlannerAiResponse itinerary to the client.
 *
 * Client sends only: tripId, language?, temperatureType?
 */

import { onCall, HttpsError } from "firebase-functions/https";
import { logger } from "firebase-functions";
import { requireAuth, assertNonEmptyString } from "../shared/auth";
import {
  DEFAULT_FUNCTIONS_REGION,
  openaiApiKey,
  openWeatherMapApiKey,
} from "../shared/config";
import {
  completeTripPlannerAiJson,
} from "../shared/openai";
import { recordAIUsage } from "../shared/aiUsage";
import {
  assertSufficientCredits,
  deductCredits,
} from "../shared/creditService";
import {
  getRequiredCredits,
  planTripOperation,
  planTripRegenerateOperation,
  type InsufficientAICreditsError,
} from "../shared/credits";
import { initAdmin } from "../shared/admin";
import { loadAndBuildTripPlannerAiRequest } from "./buildTripPlannerAiRequest";
import {
  applyFreeTimePlacesFromRoutes,
  seedTripPlannerAiItineraryExistingOnly,
} from "./ai/seedAndFreeTime";
import {
  buildFillRoutesPayload,
  mergeAiRoutesIntoItinerary,
  stripHomeLocalTransfers,
} from "./ai/fillRoutesAi";
import {
  buildFillPlacesPayload,
  extractJsonObject,
  mergeAiPlacesIntoItinerary,
} from "./ai/fillPlacesAi";
import type {
  PlanTripAiCallableRequest,
  PlanTripAiCallableResult,
  TemperatureType,
  TripPlannerAiResponseDay,
} from "./ai/tripPlannerAiTypes";

const ROUTES_MAX_TOKENS = 8_000;
const PLACES_MAX_TOKENS = 12_000;

function parseRequest(data: unknown): PlanTripAiCallableRequest {
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request body is required.");
  }
  const body = data as Record<string, unknown>;
  assertNonEmptyString(body.tripId, "tripId");

  let temperatureType: TemperatureType = "celsius";
  const rawTemp =
    typeof body.temperatureType === "string"
      ? body.temperatureType.trim().toLowerCase()
      : typeof body.temperatureUnit === "string"
        ? body.temperatureUnit.trim().toLowerCase()
        : "";
  if (rawTemp === "fahrenheit" || rawTemp === "imperial") {
    temperatureType = "fahrenheit";
  } else if (rawTemp === "celsius" || rawTemp === "metric" || !rawTemp) {
    temperatureType = "celsius";
  } else {
    throw new HttpsError(
      "invalid-argument",
      "temperatureType must be celsius or fahrenheit."
    );
  }

  return {
    tripId: body.tripId.trim(),
    temperatureType,
    language:
      typeof body.language === "string" && body.language.trim()
        ? body.language.trim()
        : undefined,
    mode: body.mode === "regenerate" ? "regenerate" : "generate",
  };
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

  return new HttpsError("internal", message);
}

export type PlanTripResponse =
  | PlanTripAiCallableResult
  | InsufficientAICreditsError;

/**
 * planTrip
 *
 * Pipeline:
 * 1. Auth; accept tripId + language + temperatureType + mode
 * 2. Load trip/routes/places/weather → TripPlannerAiRequest
 * 3. Charge AI credits from users/{uid}.aiCreditsBalance BEFORE OpenAI:
 *    generate: ordinary 50 / advanced 100
 *    regenerate: ordinary 25 / advanced 50
 * 4. Seed existing routes only
 * 5. AI fill missing routes
 * 6. Deterministic freeTime + saved locationId refs
 * 7. AI fill places + non-flight fares (soft-fail → return routes)
 * 8. Deduct credits on success; return itinerary
 */
export const planTrip = onCall(
  {
    region: DEFAULT_FUNCTIONS_REGION,
    secrets: [openaiApiKey, openWeatherMapApiKey],
    invoker: "public",
    cors: true,
    timeoutSeconds: 180,
    memory: "512MiB",
  },
  async (request): Promise<PlanTripResponse> => {
    initAdmin();
    const uid = requireAuth(request);
    const input = parseRequest(request.data);
    const language = input.language ?? "en";
    const temperatureType = input.temperatureType ?? "celsius";
    const mode = input.mode ?? "generate";

    logger.info("planTrip request", {
      uid,
      tripId: input.tripId,
      language,
      temperatureType,
      mode,
    });

    const loaded = await loadAndBuildTripPlannerAiRequest({
      uid,
      tripId: input.tripId,
      temperatureType,
    });
    const aiRequest = loaded.request;

    const chargeOperation =
      mode === "regenerate"
        ? planTripRegenerateOperation(loaded.createMode)
        : planTripOperation(loaded.createMode);

    const creditCheck = await assertSufficientCredits(uid, chargeOperation);
    if (!creditCheck.ok) {
      logger.info("planTrip blocked: insufficient credits", {
        uid,
        tripId: input.tripId,
        operation: chargeOperation,
        requiredCredits: creditCheck.response.requiredCredits,
        availableCredits: creditCheck.response.availableCredits,
        createMode: loaded.createMode,
        mode,
      });
      return creditCheck.response;
    }

    logger.info("planTrip TripPlannerAiRequest", {
      uid,
      tripId: input.tripId,
      createMode: loaded.createMode,
      spendMoney: aiRequest.trip.spendMoney,
      chargeOperation,
      requiredCredits: creditCheck.requiredCredits,
      availableCredits: creditCheck.availableCredits,
      requestJson: JSON.stringify(aiRequest),
    });

    const skeleton = seedTripPlannerAiItineraryExistingOnly(
      aiRequest,
      loaded.routes
    );

    const stages: string[] = [];
    let model = "unknown";
    let totalCost = 0;
    let withRoutes: TripPlannerAiResponseDay[] = skeleton.itinerary;
    let warning: string | undefined;

    // --- Pass 1: AI missing routes ---
    try {
      const { system, user } = buildFillRoutesPayload(
        aiRequest,
        skeleton.itinerary,
        language
      );
      const routesResult = await completeTripPlannerAiJson({
        system,
        user,
        maxCompletionTokens: ROUTES_MAX_TOKENS,
        reasoningEffort: "low",
      });
      model = routesResult.metrics.model;
      totalCost += routesResult.metrics.cost;
      const parsed = extractJsonObject(routesResult.text);
      withRoutes = stripHomeLocalTransfers(
        mergeAiRoutesIntoItinerary(skeleton.itinerary, parsed),
        aiRequest.destinations
      );
      stages.push("routes");
    } catch (err) {
      logger.error("planTrip route fill failed", {
        uid,
        tripId: input.tripId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw mapOpenAIError(err);
    }

    const withFreeTime = applyFreeTimePlacesFromRoutes(aiRequest, withRoutes);

    const hasSlots = withFreeTime.some(
      (day) => Array.isArray(day.places) && day.places.length > 0
    );
    const hasNonFlight = withFreeTime.some((day) =>
      (day.routes ?? []).some((r) => r.transport !== "flight")
    );

    let itinerary = withFreeTime;

    // --- Pass 2: AI places + non-flight fares ---
    if (hasSlots || hasNonFlight) {
      try {
        const { system, user } = buildFillPlacesPayload(
          aiRequest,
          withFreeTime,
          language
        );
        const placesResult = await completeTripPlannerAiJson({
          system,
          user,
          maxCompletionTokens: PLACES_MAX_TOKENS,
          reasoningEffort: "low",
        });
        model = placesResult.metrics.model;
        totalCost += placesResult.metrics.cost;
        const parsed = extractJsonObject(placesResult.text);
        itinerary = mergeAiPlacesIntoItinerary(
          withFreeTime,
          parsed,
          aiRequest.destinations
        );
        stages.push("places");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn("planTrip place fill skipped", {
          uid,
          tripId: input.tripId,
          error: message,
        });
        warning = `Place fill skipped: ${message}`;
        itinerary = withFreeTime;
      }
    }

    // Deduct user AI credits only after a successful plan response.
    const remainingCredits = await deductCredits(uid, chargeOperation);
    const creditsCharged = getRequiredCredits(chargeOperation);

    if (totalCost > 0) {
      await recordAIUsage({
        operation: chargeOperation,
        cost: totalCost,
        userId: uid,
      });
    }

    const response: PlanTripAiCallableResult = {
      success: true,
      itinerary,
      model,
      creditsCharged,
      remainingCredits,
      stages,
      ...(warning ? { warning } : {}),
      request: aiRequest,
    };

    logger.info("planTrip Trip Planner AI Response", {
      uid,
      tripId: input.tripId,
      model,
      stages,
      mode,
      createMode: loaded.createMode,
      chargeOperation,
      creditsCharged,
      remainingCredits,
      warning: warning ?? null,
      routeCount: itinerary.reduce((n, d) => n + d.routes.length, 0),
      placeCount: itinerary.reduce(
        (n, d) =>
          n + d.places.reduce((m, s) => m + (s.places?.length ?? 0), 0),
        0
      ),
      responseJson: JSON.stringify(response),
    });

    return response;
  }
);
