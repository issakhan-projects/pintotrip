/**
 * Firestore trigger: trip.aiPlan.status → "queued"
 * → claim as "running" → run planTrip pipeline → write ready/error + notification.
 */

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import {
  DEFAULT_FUNCTIONS_REGION,
  googlePrivateApiKey,
  openaiApiKey,
  openWeatherMapApiKey,
} from "../shared/config";
import { initAdmin, adminDb } from "../shared/admin";
import { isInsufficientAICreditsError } from "../shared/credits";
import { sendPushToUser } from "../shared/pushNotifications";
import { runPlanTripPipeline } from "./runPlanTripPipeline";
import type {
  TripAiPlan,
  TripAiPlanError,
  TripAiPlanQueued,
  TripAiPlanReady,
  TripAiPlanRunning,
} from "./aiPlanTypes";

function asAiPlan(value: unknown): TripAiPlan | null {
  if (!value || typeof value !== "object") return null;
  const status = (value as { status?: unknown }).status;
  if (
    status !== "queued" &&
    status !== "running" &&
    status !== "ready" &&
    status !== "error"
  ) {
    return null;
  }
  return value as TripAiPlan;
}

function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function writeInboxNotification(params: {
  uid: string;
  tripId: string;
  tripName: string;
  kind: "ready" | "error";
  errorMessage?: string;
}): Promise<void> {
  const { uid, tripId, tripName, kind, errorMessage } = params;
  const title =
    kind === "ready"
      ? "Your trip plan is ready"
      : "Trip planning failed";
  const body =
    kind === "ready"
      ? `AI finished planning “${tripName}”. Open the trip to review and save.`
      : `We couldn’t finish planning “${tripName}”.${
          errorMessage ? ` ${errorMessage}` : ""
        }`;

  const type = kind === "ready" ? "plan_trip_ready" : "plan_trip_error";
  const link = `/trip-planner/${tripId}`;

  try {
    await adminDb()
      .collection(`users/${uid}/notifications`)
      .add({
        type,
        title,
        body,
        link,
        read: false,
        createdAt: Date.now(),
      });
  } catch (err) {
    logger.warn("onTripAiPlanQueued: notification write failed", {
      uid,
      tripId,
      kind,
      err,
    });
  }

  // OS / mobile-style system notification (FCM web push).
  await sendPushToUser(uid, { title, body, link, type });
}

/**
 * onTripAiPlanQueued
 * Async planTrip worker after callable queues aiPlan.status = "queued".
 */
export const onTripAiPlanQueued = onDocumentUpdated(
  {
    document: "users/{userId}/tripPlanner/{tripId}",
    region: DEFAULT_FUNCTIONS_REGION,
    secrets: [openaiApiKey, openWeatherMapApiKey, googlePrivateApiKey],
    memory: "512MiB",
    timeoutSeconds: 300,
  },
  async (event) => {
    initAdmin();

    const userId = event.params.userId as string;
    const tripId = event.params.tripId as string;
    const before = asAiPlan(event.data?.before.data()?.aiPlan);
    const after = asAiPlan(event.data?.after.data()?.aiPlan);

    if (!after || after.status !== "queued") return;
    if (before?.status === "queued") return;

    const tripRef = adminDb().doc(
      `users/${userId}/tripPlanner/${tripId}`
    );
    const tripName =
      typeof event.data?.after.data()?.name === "string"
        ? (event.data.after.data()!.name as string).trim() || "your trip"
        : "your trip";

    const queued = after as TripAiPlanQueued;
    const startedAt = Date.now();

    const claimed = await adminDb().runTransaction(async (tx) => {
      const snap = await tx.get(tripRef);
      if (!snap.exists) return false;
      const current = asAiPlan(snap.data()?.aiPlan);
      if (!current || current.status !== "queued") return false;

      const running: TripAiPlanRunning = {
        ...queued,
        status: "running",
        startedAt,
      };
      tx.update(tripRef, {
        aiPlan: running,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });

    if (!claimed) {
      logger.info("onTripAiPlanQueued: skip — not queued anymore", {
        userId,
        tripId,
      });
      return;
    }

    logger.info("onTripAiPlanQueued: running pipeline", {
      userId,
      tripId,
      mode: queued.mode,
    });

    try {
      const result = await runPlanTripPipeline({
        uid: userId,
        tripId,
        language: queued.language,
        temperatureType: queued.temperatureType,
        mode: queued.mode,
      });

      if (isInsufficientAICreditsError(result)) {
        const failed: TripAiPlanError = {
          status: "error",
          mode: queued.mode,
          language: queued.language,
          temperatureType: queued.temperatureType,
          requestedAt: queued.requestedAt,
          startedAt,
          completedAt: Date.now(),
          error: result.message,
        };
        await tripRef.update({
          aiPlan: failed,
          updatedAt: FieldValue.serverTimestamp(),
        });
        await writeInboxNotification({
          uid: userId,
          tripId,
          tripName,
          kind: "error",
          errorMessage: result.message,
        });
        return;
      }

      const ready: TripAiPlanReady = stripUndefined({
        status: "ready" as const,
        mode: queued.mode,
        language: queued.language,
        temperatureType: queued.temperatureType,
        requestedAt: queued.requestedAt,
        startedAt,
        completedAt: Date.now(),
        itinerary: result.itinerary,
        model: result.model,
        stages: result.stages,
        creditsCharged: result.creditsCharged,
        remainingCredits: result.remainingCredits,
        ...(result.warning ? { warning: result.warning } : {}),
      });

      await tripRef.update({
        aiPlan: ready,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await writeInboxNotification({
        uid: userId,
        tripId,
        tripName,
        kind: "ready",
      });

      logger.info("onTripAiPlanQueued: ready", {
        userId,
        tripId,
        model: result.model,
        stages: result.stages,
        creditsCharged: result.creditsCharged,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Trip planning failed.";
      logger.error("onTripAiPlanQueued: pipeline failed", {
        userId,
        tripId,
        error: message,
      });

      const failed: TripAiPlanError = {
        status: "error",
        mode: queued.mode,
        language: queued.language,
        temperatureType: queued.temperatureType,
        requestedAt: queued.requestedAt,
        startedAt,
        completedAt: Date.now(),
        error: message,
      };

      try {
        await tripRef.update({
          aiPlan: failed,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } catch (writeErr) {
        logger.error("onTripAiPlanQueued: failed to write error status", {
          userId,
          tripId,
          writeErr,
        });
      }

      await writeInboxNotification({
        uid: userId,
        tripId,
        tripName,
        kind: "error",
        errorMessage: message,
      });
    }
  }
);
