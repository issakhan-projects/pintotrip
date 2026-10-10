/**
 * Persisted on users/{uid}/tripPlanner/{tripId}.aiPlan
 * Written by planTrip (queue) + onTripAiPlanQueued (run / ready / error).
 */

import type {
  TemperatureType,
  TripPlannerAiResponseDay,
} from "./ai/tripPlannerAiTypes";

export type TripAiPlanStatus = "queued" | "running" | "ready" | "error";

export type TripAiPlanMode = "generate" | "regenerate";

export type TripAiPlanBase = {
  mode: TripAiPlanMode;
  language?: string;
  temperatureType?: TemperatureType;
  requestedAt: number;
  startedAt?: number;
  completedAt?: number;
};

export type TripAiPlanQueued = TripAiPlanBase & {
  status: "queued";
};

export type TripAiPlanRunning = TripAiPlanBase & {
  status: "running";
  startedAt: number;
};

export type TripAiPlanReady = TripAiPlanBase & {
  status: "ready";
  startedAt: number;
  completedAt: number;
  itinerary: TripPlannerAiResponseDay[];
  model: string;
  stages: string[];
  creditsCharged: number;
  remainingCredits: number;
  warning?: string;
};

export type TripAiPlanError = TripAiPlanBase & {
  status: "error";
  startedAt?: number;
  completedAt: number;
  error: string;
};

export type TripAiPlan =
  | TripAiPlanQueued
  | TripAiPlanRunning
  | TripAiPlanReady
  | TripAiPlanError;

/** Returned by planTrip when another job is already queued/running. */
export type PlanTripInProgressError = {
  success: false;
  error: "PLAN_TRIP_IN_PROGRESS";
  message: string;
  status: "queued" | "running";
};

/** Returned by planTrip when a ready result still awaits review. */
export type PlanTripReadyPendingError = {
  success: false;
  error: "PLAN_TRIP_READY_PENDING";
  message: string;
};

export type PlanTripBlockedError =
  | PlanTripInProgressError
  | PlanTripReadyPendingError;

export function isPlanTripBlockedError(
  value: unknown
): value is PlanTripBlockedError {
  if (typeof value !== "object" || value === null) return false;
  if ((value as { success?: unknown }).success !== false) return false;
  const code = (value as { error?: unknown }).error;
  return (
    code === "PLAN_TRIP_IN_PROGRESS" || code === "PLAN_TRIP_READY_PENDING"
  );
}
