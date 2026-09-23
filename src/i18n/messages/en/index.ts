import { common } from "./common";
import { transport } from "./transport";
import { status } from "./status";
import { app } from "./app";
import { city } from "./city";
import { trip } from "./trip";
import { planner } from "./planner";
import { plannerCityIntel } from "./plannerCityIntel";
import { profile } from "./profile";
import { places } from "./places";
import { map } from "./map";
import { auth } from "./auth";
import { onboarding } from "./onboarding";
import { addPlace } from "./addPlace";
import { search } from "./search";
import { referral } from "./referral";
import { cookies } from "./cookies";
import { pricing } from "./pricing";
import { landing } from "./landing";
import { review } from "./review";
import { ui } from "./ui";
import { credits } from "./credits";

export const en = {
  common,
  transport,
  status,
  app,
  city,
  trip,
  planner: { ...planner, cityIntel: plannerCityIntel },
  profile,
  places,
  map,
  auth,
  onboarding,
  addPlace,
  search,
  referral,
  cookies,
  pricing,
  landing,
  review,
  ui,
  credits,
  promo: {
    error: {
      not_found: "Promo code not found.",
      inactive: "This promo code is not active.",
      not_started: "This promo code is not valid yet.",
      expired: "This promo code has expired.",
      usage_limit_reached: "This promo code has reached its usage limit.",
      generic: "Could not validate the promo code. Try again.",
    },
  },
} as const;

export type EnMessages = typeof en;
