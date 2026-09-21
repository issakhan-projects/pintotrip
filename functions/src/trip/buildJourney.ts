/**
 * Build the complete journey sequence BEFORE itinerary generation.
 *
 * User TripRoute[] legs are fixed. destinations[] cities that are not yet
 * reachable on that path get AI-required missing connections inserted in the
 * correct position (out-and-back / chain from the best anchor city).
 */

import type {
  RoutePoint,
  TripPlanningJourney,
  TripPlanningJourneyCity,
  TripPlanningJourneyLeg,
  TripRouteContext,
  TripStopType,
} from "./types";

function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Normalize city id/name to a comparable ASCII slug (prefer cityId). */
export function normalizeCityKey(input: {
  city?: string;
  name?: string;
  cityId?: string;
  placeId?: string;
}): string {
  const id = (input.cityId || input.placeId || "").trim().toLowerCase();
  if (id) {
    return slugCityKey(id);
  }
  return slugCityKey((input.city || input.name || "").trim().toLowerCase());
}

function slugCityKey(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pointToCity(
  point: RoutePoint,
  stopType?: TripStopType | "origin"
): TripPlanningJourneyCity {
  return {
    name: point.name || point.city,
    city: point.city || point.name,
    ...(point.country ? { country: point.country } : {}),
    ...(point.cityId ? { cityId: point.cityId } : {}),
    ...(point.countryId ? { countryId: point.countryId } : {}),
    ...(point.placeId ? { placeId: point.placeId } : {}),
    ...(point.code ? { code: point.code } : {}),
    ...(point.location ? { location: point.location } : {}),
    ...(stopType ? { stopType } : {}),
  };
}

function cityKeyOf(city: TripPlanningJourneyCity | RoutePoint): string {
  return normalizeCityKey({
    city: "city" in city ? city.city : undefined,
    name: "name" in city ? city.name : undefined,
    cityId: city.cityId,
    placeId: city.placeId,
  });
}

function sameCity(
  a: TripPlanningJourneyCity | RoutePoint,
  b: TripPlanningJourneyCity | RoutePoint
): boolean {
  const ka = cityKeyOf(a);
  const kb = cityKeyOf(b);
  return Boolean(ka && kb && ka === kb);
}

function stopTypeForDestination(
  dest: RoutePoint,
  destinations: RoutePoint[]
): TripStopType | undefined {
  const match = destinations.find((d) => sameCity(d, dest));
  return match?.stopType;
}

/**
 * City path implied by ordered user routes (repeats preserved).
 * Example: A→B, B→C, C→B, B→A → [A, B, C, B, A]
 */
function cityPathFromRoutes(
  routes: TripRouteContext[],
  origin: RoutePoint,
  destinations: RoutePoint[]
): TripPlanningJourneyCity[] {
  if (routes.length === 0) {
    const path: TripPlanningJourneyCity[] = [
      pointToCity(origin, "origin"),
    ];
    for (const dest of destinations) {
      const city = pointToCity(dest, dest.stopType);
      if (path.length > 0 && sameCity(path[path.length - 1]!, city)) {
        continue;
      }
      path.push(city);
    }
    return path;
  }

  const sorted = [...routes].sort((a, b) => a.order - b.order);
  const path: TripPlanningJourneyCity[] = [
    pointToCity(
      sorted[0]!.from,
      stopTypeForDestination(sorted[0]!.from, destinations) ??
        (sameCity(sorted[0]!.from, origin) ? "origin" : undefined)
    ),
  ];
  for (const route of sorted) {
    const to = pointToCity(
      route.to,
      stopTypeForDestination(route.to, destinations) ??
        (sameCity(route.to, origin) ? "origin" : undefined)
    );
    path.push(to);
  }
  return path;
}

function distanceBetween(
  a: TripPlanningJourneyCity,
  b: TripPlanningJourneyCity
): number {
  if (a.location && b.location) {
    return haversineKm(a.location, b.location);
  }
  if (
    a.countryId &&
    b.countryId &&
    a.countryId.toLowerCase() === b.countryId.toLowerCase()
  ) {
    return 500;
  }
  if (
    a.country &&
    b.country &&
    a.country.trim().toLowerCase() === b.country.trim().toLowerCase()
  ) {
    return 500;
  }
  return 5_000;
}

function pickAnchorIndex(
  path: TripPlanningJourneyCity[],
  missing: TripPlanningJourneyCity
): number {
  let bestIdx = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i < path.length; i += 1) {
    const candidate = path[i]!;
    // Prefer destination/stay cities over pure origin; allow transit.
    let score = distanceBetween(candidate, missing);
    if (candidate.stopType === "destination") score -= 200;
    if (candidate.stopType === "transit") score -= 50;
    if (candidate.stopType === "origin") score += 100;
    if (
      missing.countryId &&
      candidate.countryId &&
      missing.countryId === candidate.countryId
    ) {
      score -= 300;
    } else if (
      missing.country &&
      candidate.country &&
      missing.country.toLowerCase() === candidate.country.toLowerCase()
    ) {
      score -= 300;
    }
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/**
 * End of the stay window starting at `anchorIdx`: walk forward while cities are
 * the anchor or already-inserted detours that return to the anchor.
 */
function stayWindowEnd(
  path: TripPlanningJourneyCity[],
  anchorIdx: number
): number {
  const anchorKey = cityKeyOf(path[anchorIdx]!);
  let end = anchorIdx;
  for (let i = anchorIdx + 1; i < path.length; i += 1) {
    const key = cityKeyOf(path[i]!);
    if (key === anchorKey) {
      end = i;
      continue;
    }
    // Allow a single detour hop away if the next city returns to anchor later
    // in the same window — for chained missing inserts we expand after insert.
    break;
  }
  return end;
}

function citiesPresentKeys(path: TripPlanningJourneyCity[]): Set<string> {
  return new Set(path.map((c) => cityKeyOf(c)).filter(Boolean));
}

/**
 * Insert missing selected destinations into the path as out-and-back (or chain)
 * detours from the best anchor city already on the journey.
 */
function insertMissingDestinations(
  path: TripPlanningJourneyCity[],
  destinations: RoutePoint[]
): TripPlanningJourneyCity[] {
  let next = [...path];
  const required = destinations.filter(
    (d) => (d.stopType ?? "destination") === "destination" || !d.stopType
  );
  // Also ensure explicitly listed transit cities appear at least once when
  // there are no user routes covering them — transit already on path is fine.
  const alsoEnsure = destinations.filter((d) => d.stopType === "transit");

  const toInsert: TripPlanningJourneyCity[] = [];
  for (const dest of [...required, ...alsoEnsure]) {
    const city = pointToCity(dest, dest.stopType ?? "destination");
    const key = cityKeyOf(city);
    if (!key) continue;
    if (citiesPresentKeys(next).has(key)) continue;
    // Avoid duplicate pending inserts
    if (toInsert.some((c) => cityKeyOf(c) === key)) continue;
    toInsert.push(city);
  }

  // Group by chosen anchor, nearest-first within each group.
  const groups = new Map<number, TripPlanningJourneyCity[]>();
  for (const missing of toInsert) {
    const anchorIdx = pickAnchorIndex(next, missing);
    if (anchorIdx < 0) {
      next.push(missing);
      continue;
    }
    const list = groups.get(anchorIdx) ?? [];
    list.push(missing);
    groups.set(anchorIdx, list);
  }

  // Apply from the end so earlier indices stay stable.
  const sortedAnchors = [...groups.keys()].sort((a, b) => b - a);
  for (const anchorIdx of sortedAnchors) {
    const group = groups.get(anchorIdx) ?? [];
    if (group.length === 0) continue;
    // Recompute anchor on current path by key (index may have shifted only
    // for later anchors since we iterate descending).
    const anchor = next[anchorIdx];
    if (!anchor) continue;
    const windowEnd = stayWindowEnd(next, anchorIdx);
    group.sort(
      (a, b) => distanceBetween(anchor, a) - distanceBetween(anchor, b)
    );
    const detour: TripPlanningJourneyCity[] = [...group, { ...anchor }];
    next = [
      ...next.slice(0, windowEnd + 1),
      ...detour,
      ...next.slice(windowEnd + 1),
    ];
  }

  return next;
}

function buildLegsFromPath(
  path: TripPlanningJourneyCity[],
  userRoutes: TripRouteContext[]
): TripPlanningJourneyLeg[] {
  if (path.length < 2) return [];

  const sorted = [...userRoutes].sort((a, b) => a.order - b.order);
  const unused = [...sorted];
  const legs: TripPlanningJourneyLeg[] = [];

  for (let i = 0; i < path.length - 1; i += 1) {
    const from = path[i]!;
    const to = path[i + 1]!;
    const matchIdx = unused.findIndex(
      (route) => sameCity(route.from, from) && sameCity(route.to, to)
    );
    if (matchIdx >= 0) {
      const route = unused.splice(matchIdx, 1)[0]!;
      legs.push({
        order: i,
        from,
        to,
        source: "user",
        existingRouteId: route.id,
        transport: route.transport,
        ...(route.departure ? { departure: route.departure } : {}),
        ...(route.arrival ? { arrival: route.arrival } : {}),
        ...(route.durationMinutes != null
          ? { durationMinutes: route.durationMinutes }
          : {}),
        ...(route.note ? { note: route.note } : {}),
      });
    } else {
      legs.push({
        order: i,
        from,
        to,
        source: "ai_required",
        reason: `Missing inter-city connection required to visit ${to.city} in the selected destinations. Choose the most appropriate transport (train/bus/taxi/car/flight/etc.) — do not hardcode train.`,
      });
    }
  }

  // Append any unused user routes that did not match the path (should be rare).
  // Keep them as fixed user legs at the end so they are never dropped.
  for (const route of unused) {
    legs.push({
      order: legs.length,
      from: pointToCity(route.from),
      to: pointToCity(route.to),
      source: "user",
      existingRouteId: route.id,
      transport: route.transport,
      ...(route.departure ? { departure: route.departure } : {}),
      ...(route.arrival ? { arrival: route.arrival } : {}),
      ...(route.durationMinutes != null
        ? { durationMinutes: route.durationMinutes }
        : {}),
      note:
        route.note ??
        "User-created route preserved even though it was outside the primary city path.",
    });
  }

  return legs;
}

function journeySummary(
  citySequence: TripPlanningJourneyCity[],
  legs: TripPlanningJourneyLeg[]
): string {
  const cities = citySequence.map((c) => c.city).join(" → ");
  const missing = legs
    .filter((l) => l.source === "ai_required")
    .map((l) => `${l.from.city} → ${l.to.city}`)
    .join("; ");
  if (!missing) {
    return `Complete journey (user routes cover all selected destinations): ${cities}`;
  }
  return `Complete journey: ${cities}. AI must generate missing connections: ${missing}`;
}

/**
 * Construct the complete journey from fixed user routes + selected destinations.
 */
export function buildCompleteJourney(input: {
  origin: RoutePoint;
  destinations: RoutePoint[];
  routes: TripRouteContext[];
}): TripPlanningJourney {
  const basePath = cityPathFromRoutes(
    input.routes,
    input.origin,
    input.destinations
  );
  const citySequence = insertMissingDestinations(
    basePath,
    input.destinations
  );
  const legs = buildLegsFromPath(citySequence, input.routes);

  return {
    citySequence,
    legs,
    summary: journeySummary(citySequence, legs),
    missingConnectionCount: legs.filter((l) => l.source === "ai_required")
      .length,
  };
}

export function journeyCitiesMatch(
  a: { city?: string; name?: string; cityId?: string; placeId?: string },
  b: { city?: string; name?: string; cityId?: string; placeId?: string }
): boolean {
  const ka = normalizeCityKey(a);
  const kb = normalizeCityKey(b);
  return Boolean(ka && kb && ka === kb);
}
