import { onCall, HttpsError } from "firebase-functions/https";
import { logger } from "firebase-functions";
import { requireAuth } from "../shared/auth";
import { DEFAULT_FUNCTIONS_REGION } from "../shared/config";
import { adminDb, initAdmin } from "../shared/admin";
import {
  CODE_UNIQUENESS_ATTEMPTS,
  REFERRAL_REWARD_AI_CREDITS,
  REFERRALS_COLLECTION,
  buildInvitePath,
  generateReferralCode,
  type ReferralDoc,
} from "./types";

export type CreateReferralResult = {
  code: string;
  referralId: string;
  path: string;
  rewardCredits: number;
};

/**
 * Create a pending referral invite for the authenticated user.
 * Returns code + referralId; client builds absolute URL with current origin.
 */
export const createReferral = onCall(
  {
    region: DEFAULT_FUNCTIONS_REGION,
    invoker: "public",
    cors: true,
  },
  async (request): Promise<CreateReferralResult> => {
    initAdmin();
    const userId = requireAuth(request);
    const db = adminDb();

    const userSnap = await db.doc(`users/${userId}`).get();
    if (!userSnap.exists) {
      throw new HttpsError("failed-precondition", "User profile is missing.");
    }

    const userData = userSnap.data() ?? {};
    const referrerEmail =
      typeof userData.email === "string" ? userData.email : "";

    let code: string | null = null;
    for (let attempt = 0; attempt < CODE_UNIQUENESS_ATTEMPTS; attempt++) {
      const candidate = generateReferralCode();
      const existing = await db
        .collection(REFERRALS_COLLECTION)
        .where("code", "==", candidate)
        .limit(1)
        .get();
      if (existing.empty) {
        code = candidate;
        break;
      }
    }

    if (!code) {
      logger.error("createReferral: exhausted code uniqueness attempts", {
        userId,
      });
      throw new HttpsError(
        "resource-exhausted",
        "Could not generate a unique invite code. Try again."
      );
    }

    const now = Date.now();
    const doc: ReferralDoc = {
      code,
      referrerId: userId,
      referredUserId: null,
      referrerEmail,
      status: "pending",
      rewardCredits: REFERRAL_REWARD_AI_CREDITS,
      createdAt: now,
      completedAt: null,
    };

    const ref = db.collection(REFERRALS_COLLECTION).doc();
    await ref.set(doc);

    logger.info("Referral created", {
      userId,
      referralId: ref.id,
      code,
    });

    return {
      code,
      referralId: ref.id,
      path: buildInvitePath(code, ref.id),
      rewardCredits: REFERRAL_REWARD_AI_CREDITS,
    };
  }
);
