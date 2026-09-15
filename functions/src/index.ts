/**
 * PinToTrip Cloud Functions entrypoint.
 * AI and privileged work runs here — never in the browser.
 *
 * Callables: findPlace, getCityIntelligence, planTrip, chargeCreateTrip, getTripWeather,
 * submitReview, createReferral, completeReferral.
 * Scheduled: aggregateTravelIntelligence (daily Travel Intelligence).
 * Triggers: welcomeEmailOnUserCreated (users/{userId} create → Resend).
 * HTTP: paddleWebhook (Paddle Billing notifications).
 * Callables: createPaddlePortalSession.
 */
import { setGlobalOptions } from "firebase-functions";
import { DEFAULT_FUNCTIONS_REGION } from "./shared/config";
import { findPlace } from "./location/findPlace";
import { getCityIntelligence } from "./city/getCityIntelligence";
import { planTrip } from "./trip/planTrip";
import { chargeCreateTrip } from "./trip/chargeCreateTrip";
import { getTripWeather } from "./weather/getTripWeather";
import { submitReview } from "./review/submitReview";
import { createReferral, completeReferral } from "./referral";
import { aggregateTravelIntelligence } from "./travelIntelligence/aggregateTravelIntelligence";
import { welcomeEmailOnUserCreated } from "./welcomeEmail";
import {
  paddleWebhook,
  createPaddlePortalSession,
} from "./paddle";

setGlobalOptions({
  region: DEFAULT_FUNCTIONS_REGION,
  maxInstances: 20,
});

export {
  findPlace,
  getCityIntelligence,
  planTrip,
  chargeCreateTrip,
  getTripWeather,
  submitReview,
  createReferral,
  completeReferral,
  aggregateTravelIntelligence,
  welcomeEmailOnUserCreated,
  paddleWebhook,
  createPaddlePortalSession,
};
