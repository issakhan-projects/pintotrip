import { getFunctions, httpsCallable, type Functions } from "firebase/functions";
import { getFirebaseApp } from "@/lib/firebase/client";
import type {
  AnalyzeLocationRequest,
  AnalyzeLocationResult,
  ConfidenceLevel,
} from "@/types/ai";
import { getConfidenceLevel } from "@/types/ai";
import type {
  GetCityIntelligenceRequest,
  CityIntelligenceResult,
} from "@/types/city-intelligence";
import {
  isInsufficientAICreditsError,
  type InsufficientAICreditsError,
} from "@/types/credits";
import type {
  SubmitReviewRequest,
  SubmitReviewResult,
} from "@/types/review";
import type {
  CompleteReferralRequest,
  CompleteReferralResult,
  CreateReferralResult,
} from "@/types/referral";
import type { PlanTripRequest, PlanTripResult } from "@/types/trip-plan";
import type {
  ChargeCreateTripRequest,
  ChargeCreateTripResult,
} from "@/types/credits";
import type {
  GetTripWeatherRequest,
  GetTripWeatherResult,
} from "@/types/weather";

let functions: Functions | undefined;

function getCloudFunctions(): Functions {
  if (!functions) {
    const region =
      process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION ?? "us-central1";
    functions = getFunctions(getFirebaseApp(), region);
  }
  return functions;
}

export type FindPlaceResponse =
  | AnalyzeLocationResult
  | InsufficientAICreditsError;

export type GetCityIntelligenceResponse =
  | CityIntelligenceResult
  | InsufficientAICreditsError;

export type PlanTripResponse = PlanTripResult | InsufficientAICreditsError;
export type ChargeCreateTripResponse =
  | ChargeCreateTripResult
  | InsufficientAICreditsError;

function normalizeFindPlaceResult(
  data: AnalyzeLocationResult
): AnalyzeLocationResult {
  const confidence = Number.isFinite(data.confidence) ? data.confidence : 0;
  const confidenceLevel: ConfidenceLevel =
    data.confidenceLevel ?? getConfidenceLevel(confidence);
  const identified =
    typeof data.identified === "boolean"
      ? data.identified
      : Boolean(data.title && data.country);

  return {
    ...data,
    identified,
    confidence,
    confidenceLevel,
    verificationPerformed: Boolean(data.verificationPerformed),
    alternatives: Array.isArray(data.alternatives) ? data.alternatives : [],
  };
}

/**
 * Client wrappers for Cloud Functions.
 * The browser NEVER calls OpenAI directly — only these callables.
 * Credit validation/deduction is enforced on the backend.
 */
export async function findPlace(
  request: AnalyzeLocationRequest
): Promise<AnalyzeLocationResult> {
  const callable = httpsCallable<AnalyzeLocationRequest, FindPlaceResponse>(
    getCloudFunctions(),
    "findPlace"
  );
  const result = await callable(request);
  if (isInsufficientAICreditsError(result.data)) {
    throw Object.assign(new Error(result.data.message), result.data);
  }
  return normalizeFindPlaceResult(result.data);
}

/** @deprecated Use findPlace */
export const analyzeLocation = findPlace;

export async function getCityIntelligence(
  request: GetCityIntelligenceRequest
): Promise<CityIntelligenceResult> {
  const callable = httpsCallable<
    GetCityIntelligenceRequest,
    GetCityIntelligenceResponse
  >(getCloudFunctions(), "getCityIntelligence");
  const result = await callable(request);
  if (isInsufficientAICreditsError(result.data)) {
    throw Object.assign(new Error(result.data.message), result.data);
  }
  return result.data;
}

/**
 * AI itinerary for empty days, shaped by leisure type (purpose and intensity).
 * First generate is included. Recreate charges ordinary 10 / advanced 30
 * (enforced server-side from the trip's createMode).
 */
export async function planTrip(
  request: PlanTripRequest
): Promise<PlanTripResult> {
  const callable = httpsCallable<PlanTripRequest, PlanTripResponse>(
    getCloudFunctions(),
    "planTrip"
  );
  const result = await callable(request);
  if (isInsufficientAICreditsError(result.data)) {
    throw Object.assign(new Error(result.data.message), result.data);
  }
  return result.data;
}

/**
 * Deduct Create Trip credits (ordinary 20 / advanced 75).
 * Enforced on the server; never write aiCreditsBalance from the client.
 */
export async function chargeCreateTrip(
  request: ChargeCreateTripRequest
): Promise<ChargeCreateTripResult> {
  const callable = httpsCallable<
    ChargeCreateTripRequest,
    ChargeCreateTripResponse
  >(getCloudFunctions(), "chargeCreateTrip");
  const result = await callable(request);
  if (isInsufficientAICreditsError(result.data)) {
    throw Object.assign(new Error(result.data.message), result.data);
  }
  return result.data;
}

/**
 * Daily weather forecast for trip dates at destination coords.
 * OpenWeatherMap key stays on the server.
 */
export async function getTripWeather(
  request: GetTripWeatherRequest
): Promise<GetTripWeatherResult> {
  const callable = httpsCallable<GetTripWeatherRequest, GetTripWeatherResult>(
    getCloudFunctions(),
    "getTripWeather"
  );
  const result = await callable(request);
  return result.data;
}

/**
 * Submit an in-app review once. Awards REVIEW_REWARD_AI_CREDITS on the server.
 * A second submit is rejected with already-exists (no extra credits).
 */
export async function submitReview(
  request: SubmitReviewRequest
): Promise<SubmitReviewResult> {
  const callable = httpsCallable<SubmitReviewRequest, SubmitReviewResult>(
    getCloudFunctions(),
    "submitReview"
  );
  try {
    const result = await callable(request);
    return result.data;
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "";
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "";

    if (
      code.includes("already-exists") ||
      /already left a review/i.test(message)
    ) {
      throw Object.assign(new Error("You have already left a review."), {
        code: "already-exists",
      });
    }
    throw err;
  }
}

/**
 * Create a pending referral invite for the signed-in user.
 * Privileged write — Admin SDK only via this callable.
 */
export async function createReferral(): Promise<CreateReferralResult> {
  const callable = httpsCallable<Record<string, never>, CreateReferralResult>(
    getCloudFunctions(),
    "createReferral"
  );
  const result = await callable({});
  return result.data;
}

/**
 * Complete a pending referral after onboarding.
 * Awards credits to the referrer; never trust the client for balances.
 */
export async function completeReferral(
  request: CompleteReferralRequest
): Promise<CompleteReferralResult> {
  const callable = httpsCallable<
    CompleteReferralRequest,
    CompleteReferralResult
  >(getCloudFunctions(), "completeReferral");
  const result = await callable(request);
  return result.data;
}

/**
 * Open Paddle Customer Portal for the signed-in Plus/Pro user.
 * Portal URL is one-time; never cache.
 */
export async function createPaddlePortalSession(): Promise<{ url: string }> {
  const callable = httpsCallable<Record<string, never>, { url: string }>(
    getCloudFunctions(),
    "createPaddlePortalSession"
  );
  const result = await callable({});
  return result.data;
}

export { isInsufficientAICreditsError };
export type { InsufficientAICreditsError };
