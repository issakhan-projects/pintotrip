/**
 * Merge AI route suggestions with the precomputed journey.
 * Preserves every user route; ensures missing inter-city connections exist;
 * keeps local transfers secondary.
 */

import { journeyCitiesMatch } from "./buildJourney";
import type {
  PlannedDaySuggestion,
  PlannedRouteRole,
  PlannedRouteSuggestion,
  PlanTripExistingDay,
  RoutePoint,
  TripPlanningJourney,
  TripPlanningJourneyCity,
  TripPlanningJourneyLeg,
  TripRouteContext,
  TripRouteInstant,
  TripRouteTransport,
} from "./types";

function dateOnlyInstant(date: string, timezone = ""): TripRouteInstant {
  return {
    datetime: /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : date,
    timezone,
    timeKnown: false,
  };
}

function isoDateFromInstant(instant?: TripRouteInstant): string | null {
  if (!instant?.datetime) return null;
  const m = instant.datetime.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? null;
}

function cityToRoutePoint(city: TripPlanningJourneyCity): RoutePoint {
  return {
    name: city.name || city.city,
    city: city.city || city.name,
    ...(city.country ? { country: city.country } : {}),
    ...(city.cityId ? { cityId: city.cityId } : {}),
    ...(city.countryId ? { countryId: city.countryId } : {}),
    ...(city.placeId ? { placeId: city.placeId } : {}),
    ...(city.code ? { code: city.code } : {}),
    ...(city.location ? { location: city.location } : {}),
    ...(city.stopType === "destination" || city.stopType === "transit"
      ? { stopType: city.stopType }
      : {}),
  };
}

function resolveDayMetaFromTripDates(
  preferredDate: string | null | undefined,
  emptyDays: PlanTripExistingDay[],
  tripDays: PlanTripExistingDay[],
  fallbackIndex: number,
  totalLegs: number
): { day: number; date: string } {
  const pool = tripDays.length > 0 ? tripDays : emptyDays;
  if (preferredDate) {
    const hit = pool.find((d) => d.date === preferredDate);
    if (hit) return { day: hit.day, date: hit.date };
  }
  if (pool.length === 0) {
    return {
      day: Math.max(1, fallbackIndex + 1),
      date: preferredDate || "1970-01-01",
    };
  }
  const idx =
    totalLegs <= 1
      ? 0
      : Math.min(
          pool.length - 1,
          Math.round((fallbackIndex / (totalLegs - 1)) * (pool.length - 1))
        );
  const day = pool[idx]!;
  return {
    day: day.day,
    date: preferredDate && /^\d{4}-\d{2}-\d{2}$/.test(preferredDate)
      ? preferredDate
      : day.date,
  };
}

function inferRole(
  route: PlannedRouteSuggestion,
  journey: TripPlanningJourney
): PlannedRouteRole {
  if (route.role === "user" || route.existingRouteId) return "user";
  if (route.role === "intercity" || route.role === "local_transfer") {
    return route.role;
  }
  const matchesRequired = journey.legs.some(
    (leg) =>
      leg.source === "ai_required" &&
      journeyCitiesMatch(leg.from, route.from) &&
      journeyCitiesMatch(leg.to, route.to)
  );
  if (matchesRequired) return "intercity";
  if (journeyCitiesMatch(route.from, route.to)) return "local_transfer";
  // Same metropolitan move (airport code → city name) ≈ local
  const fromCity = (route.from.city || "").toLowerCase();
  const toCity = (route.to.city || "").toLowerCase();
  if (fromCity && toCity && (fromCity.includes(toCity) || toCity.includes(fromCity))) {
    return "local_transfer";
  }
  return "local_transfer";
}

function findAiMatch(
  leg: TripPlanningJourneyLeg,
  aiRoutes: PlannedRouteSuggestion[]
): PlannedRouteSuggestion | undefined {
  if (leg.source === "user" && leg.existingRouteId) {
    const byId = aiRoutes.find(
      (r) => r.existingRouteId === leg.existingRouteId
    );
    if (byId) return byId;
  }
  return aiRoutes.find(
    (r) =>
      journeyCitiesMatch(leg.from, r.from) &&
      journeyCitiesMatch(leg.to, r.to) &&
      !r.existingRouteId
  );
}

function suggestionFromUserRoute(
  route: TripRouteContext,
  leg: TripPlanningJourneyLeg,
  day: number,
  date: string,
  placeCount: number
): PlannedRouteSuggestion {
  const departure =
    route.departure ??
    leg.departure ??
    dateOnlyInstant(date, "");
  return {
    day,
    date,
    insertAt: placeCount,
    from: route.from,
    to: route.to,
    transport: route.transport,
    departure: {
      ...departure,
      timeKnown: departure.timeKnown === true,
    },
    ...(route.arrival
      ? {
          arrival: {
            ...route.arrival,
            timeKnown: route.arrival.timeKnown === true,
          },
        }
      : {}),
    ...(route.durationMinutes != null
      ? { durationMinutes: route.durationMinutes }
      : {}),
    ...(route.durationApproximate ? { durationApproximate: true } : {}),
    ...(route.note ? { note: route.note } : {}),
    ...(route.priceAmount != null ? { priceAmount: route.priceAmount } : {}),
    ...(route.priceCurrency ? { priceCurrency: route.priceCurrency } : {}),
    ...(route.priceLabel ? { priceLabel: route.priceLabel } : {}),
    ...(route.link ? { link: route.link } : {}),
    role: "user",
    existingRouteId: route.id,
  };
}

function suggestionFromRequiredLeg(
  leg: TripPlanningJourneyLeg,
  day: number,
  date: string,
  ai: PlannedRouteSuggestion | undefined,
  placeCount: number
): PlannedRouteSuggestion {
  if (ai) {
    const departure = ai.departure ?? dateOnlyInstant(date, "");
    return {
      ...ai,
      day,
      date,
      insertAt: Math.max(0, Math.min(placeCount, Math.floor(ai.insertAt))),
      from: {
        ...cityToRoutePoint(leg.from),
        ...ai.from,
        name: ai.from.name || leg.from.name,
        city: ai.from.city || leg.from.city,
      },
      to: {
        ...cityToRoutePoint(leg.to),
        ...ai.to,
        name: ai.to.name || leg.to.name,
        city: ai.to.city || leg.to.city,
      },
      departure: {
        ...departure,
        timeKnown: departure.timeKnown === true,
      },
      role: "intercity",
      existingRouteId: undefined,
    };
  }

  // Fallback stub so the journey is never missing a required leg.
  const transport: TripRouteTransport = "other";
  return {
    day,
    date,
    insertAt: placeCount,
    from: cityToRoutePoint(leg.from),
    to: cityToRoutePoint(leg.to),
    transport,
    departure: dateOnlyInstant(date),
    durationApproximate: true,
    note:
      leg.reason ??
      `Required connection ${leg.from.city} → ${leg.to.city} (transport TBD).`,
    role: "intercity",
  };
}

/**
 * Finalize routes for the planTrip response:
 * 1. Every user journey leg preserved (existingRouteId)
 * 2. Every ai_required leg present as intercity
 * 3. Local transfers appended without overriding the journey
 */
export function finalizePlanRoutes(input: {
  aiRoutes: PlannedRouteSuggestion[];
  userRoutes: TripRouteContext[];
  journey: TripPlanningJourney;
  emptyDays: PlanTripExistingDay[];
  /** All trip days (empty + occupied) for date→day mapping. */
  allDays?: PlanTripExistingDay[];
  days: PlannedDaySuggestion[];
}): PlannedRouteSuggestion[] {
  const {
    aiRoutes,
    userRoutes,
    journey,
    emptyDays,
    days,
  } = input;
  const allDays = input.allDays ?? emptyDays;
  const placeCountByDay = new Map(
    days.map((d) => [d.day, d.places.length] as const)
  );
  const userById = new Map(userRoutes.map((r) => [r.id, r]));
  const usedAi = new Set<PlannedRouteSuggestion>();
  const out: PlannedRouteSuggestion[] = [];
  const totalLegs = Math.max(1, journey.legs.length);

  for (let i = 0; i < journey.legs.length; i += 1) {
    const leg = journey.legs[i]!;
    const ai = findAiMatch(leg, aiRoutes);
    if (ai) usedAi.add(ai);

    const preferredDate =
      isoDateFromInstant(ai?.departure) ??
      isoDateFromInstant(leg.departure) ??
      ai?.date ??
      null;
    const { day, date } = resolveDayMetaFromTripDates(
      preferredDate,
      emptyDays,
      allDays,
      i,
      totalLegs
    );
    const placeCount = placeCountByDay.get(day) ?? 0;

    if (leg.source === "user" && leg.existingRouteId) {
      const user = userById.get(leg.existingRouteId);
      if (user) {
        const echoed = ai
          ? {
              ...suggestionFromUserRoute(user, leg, day, date, placeCount),
              // Prefer AI day/insertAt when it echoed the user route thoughtfully.
              day: ai.day || day,
              date: ai.date || date,
              insertAt: Math.max(
                0,
                Math.min(placeCount, Math.floor(ai.insertAt))
              ),
            }
          : suggestionFromUserRoute(user, leg, day, date, placeCount);
        out.push(echoed);
        continue;
      }
    }

    out.push(suggestionFromRequiredLeg(leg, day, date, ai, placeCount));
  }

  // Secondary local transfers — never replace journey legs.
  for (const route of aiRoutes) {
    if (usedAi.has(route)) continue;
    const role = inferRole(route, journey);
    if (role === "user") continue;
    if (role === "intercity") {
      // Extra intercity not in journey — drop (would change the journey).
      continue;
    }
    const placeCount = placeCountByDay.get(route.day) ?? 0;
    const date =
      route.date ||
      emptyDays.find((d) => d.day === route.day)?.date ||
      allDays.find((d) => d.day === route.day)?.date;
    if (!date) continue;
    out.push({
      ...route,
      date,
      insertAt: Math.max(0, Math.min(placeCount, Math.floor(route.insertAt))),
      role: "local_transfer",
      existingRouteId: undefined,
      departure: route.departure ?? dateOnlyInstant(date),
    });
  }

  return out.sort((a, b) => a.day - b.day || a.insertAt - b.insertAt);
}

/** Soft validation diagnostics for logging (does not throw). */
export function validateJourneyPlan(input: {
  routes: PlannedRouteSuggestion[];
  journey: TripPlanningJourney;
  destinations: RoutePoint[];
}): string[] {
  const issues: string[] = [];
  const { routes, journey, destinations } = input;

  for (const leg of journey.legs) {
    if (leg.source === "user" && leg.existingRouteId) {
      const found = routes.some(
        (r) =>
          r.existingRouteId === leg.existingRouteId ||
          (journeyCitiesMatch(r.from, leg.from) &&
            journeyCitiesMatch(r.to, leg.to) &&
            r.role === "user")
      );
      if (!found) {
        issues.push(`Missing user route ${leg.existingRouteId}`);
      }
    }
    if (leg.source === "ai_required") {
      const found = routes.some(
        (r) =>
          r.role === "intercity" &&
          journeyCitiesMatch(r.from, leg.from) &&
          journeyCitiesMatch(r.to, leg.to)
      );
      if (!found) {
        issues.push(
          `Missing AI connection ${leg.from.city} → ${leg.to.city}`
        );
      }
    }
  }

  for (const dest of destinations) {
    const keyCity = dest.city;
    const inSequence = journey.citySequence.some((c) =>
      journeyCitiesMatch(c, dest)
    );
    if (!inSequence) {
      issues.push(`Destination ${keyCity} missing from journey sequence`);
    }
  }

  for (const route of routes) {
    if (!route.departure?.datetime) {
      issues.push(
        `Route ${route.from.city}→${route.to.city} missing departure.datetime`
      );
    }
  }

  return issues;
}
