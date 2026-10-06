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
import { aroundMe } from "./aroundMe";

export const kz = {
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
  aroundMe,
  promo: {
    error: {
      not_found: "Промокод табылмады.",
      inactive: "Бұл промокод белсенді емес.",
      not_started: "Бұл промокод әлі жарамды емес.",
      expired: "Промокодтың мерзімі аяқталды.",
      usage_limit_reached: "Промокодтың пайдалану шегіне жеттi.",
      generic: "Промокодты тексеру мүмкін болмады. Қайта көріңіз.",
    },
  },
} as const;

export type KzMessages = typeof kz;
