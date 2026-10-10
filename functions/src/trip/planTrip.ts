/**
 * planTrip — enqueue async AI itinerary generation.
 *
 * Client sends only: tripId, language?, temperatureType?, mode?
 * Callable returns immediately after queueing; the heavy pipeline runs in
 * onTripAiPlanQueued and writes results to trip.aiPlan + an inbox notification.
 */

import { onCall, HttpsError } from "firebase-functions/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { requireAuth, assertNonEmptyString } from "../shared/auth";
import { DEFAULT_FUNCTIONS_REGION } from "../shared/config";
import {
  assertSufficientCredits,
} from "../shared/creditService";
import {
  planTripOperation,
  planTripRegenerateOperation,
  type InsufficientAICreditsError,
} from "../shared/credits";
import { initAdmin, adminDb } from "../shared/admin";
import type {
  PlanTripAiCallableRequest,
  TemperatureType,
} from "./ai/tripPlannerAiTypes";
import type {
  PlanTripBlockedError,
  TripAiPlanQueued,
} from "./aiPlanTypes";

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

export type PlanTripAsyncAccepted = {
  success: true;
  async: true;
  status: "queued" | "running";
};

export type PlanTripResponse =
  | PlanTripAsyncAccepted
  | PlanTripBlockedError
  | InsufficientAICreditsError;

/**
 * planTrip
 *
 * 1. Auth; accept tripId + language + temperatureType + mode
 * 2. Load trip createMode; assert AI credits
 * 3. Write trip.aiPlan = { status: "queued", ... }
 * 4. Return immediately — onTripAiPlanQueued runs the pipeline
 */
export const planTrip = onCall(
  {
    region: DEFAULT_FUNCTIONS_REGION,
    invoker: "public",
    cors: true,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (request): Promise<PlanTripResponse> => {
    initAdmin();
    const uid = requireAuth(request);
    const input = parseRequest(request.data);
    const language = input.language ?? "en";
    const temperatureType = input.temperatureType ?? "celsius";
    const mode = input.mode ?? "generate";

    logger.info("planTrip enqueue request", {
      uid,
      tripId: input.tripId,
      language,
      temperatureType,
      mode,
    });

    const tripRef = adminDb().doc(
      `users/${uid}/tripPlanner/${input.tripId}`
    );
    const tripSnap = await tripRef.get();
    if (!tripSnap.exists) {
      throw new HttpsError("not-found", "Trip not found.");
    }

    const tripData = tripSnap.data() ?? {};
    const createMode =
      tripData.createMode === "advanced" ? "advanced" : "ordinary";

    const existing = tripData.aiPlan as
      | { status?: string }
      | undefined;
    if (
      existing?.status === "queued" ||
      existing?.status === "running"
    ) {
      logger.info("planTrip blocked: already in progress", {
        uid,
        tripId: input.tripId,
        status: existing.status,
      });
      return {
        success: false,
        error: "PLAN_TRIP_IN_PROGRESS",
        message:
          "A trip plan is already being generated. Please wait until it finishes, then try again.",
        status: existing.status as "queued" | "running",
      };
    }
    if (existing?.status === "ready") {
      logger.info("planTrip blocked: ready plan pending review", {
        uid,
        tripId: input.tripId,
      });
      return {
        success: false,
        error: "PLAN_TRIP_READY_PENDING",
        message:
          "An AI itinerary is ready for review. Review or dismiss it before generating again.",
      };
    }

    const chargeOperation =
      mode === "regenerate"
        ? planTripRegenerateOperation(createMode)
        : planTripOperation(createMode);

    const creditCheck = await assertSufficientCredits(uid, chargeOperation);
    if (!creditCheck.ok) {
      logger.info("planTrip blocked: insufficient credits", {
        uid,
        tripId: input.tripId,
        operation: chargeOperation,
        requiredCredits: creditCheck.response.requiredCredits,
        availableCredits: creditCheck.response.availableCredits,
        createMode,
        mode,
      });
      return creditCheck.response;
    }

    const aiPlan: TripAiPlanQueued = {
      status: "queued",
      mode,
      language,
      temperatureType,
      requestedAt: Date.now(),
    };

    await tripRef.update({
      aiPlan,
      updatedAt: FieldValue.serverTimestamp(),
    });

    logger.info("planTrip queued", {
      uid,
      tripId: input.tripId,
      mode,
      chargeOperation,
      requiredCredits: creditCheck.requiredCredits,
    });

    return {
      success: true,
      async: true,
      status: "queued",
    };
  }
);
