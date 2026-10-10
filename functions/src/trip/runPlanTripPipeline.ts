/**
 * Shared planTrip AI pipeline — used by the async Firestore worker.
 * Charges credits only after a successful itinerary is produced.
 */

import { logger } from "firebase-functions";
import { HttpsError } from "firebase-functions/https";
import { completeTripPlannerAiJson } from "../shared/openai";
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
import { enrichItineraryPlaceCoordinates } from "./ai/enrichPlaceCoordinates";
import { enrichItineraryPlacePrices } from "./ai/enrichPlacePrices";
import { assignSharedItineraryOrders } from "./ai/assignSharedOrders";
import { assignPlaceVisitTimes } from "./ai/assignPlaceVisitTimes";
import type {
  PlanTripAiCallableRequest,
  PlanTripAiCallableResult,
  TemperatureType,
  TripPlannerAiResponseDay,
} from "./ai/tripPlannerAiTypes";

const ROUTES_MAX_TOKENS = 8_000;
const PLACES_MAX_TOKENS = 12_000;

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

export type RunPlanTripPipelineResult =
  | PlanTripAiCallableResult
  | InsufficientAICreditsError;

/**
 * Full planTrip pipeline (routes → places → coords → prices → credits).
 */
export async function runPlanTripPipeline(params: {
  uid: string;
  tripId: string;
  language?: string;
  temperatureType?: TemperatureType;
  mode?: "generate" | "regenerate";
}): Promise<RunPlanTripPipelineResult> {
  const language = params.language ?? "en";
  const temperatureType = params.temperatureType ?? "celsius";
  const mode = params.mode ?? "generate";
  const { uid, tripId } = params;

  logger.info("planTrip pipeline start", {
    uid,
    tripId,
    language,
    temperatureType,
    mode,
  });

  const loaded = await loadAndBuildTripPlannerAiRequest({
    uid,
    tripId,
    temperatureType,
  });
  const aiRequest = loaded.request;

  const chargeOperation =
    mode === "regenerate"
      ? planTripRegenerateOperation(loaded.createMode)
      : planTripOperation(loaded.createMode);

  const creditCheck = await assertSufficientCredits(uid, chargeOperation);
  if (!creditCheck.ok) {
    logger.info("planTrip pipeline blocked: insufficient credits", {
      uid,
      tripId,
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
    tripId,
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
      tripId,
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
      if (
        itinerary.some((day) =>
          (day.places ?? []).some((s) => (s.whereToEat?.length ?? 0) > 0)
        )
      ) {
        stages.push("whereToEat");
      }

      try {
        itinerary = await enrichItineraryPlaceCoordinates(
          itinerary,
          aiRequest.destinations
        );
        stages.push("placeCoords");
      } catch (enrichErr) {
        logger.warn("planTrip place coordinate enrichment skipped", {
          uid,
          tripId,
          error:
            enrichErr instanceof Error
              ? enrichErr.message
              : String(enrichErr),
        });
      }

      try {
        const priced = await enrichItineraryPlacePrices(
          itinerary,
          aiRequest.destinations,
          aiRequest.trip.currency
        );
        itinerary = priced.itinerary;
        if (priced.metrics) {
          totalCost += priced.metrics.cost;
          model = priced.metrics.model;
        }
        if (priced.stats.cacheHits > 0 || priced.stats.webLookups > 0) {
          stages.push("placePrices");
        }
      } catch (priceErr) {
        logger.warn("planTrip place price enrichment skipped", {
          uid,
          tripId,
          error:
            priceErr instanceof Error ? priceErr.message : String(priceErr),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("planTrip place fill skipped", {
        uid,
        tripId,
        error: message,
      });
      warning = `Place fill skipped: ${message}`;
      itinerary = withFreeTime;
    }
  }

  itinerary = assignSharedItineraryOrders(itinerary);
  stages.push("orders");

  itinerary = assignPlaceVisitTimes(itinerary);
  stages.push("visitTimes");

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

  logger.info("planTrip pipeline complete", {
    uid,
    tripId,
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
    whereToEatCount: itinerary.reduce(
      (n, d) =>
        n + d.places.reduce((m, s) => m + (s.whereToEat?.length ?? 0), 0),
      0
    ),
    mealType: aiRequest.trip.mealType ?? "default",
  });

  return response;
}

export type { PlanTripAiCallableRequest };
