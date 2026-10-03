import type { SavedLocation } from "@/hooks/useLocations";
import type {
  PreparationItem,
  TripPlannerDoc,
  TripRoute,
} from "@/types/trip-planner";
import { listTripAccommodations } from "./essentialsHelpers";
import { placesProgress } from "./tripUtils";
import { isWeatherFresh } from "./tripWeather";

export type ReadinessTone = "done" | "warn" | "progress";

export type ReadinessItemId =
  | "flights"
  | "accommodation"
  | "places"
  | "visa"
  | "payments"
  | "weather"
  | "packing";

export type ReadinessItem = {
  id: ReadinessItemId;
  label: string;
  /** 0–100 contribution toward overall readiness. */
  score: number;
  tone: ReadinessTone;
};

export type TripReadiness = {
  percent: number;
  items: ReadinessItem[];
};

function toneForScore(score: number): ReadinessTone {
  if (score >= 100) return "done";
  if (score <= 0) return "warn";
  return "progress";
}

function prepItem(
  items: PreparationItem[],
  id: string
): PreparationItem | undefined {
  return items.find((item) => item.id === id);
}

function visaItems(items: PreparationItem[]): PreparationItem[] {
  return items.filter(
    (item) => item.id === "visa" || item.id.startsWith("visa:")
  );
}

function packingItems(items: PreparationItem[]): PreparationItem[] {
  return items.filter(
    (item) => item.category === "packing" || item.id === "pack-weather"
  );
}

function binaryScore(done: boolean): number {
  return done ? 100 : 0;
}

function ratioScore(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}

/**
 * Same metric as the Places step / TripStepNav — visited itinerary places.
 * Keeps readiness in sync with the step checkmark.
 */
function placesScore(
  trip: TripPlannerDoc,
  locations: SavedLocation[]
): number {
  const progress = placesProgress(trip, locations);
  if (progress.total <= 0) return 0;
  return progress.percent;
}

function weatherScore(trip: TripPlannerDoc): number {
  const days = trip.itinerary?.days ?? [];
  if (days.length === 0) return 0;
  const fresh = days.filter(
    (day) => isWeatherFresh(day.weather) && day.weather?.available === true
  ).length;
  return ratioScore(fresh, days.length);
}

/**
 * Trip-readiness breakdown for the details sidebar.
 * Scores are derived from routes, stays, places, weather cache, and preparation items.
 */
export function computeTripReadiness(
  trip: TripPlannerDoc,
  routes: TripRoute[],
  locations: SavedLocation[] = []
): TripReadiness {
  const items = trip.preparation?.items ?? [];
  const stays = listTripAccommodations(trip);
  const hasFlightRoute = routes.some((route) => route.transport === "flight");
  const flightPrep = prepItem(items, "flight");
  const flightsDone =
    hasFlightRoute || flightPrep?.completed === true;
  const flights = {
    id: "flights" as const,
    label: "Flights",
    score: binaryScore(flightsDone),
    tone: toneForScore(binaryScore(flightsDone)),
  };

  const stayPrep = prepItem(items, "accommodation");
  const accommodationDone =
    stays.length > 0 || stayPrep?.completed === true;
  const accommodation = {
    id: "accommodation" as const,
    label: "Accommodation",
    score: binaryScore(accommodationDone),
    tone: toneForScore(binaryScore(accommodationDone)),
  };

  const placesValue = placesScore(trip, locations);
  const places = {
    id: "places" as const,
    label: "Places",
    score: placesValue,
    tone: toneForScore(placesValue),
  };

  const visas = visaItems(items);
  const visaStatus = trip.preparation?.visa?.status;
  let visaValue: number;
  if (
    visaStatus === "not_needed" ||
    visaStatus === "approved"
  ) {
    visaValue = 100;
  } else if (visas.length > 0) {
    visaValue = ratioScore(
      visas.filter((item) => item.completed).length,
      visas.length
    );
  } else {
    // No visa checklist → treat as not applicable / ready.
    visaValue = 100;
  }
  const visa = {
    id: "visa" as const,
    label: "Visa",
    score: visaValue,
    tone: toneForScore(visaValue),
  };

  const money = prepItem(items, "money");
  const paymentsValue = binaryScore(money?.completed === true);
  const payments = {
    id: "payments" as const,
    label: "Payments",
    score: paymentsValue,
    tone: toneForScore(paymentsValue),
  };

  const weatherValue = weatherScore(trip);
  const weather = {
    id: "weather" as const,
    label: "Weather",
    score: weatherValue,
    tone: toneForScore(weatherValue),
  };

  const packingList = packingItems(items);
  const packingValue =
    packingList.length === 0
      ? 0
      : ratioScore(
          packingList.filter((item) => item.completed).length,
          packingList.length
        );
  const packing = {
    id: "packing" as const,
    label: "Packing",
    score: packingValue,
    tone: toneForScore(packingValue),
  };

  const readinessItems: ReadinessItem[] = [
    flights,
    accommodation,
    places,
    visa,
    payments,
    weather,
    packing,
  ];

  const percent = Math.round(
    readinessItems.reduce((sum, item) => sum + item.score, 0) /
      readinessItems.length
  );

  return { percent, items: readinessItems };
}
