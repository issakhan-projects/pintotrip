import { onCall, HttpsError } from "firebase-functions/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { requireAuth } from "../shared/auth";
import { DEFAULT_FUNCTIONS_REGION } from "../shared/config";
import { adminDb, initAdmin } from "../shared/admin";
import {
  REFERRALS_COLLECTION,
  normalizeReferralCode,
  type CompleteReferralOutcome,
  type ReferralDoc,
} from "./types";

export type CompleteReferralRequest = {
  code: string;
  referralId?: string;
};

export type CompleteReferralResult = {
  outcome: CompleteReferralOutcome;
  creditsAwarded?: number;
  referrerBalance?: number;
};

function readBalance(data: FirebaseFirestore.DocumentData | undefined): number {
  const raw = data?.aiCreditsBalance;
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

type TxResult =
  | {
      kind: "ok";
      referralId: string;
      referrerId: string;
      rewardCredits: number;
      referrerBalance: number;
    }
  | { kind: "terminal"; outcome: CompleteReferralOutcome };

/**
 * Complete a pending referral after the invitee finishes (or skips) onboarding.
 * Awards rewardCredits to the referrer. Idempotent if this user already completed one.
 */
export const completeReferral = onCall(
  {
    region: DEFAULT_FUNCTIONS_REGION,
    invoker: "public",
    cors: true,
  },
  async (request): Promise<CompleteReferralResult> => {
    initAdmin();
    const referredUserId = requireAuth(request);

    const body =
      request.data && typeof request.data === "object"
        ? (request.data as Record<string, unknown>)
        : {};

    const code = normalizeReferralCode(body.code);
    const referralId =
      typeof body.referralId === "string" && body.referralId.trim()
        ? body.referralId.trim()
        : undefined;

    if (!code) {
      return { outcome: "invalid_code" };
    }

    const db = adminDb();

    let txResult: TxResult;
    try {
      txResult = await db.runTransaction(async (tx) => {
        // One successful referred completion per invitee (doc id = uid).
        const claimRef = db.doc(`referralClaims/${referredUserId}`);
        const claimSnap = await tx.get(claimRef);
        if (claimSnap.exists) {
          return {
            kind: "terminal" as const,
            outcome: "alreadyCompleted" as const,
          };
        }

        let referralRef: FirebaseFirestore.DocumentReference | null = null;
        let referralData: ReferralDoc | null = null;

        if (referralId) {
          const byIdRef = db.doc(`${REFERRALS_COLLECTION}/${referralId}`);
          const byIdSnap = await tx.get(byIdRef);
          if (byIdSnap.exists) {
            const data = byIdSnap.data() as ReferralDoc;
            if (data.code === code) {
              referralRef = byIdRef;
              referralData = data;
            }
          }
        }

        if (!referralRef || !referralData) {
          const byCodeSnap = await tx.get(
            db
              .collection(REFERRALS_COLLECTION)
              .where("code", "==", code)
              .limit(1)
          );
          if (byCodeSnap.empty) {
            return {
              kind: "terminal" as const,
              outcome: "invalid_code" as const,
            };
          }
          const docSnap = byCodeSnap.docs[0]!;
          referralRef = docSnap.ref;
          referralData = docSnap.data() as ReferralDoc;
        }

        if (referralData.referrerId === referredUserId) {
          return {
            kind: "terminal" as const,
            outcome: "self_referral" as const,
          };
        }

        if (referralData.status !== "pending" || referralData.referredUserId) {
          return {
            kind: "terminal" as const,
            outcome: "not_pending" as const,
          };
        }

        const referrerRef = db.doc(`users/${referralData.referrerId}`);
        const referrerSnap = await tx.get(referrerRef);
        if (!referrerSnap.exists) {
          return {
            kind: "terminal" as const,
            outcome: "referrer_missing" as const,
          };
        }

        const rewardCredits =
          typeof referralData.rewardCredits === "number" &&
          Number.isFinite(referralData.rewardCredits) &&
          referralData.rewardCredits > 0
            ? referralData.rewardCredits
            : 100;

        const nextBalance = readBalance(referrerSnap.data()) + rewardCredits;
        const now = Date.now();

        tx.create(claimRef, {
          referralId: referralRef.id,
          code,
          referrerId: referralData.referrerId,
          referredUserId,
          createdAt: now,
        });

        tx.update(referralRef, {
          referredUserId,
          status: "completed",
          completedAt: now,
        });

        tx.update(referrerRef, {
          aiCreditsBalance: nextBalance,
          updatedAt: FieldValue.serverTimestamp(),
        });

        return {
          kind: "ok" as const,
          referralId: referralRef.id,
          referrerId: referralData.referrerId,
          rewardCredits,
          referrerBalance: nextBalance,
        };
      });
    } catch (err) {
      logger.error("completeReferral transaction failed", {
        referredUserId,
        code,
        referralId,
        err,
      });
      throw new HttpsError("internal", "Could not complete referral.");
    }

    if (txResult.kind === "terminal") {
      return { outcome: txResult.outcome };
    }

    // Best-effort inbox notification for the referrer (outside credits tx).
    try {
      await db
        .collection(`users/${txResult.referrerId}/notifications`)
        .add({
          type: "referral_reward",
          title: "Friend joined — credits unlocked",
          body: `You earned ${txResult.rewardCredits} AI credits because a friend finished signing up with your invite.`,
          link: "/map?tab=profile",
          read: false,
          createdAt: Date.now(),
        });
    } catch (notifyErr) {
      logger.warn("completeReferral: notification write failed", {
        referrerId: txResult.referrerId,
        err: notifyErr,
      });
    }

    logger.info("Referral completed", {
      referredUserId,
      referralId: txResult.referralId,
      referrerId: txResult.referrerId,
      creditsAwarded: txResult.rewardCredits,
      referrerBalance: txResult.referrerBalance,
    });

    return {
      outcome: "ok",
      creditsAwarded: txResult.rewardCredits,
      referrerBalance: txResult.referrerBalance,
    };
  }
);
