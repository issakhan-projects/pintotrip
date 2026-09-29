/**
 * purchasePlaceSearchPack — charge AI credits for a pack of Google place name searches.
 * Client runs Places Text Search; this callable only validates plan + deducts credits.
 *
 * Free plan is hard-off. Plus/Pro require entitlement; monthly quotas TBD.
 */

import { HttpsError, onCall } from "firebase-functions/https";
import { logger } from "firebase-functions";
import { requireAuth } from "../shared/auth";
import { DEFAULT_FUNCTIONS_REGION } from "../shared/config";
import {
  assertSufficientCredits,
  deductCredits,
} from "../shared/creditService";
import {
  getRequiredCredits,
  type InsufficientAICreditsError,
} from "../shared/credits";
import { initAdmin, adminDb } from "../shared/admin";
import {
  canUsePlaceNameSearch,
  type AppPlan,
} from "../shared/placeSearchLimits";

/** Searches granted per successful purchase (client-enforced pack size). */
export const PLACE_SEARCH_PACK_SIZE = 5;

export type PurchasePlaceSearchPackResult =
  | {
      success: true;
      searchesGranted: number;
      creditsCharged: number;
      remainingCredits: number;
    }
  | InsufficientAICreditsError;

/**
 * Buy a pack of place name searches (10 AI credits → 5 searches).
 * Blocked for Free (and any plan without place-name-search entitlement).
 */
export const purchasePlaceSearchPack = onCall(
  {
    region: DEFAULT_FUNCTIONS_REGION,
    invoker: "public",
    cors: true,
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request): Promise<PurchasePlaceSearchPackResult> => {
    initAdmin();
    const uid = requireAuth(request);

    const userSnap = await adminDb().doc(`users/${uid}`).get();
    const subscription = userSnap.data()?.subscription as
      | { plan?: AppPlan | null; status?: string | null }
      | undefined;

    if (!canUsePlaceNameSearch(subscription)) {
      logger.info("purchasePlaceSearchPack blocked: plan not entitled", {
        uid,
        plan: subscription?.plan ?? "free",
        status: subscription?.status ?? "inactive",
      });
      throw new HttpsError(
        "permission-denied",
        "Place name search is not included in your plan."
      );
    }

    const creditCheck = await assertSufficientCredits(uid, "searchPlaces");
    if (!creditCheck.ok) {
      logger.info("purchasePlaceSearchPack blocked: insufficient credits", {
        uid,
        requiredCredits: creditCheck.response.requiredCredits,
        availableCredits: creditCheck.response.availableCredits,
      });
      return creditCheck.response;
    }

    const remainingCredits = await deductCredits(uid, "searchPlaces");
    const creditsCharged = getRequiredCredits("searchPlaces");

    logger.info("purchasePlaceSearchPack success", {
      uid,
      creditsCharged,
      remainingCredits,
      searchesGranted: PLACE_SEARCH_PACK_SIZE,
    });

    return {
      success: true,
      searchesGranted: PLACE_SEARCH_PACK_SIZE,
      creditsCharged,
      remainingCredits,
    };
  }
);
