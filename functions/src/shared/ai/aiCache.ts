import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { adminDb } from "../admin";
import { AI_CACHE_VERSION } from "./aiFingerprint";

const COLLECTION = "aiCache";

export type AICacheScope =
  | "findPlace"
  | "getCityIntelligence"
  | "getCityIntelligenceSlow"
  | "planTrip"
  | "resolveCityAirports";

export interface AICacheEntry<T = unknown> {
  fingerprint: string;
  operation: AICacheScope;
  version: number;
  result: T;
  createdAt: FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
}

function cacheRef(fingerprint: string) {
  return adminDb().doc(`${COLLECTION}/${fingerprint}`);
}

export async function getAICache<T>(
  fingerprint: string
): Promise<AICacheEntry<T> | null> {
  try {
    const snap = await cacheRef(fingerprint).get();
    if (!snap.exists) return null;
    const data = snap.data() as AICacheEntry<T>;
    if (data.version !== AI_CACHE_VERSION) return null;
    const expiresAt = data.expiresAt;
    if (
      expiresAt &&
      typeof expiresAt.toMillis === "function" &&
      expiresAt.toMillis() < Date.now()
    ) {
      return null;
    }
    if (data.result === undefined) return null;
    return data;
  } catch (err) {
    logger.warn("aiCache get failed", {
      fingerprint: fingerprint.slice(0, 12),
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function setAICache<T>(params: {
  fingerprint: string;
  operation: AICacheScope;
  result: T;
  ttlMs: number;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
}): Promise<void> {
  const now = Date.now();
  const expiresAt = Timestamp.fromMillis(now + params.ttlMs);
  try {
    await cacheRef(params.fingerprint).set(
      {
        fingerprint: params.fingerprint,
        operation: params.operation,
        version: AI_CACHE_VERSION,
        result: params.result,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt,
        ...(params.model ? { model: params.model } : {}),
        ...(typeof params.promptTokens === "number"
          ? { promptTokens: params.promptTokens }
          : {}),
        ...(typeof params.completionTokens === "number"
          ? { completionTokens: params.completionTokens }
          : {}),
        ...(typeof params.cost === "number" ? { cost: params.cost } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    logger.warn("aiCache set failed", {
      fingerprint: params.fingerprint.slice(0, 12),
      operation: params.operation,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** TTL helpers */
export const AI_CACHE_TTL = {
  /** Place ID for a given image/link is stable. */
  findPlace: 30 * 24 * 60 * 60 * 1000,
  /** Full city intel including visa / FX (refresh weekly). */
  cityIntelligenceFull: 7 * 24 * 60 * 60 * 1000,
  /** Climate / transport / apps change slowly. */
  cityIntelligenceSlow: 30 * 24 * 60 * 60 * 1000,
  /**
   * planTrip is intentional generation — short dedupe window only
   * (covers double-submit), not long-term reuse.
   */
  planTrip: 5 * 60 * 1000,
  /** City → primary airport mapping is stable. */
  resolveCityAirports: 30 * 24 * 60 * 60 * 1000,
} as const;
