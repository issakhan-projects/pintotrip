import { HttpsError, type CallableRequest } from "firebase-functions/https";

export function requireAuth<T>(request: CallableRequest<T>): string {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError(
      "unauthenticated",
      "Authentication is required to call this function."
    );
  }
  return uid;
}

export function assertNonEmptyString(
  value: unknown,
  field: string
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpsError(
      "invalid-argument",
      `Expected non-empty string for "${field}".`
    );
  }
}
