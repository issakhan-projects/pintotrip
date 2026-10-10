/**
 * planTrip callable blocked responses (async job already active / pending).
 */

export type PlanTripInProgressError = {
  success: false;
  error: "PLAN_TRIP_IN_PROGRESS";
  message: string;
  status: "queued" | "running";
};

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

export function formatPlanTripBlockedMessage(
  err: PlanTripBlockedError
): string {
  return err.message;
}
