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
  GetCityIntelligenceBatchResult,
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
import type { PlanTripRequest } from "@/types/trip-plan";
import type {
  FillTripPlannerAiPlacesRequest,
  FillTripPlannerAiPlacesResult,
  PlanTripAiResult,
} from "@/types/trip-planner-ai-request";
import type {
  GetTripWeatherRequest,
  GetTripWeatherResult,
} from "@/types/weather";
import type {
  ResolveCityAirportsRequest,
  ResolveCityAirportsResult,
} from "@/types/airports";

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
  | GetCityIntelligenceBatchResult
  | InsufficientAICreditsError;

export type PlanTripResponse = PlanTripAiResult | InsufficientAICreditsError;

export type ResolveCityAirportsResponse =
  | ResolveCityAirportsResult
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
): Promise<GetCityIntelligenceBatchResult> {
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

/** Convenience: fetch intelligence for a single city. */
export async function getCityIntelligenceForPlace(input: {
  city: string;
  country: string;
  lat: number;
  lon: number;
  cityId?: string;
  countryId?: string;
  userCountry?: string;
  userCurrency?: string;
  language?: string;
}): Promise<CityIntelligenceResult> {
  const batch = await getCityIntelligence({
    cities: [
      {
        city: input.city,
        country: input.country,
        lat: input.lat,
        lon: input.lon,
        cityId: input.cityId,
        countryId: input.countryId,
      },
    ],
    userCountry: input.userCountry,
    userCurrency: input.userCurrency,
    language: input.language,
  });
  const first = batch.results[0];
  if (!first) {
    throw new Error("City intelligence returned no results.");
  }
  return first;
}

/**
 * Trip Planner AI — server builds request + fills routes/places.
 * Client sends only tripId, language, temperatureType.
 */
export async function planTrip(
  request: PlanTripRequest
): Promise<PlanTripAiResult> {
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
 * Fill free-time city slots: keep saved `{ locationId }` first, then AI new
 * places using the locations subcollection shape (no googlePhotoUrl).
 */
export async function fillTripPlannerAiPlaces(
  request: FillTripPlannerAiPlacesRequest
): Promise<FillTripPlannerAiPlacesResult> {
  const callable = httpsCallable<
    FillTripPlannerAiPlacesRequest,
    FillTripPlannerAiPlacesResult
  >(getCloudFunctions(), "fillTripPlannerAiPlaces");
  const result = await callable(request);
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
 * Map trip cities → primary IATA airports (+ lat/lon). Cached server-side.
 * Costs 1 credit on cache miss.
 */
export async function resolveCityAirports(
  request: ResolveCityAirportsRequest
): Promise<ResolveCityAirportsResult> {
  const callable = httpsCallable<
    ResolveCityAirportsRequest,
    ResolveCityAirportsResponse
  >(getCloudFunctions(), "resolveCityAirports");
  const result = await callable(request);
  if (isInsufficientAICreditsError(result.data)) {
    throw Object.assign(new Error(result.data.message), result.data);
  }
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
