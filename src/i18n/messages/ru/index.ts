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

export const ru = {
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
      not_found: "Промокод не найден.",
      inactive: "Этот промокод неактивен.",
      not_started: "Этот промокод ещё не действует.",
      expired: "Срок действия промокода истёк.",
      usage_limit_reached: "Достигнут лимит использований промокода.",
      generic: "Не удалось проверить промокод. Попробуйте снова.",
    },
  },
} as const;

export type RuMessages = typeof ru;
