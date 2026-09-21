import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { adminDb } from "./admin";
import {
  getRequiredCredits,
  type AICreditOperation,
  type InsufficientAICreditsError,
} from "./credits";

function userRef(userId: string) {
  return adminDb().doc(`users/${userId}`);
}

function readBalance(data: FirebaseFirestore.DocumentData | undefined): number {
  const raw = data?.aiCreditsBalance;
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

export function buildInsufficientCreditsError(
  requiredCredits: number,
  availableCredits: number
): InsufficientAICreditsError {
  return {
    success: false,
    error: "INSUFFICIENT_AI_CREDITS",
    message: "Not enough AI credits",
    requiredCredits,
    availableCredits,
  };
}

/**
 * Read balance and validate BEFORE any OpenAI / AI call.
 * Does not deduct.
 */
export async function assertSufficientCredits(
  userId: string,
  operation: AICreditOperation
): Promise<
  | { ok: true; requiredCredits: number; availableCredits: number }
  | { ok: false; response: InsufficientAICreditsError }
> {
  return assertSufficientCreditUnits(userId, operation, 1);
}

/** Pre-check balance for N units of an operation (e.g. multi-city intelligence). */
export async function assertSufficientCreditUnits(
  userId: string,
  operation: AICreditOperation,
  units: number
): Promise<
  | { ok: true; requiredCredits: number; availableCredits: number }
  | { ok: false; response: InsufficientAICreditsError }
> {
  const requiredCredits =
    getRequiredCredits(operation) * Math.max(1, Math.floor(units));
  const snap = await userRef(userId).get();
  const availableCredits = readBalance(snap.data());

  if (availableCredits < requiredCredits) {
    return {
      ok: false,
      response: buildInsufficientCreditsError(
        requiredCredits,
        availableCredits
      ),
    };
  }

  return { ok: true, requiredCredits, availableCredits };
}

/**
 * Deduct credits AFTER a successful AI operation.
 * Uses a Firestore transaction to avoid concurrent double-spend.
 */
export async function deductCredits(
  userId: string,
  operation: AICreditOperation
): Promise<number> {
  return deductCreditUnits(userId, operation, 1);
}

/** Deduct N units of an operation after billable work. */
export async function deductCreditUnits(
  userId: string,
  operation: AICreditOperation,
  units: number
): Promise<number> {
  const requiredCredits =
    getRequiredCredits(operation) * Math.max(0, Math.floor(units));
  if (requiredCredits <= 0) {
    const snap = await userRef(userId).get();
    return readBalance(snap.data());
  }

  const ref = userRef(userId);

  const remaining = await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new Error(`User profile missing for credit deduction: ${userId}`);
    }

    const availableCredits = readBalance(snap.data());
    if (availableCredits < requiredCredits) {
      logger.warn("deductCreditUnits race: insufficient at commit", {
        userId,
        operation,
        requiredCredits,
        availableCredits,
      });
      tx.update(ref, {
        aiCreditsBalance: 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return 0;
    }

    const next = availableCredits - requiredCredits;
    tx.update(ref, {
      aiCreditsBalance: next,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return next;
  });

  logger.info("AI credits deducted", {
    userId,
    operation,
    requiredCredits,
    units,
    remaining,
  });

  return remaining;
}

/**
 * Add credits (e.g. review reward). Uses a transaction for concurrent safety.
 */
export async function awardCredits(
  userId: string,
  amount: number,
  reason: string
): Promise<number> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid credit award amount: ${amount}`);
  }

  const ref = userRef(userId);

  const balance = await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new Error(`User profile missing for credit award: ${userId}`);
    }

    const availableCredits = readBalance(snap.data());
    const next = availableCredits + amount;
    tx.update(ref, {
      aiCreditsBalance: next,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return next;
  });

  logger.info("AI credits awarded", {
    userId,
    amount,
    reason,
    balance,
  });

  return balance;
}
