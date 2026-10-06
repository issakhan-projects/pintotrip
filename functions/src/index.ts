/**
 * PinToTrip Cloud Functions entrypoint.
 * AI and privileged work runs here — never in the browser.
 *
 * Callables: findPlace, findAroundMe, getCityIntelligence, planTrip,
 * fillTripPlannerAiPlaces, shareTripStory, getTripWeather, resolveCityAirports,
 * purchasePlaceSearchPack, submitReview, createReferral, completeReferral.
 * Scheduled: aggregateTravelIntelligence (daily Travel Intelligence).
 * Triggers: welcomeEmailOnUserCreated (users/{userId} create → Resend),
 * onTripPlannerCreated (tripPlanner create → transport discovery + transportLocations).
 * HTTP: paddleWebhook (Paddle Billing notifications).
 * Callables: createPaddlePortalSession, cancelPaddleSubscription.
 */
import { setGlobalOptions } from "firebase-functions";
import { DEFAULT_FUNCTIONS_REGION } from "./shared/config";
import { findPlace } from "./location/findPlace";
import { findAroundMe } from "./location/findAroundMe";
import { purchasePlaceSearchPack } from "./location/purchasePlaceSearchPack";
import { getCityIntelligence } from "./city/getCityIntelligence";
import { planTrip } from "./trip/planTrip";
import { fillTripPlannerAiPlaces } from "./trip/fillTripPlannerAiPlaces";
import { shareTripStory } from "./trip/shareTripStory";
import { resolveCityAirports } from "./trip/resolveCityAirports";
import { onTripPlannerCreated } from "./trip/onTripPlannerCreated";
import { getTripWeather } from "./weather/getTripWeather";
import { submitReview } from "./review/submitReview";
import { createReferral, completeReferral } from "./referral";
import { aggregateTravelIntelligence } from "./travelIntelligence/aggregateTravelIntelligence";
import { welcomeEmailOnUserCreated } from "./welcomeEmail";
import {
  paddleWebhook,
  createPaddlePortalSession,
  cancelPaddleSubscription,
} from "./paddle";

setGlobalOptions({
  region: DEFAULT_FUNCTIONS_REGION,
  maxInstances: 20,
});

export {
  findPlace,
  findAroundMe,
  purchasePlaceSearchPack,
  getCityIntelligence,
  planTrip,
  fillTripPlannerAiPlaces,
  shareTripStory,
  resolveCityAirports,
  onTripPlannerCreated,
  getTripWeather,
  submitReview,
  createReferral,
  completeReferral,
  aggregateTravelIntelligence,
  welcomeEmailOnUserCreated,
  paddleWebhook,
  createPaddlePortalSession,
  cancelPaddleSubscription,
};
