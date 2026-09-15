import { onCall, HttpsError } from "firebase-functions/https";
import { logger } from "firebase-functions";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, assertNonEmptyString } from "../shared/auth";
import { DEFAULT_FUNCTIONS_REGION } from "../shared/config";
import { initAdmin, adminDb } from "../shared/admin";
import {
  getRequiredCredits,
  type InsufficientAICreditsError,
} from "../shared/credits";
import {
  assertSufficientCredits,
  deductCredits,
} from "../shared/creditService";

type CreateTripMode = "ordinary" | "advanced";

export type ChargeCreateTripRequest = {
  tripId: string;
  mode: CreateTripMode;
};

export type ChargeCreateTripResult = {
  success: true;
  creditsCharged: number;
  remainingCredits: number;
};

function parseRequest(data: unknown): ChargeCreateTripRequest {
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request body is required.");
  }
  const body = data as Record<string, unknown>;
  assertNonEmptyString(body.tripId, "tripId");
  const mode = body.mode;
  if (mode !== "ordinary" && mode !== "advanced") {
    throw new HttpsError(
      "invalid-argument",
      "mode must be ordinary or advanced."
    );
  }
  return { tripId: body.tripId.trim(), mode };
}

function operationForMode(mode: CreateTripMode) {
  return mode === "advanced" ? "createTripAdvanced" : "createTripOrdinary";
}

/**
 * Deduct Create Trip credits after the client writes the trip doc.
 * Idempotent per trip via createCreditsCharged.
 */
export const chargeCreateTrip = onCall(
  {
    region: DEFAULT_FUNCTIONS_REGION,
    invoker: "public",
    cors: true,
  },
  async (request): Promise<ChargeCreateTripResult | InsufficientAICreditsError> => {
    initAdmin();
    const uid = requireAuth(request);
    const input = parseRequest(request.data);
    const operation = operationForMode(input.mode);
    const requiredCredits = getRequiredCredits(operation);

    const tripRef = adminDb().doc(`users/${uid}/tripPlanner/${input.tripId}`);
    const tripSnap = await tripRef.get();
    if (!tripSnap.exists) {
      throw new HttpsError("not-found", "Trip not found.");
    }

    const trip = tripSnap.data() ?? {};
    const ownerId = typeof trip.userId === "string" ? trip.userId : uid;
    if (ownerId !== uid) {
      throw new HttpsError(
        "permission-denied",
        "You cannot charge credits for this trip."
      );
    }

    if (trip.createCreditsCharged === true) {
      const balanceCheck = await assertSufficientCredits(uid, operation);
      const remainingCredits = balanceCheck.ok
        ? balanceCheck.availableCredits
        : balanceCheck.response.availableCredits;
      logger.info("chargeCreateTrip already billed", {
        uid,
        tripId: input.tripId,
        remainingCredits,
      });
      return {
        success: true,
        creditsCharged: 0,
        remainingCredits,
      };
    }

    const creditCheck = await assertSufficientCredits(uid, operation);
    if (!creditCheck.ok) {
      logger.info("chargeCreateTrip blocked: insufficient credits", {
        uid,
        operation,
        requiredCredits: creditCheck.response.requiredCredits,
        availableCredits: creditCheck.response.availableCredits,
      });
      return creditCheck.response;
    }

    const remainingCredits = await deductCredits(uid, operation);
    await tripRef.update({
      createCreditsCharged: true,
      updatedAt: FieldValue.serverTimestamp(),
    });

    logger.info("chargeCreateTrip success", {
      uid,
      tripId: input.tripId,
      operation,
      creditsCharged: requiredCredits,
      remainingCredits,
    });

    return {
      success: true,
      creditsCharged: requiredCredits,
      remainingCredits,
    };
  }
);
