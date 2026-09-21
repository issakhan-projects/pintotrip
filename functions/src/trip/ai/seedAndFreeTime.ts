/**
 * Trip Planner AI — route-generation step only.
 *
 * Starts from TripPlannerAiRequest.itinerary (existing routes are fixed).
 * Never modifies those routes. Only inserts:
 * 1) missing *inter-city* connections so every destination city appears
 * 2) same-city *bus* transfers only when needed (e.g. airport ↔ station
 *    between consecutive legs at different hubs)
 * 3) places[] free-time windows per city (+ nested savedPlaces as locationId refs)
 *
 * Matching uses destination cityId / transport pins / proximity — never treats
 * Google Place IDs as city identities (airports/stations in the same city).
 */

import type {
  TripPlannerAiDestinationTransport,
  TripPlannerAiRequest,
  TripPlannerAiRequestDestination,
  TripPlannerAiRequestItineraryDay,
  TripPlannerAiResponse,
  TripPlannerAiResponseDay,
  TripPlannerAiResponseFreeTime,
  TripPlannerAiResponseNestedPlace,
  TripPlannerAiResponsePlace,
  TripPlannerAiResponseRoute,
  TripPlannerAiRoute,
  TripPlannerAiStopType,
} from "./tripPlannerAiTypes";
import type {
  RoutePoint,
  TripRouteTransport,
} from "../types";

/** Alias: seed helpers treat TripPlannerAiRoute like client TripRoute. */
type TripRoute = TripPlannerAiRoute;

type JourneyCity = {
  name: string;
  city: string;
  country?: string;
  cityId: string;
  countryId?: string;
  location?: { lat: number; lon: number };
  stopType?: TripPlannerAiStopType | "home";
};

type RouteFareHint = {
  priceAmount?: number;
  priceCurrency?: string;
  priceLabel?: string;
  link?: string;
};

type GeneratedDraft = {
  from: RoutePoint;
  to: RoutePoint;
  transport: TripRouteTransport;
  /** ISO day to attach this generated leg. */
  date: string;
};

const GEO_MATCH_KM = 80;
/** Hubs closer than this are treated as the same complex — no bus transfer. */
const HUB_TRANSFER_MIN_KM = 2;

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

/** ASCII slug city ids only — reject Google Place IDs (ChIJ…). */
function isUsableCityId(value: string | undefined | null): boolean {
  const id = value?.trim().toLowerCase() ?? "";
  if (!id || id === "unknown") return false;
  if (id.startsWith("chij")) return false;
  if (id.length > 48) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}

function slugifyAscii(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isoDateFromDatetime(datetime: string | undefined): string | null {
  if (!datetime?.trim()) return null;
  const match = datetime.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function listDestinations(
  destinations: Record<string, TripPlannerAiRequestDestination>
): TripPlannerAiRequestDestination[] {
  return Object.values(destinations);
}

function destinationCoords(
  dest: TripPlannerAiRequestDestination
): { lat: number; lon: number } | undefined {
  const info = dest.cityInfo;
  if (typeof info?.lat === "number" && typeof info?.lon === "number") {
    return { lat: info.lat, lon: info.lon };
  }
  const airport = info?.transport?.airports?.[0];
  if (airport?.location) return airport.location;
  const station = info?.transport?.trainStations?.[0];
  if (station?.location) return station.location;
  return undefined;
}

function destinationToCity(
  dest: TripPlannerAiRequestDestination
): JourneyCity | null {
  if (!isUsableCityId(dest.cityId)) return null;
  const location = destinationCoords(dest);
  return {
    name: dest.cityName,
    city: dest.cityName,
    country: dest.countryName,
    cityId: dest.cityId.trim().toLowerCase(),
    countryId: dest.countryId,
    ...(location ? { location } : {}),
    stopType: dest.stopType,
  };
}

function cityKeyOf(city: JourneyCity): string {
  return city.cityId;
}

function sameCity(a: JourneyCity, b: JourneyCity): boolean {
  return Boolean(a.cityId && b.cityId && a.cityId === b.cityId);
}

/**
 * Map a route endpoint (airport / station / city pin) onto a trip destination.
 * Never uses Google placeId as the city identity.
 */
function resolveDestinationForPoint(
  point: RoutePoint,
  destinations: TripPlannerAiRequestDestination[]
): TripPlannerAiRequestDestination | undefined {
  const placeId = point.placeId?.trim();
  const code = point.code?.trim().toUpperCase();

  // 1) Transport pin (airport / station) on a destination.
  for (const dest of destinations) {
    const tr = dest.cityInfo?.transport;
    if (!tr) continue;
    if (
      placeId &&
      tr.airports?.some((a) => a.placeId === placeId)
    ) {
      return dest;
    }
    if (
      placeId &&
      tr.trainStations?.some((s) => s.placeId === placeId)
    ) {
      return dest;
    }
    if (
      code &&
      tr.airports?.some(
        (a) => a.iataCode?.trim().toUpperCase() === code
      )
    ) {
      return dest;
    }
  }

  // 2) Exact display city name (supports localized names on the route).
  const cityName = point.city?.trim().toLowerCase();
  if (cityName) {
    const byName = destinations.find(
      (d) => d.cityName.trim().toLowerCase() === cityName
    );
    if (byName) return byName;
  }

  // 3) Nearest destination by coordinates.
  if (
    typeof point.location?.lat === "number" &&
    typeof point.location?.lon === "number"
  ) {
    let best: TripPlannerAiRequestDestination | undefined;
    let bestKm = GEO_MATCH_KM;
    for (const dest of destinations) {
      const loc = destinationCoords(dest);
      if (!loc) continue;
      const km = haversineKm(point.location, loc);
      if (km < bestKm) {
        bestKm = km;
        best = dest;
      }
    }
    if (best) return best;
  }

  // 4) ASCII slug of city/name if it equals a destination cityId.
  const slug = slugifyAscii(point.city || point.name || "");
  if (isUsableCityId(slug)) {
    const bySlug = destinations.find(
      (d) => d.cityId.trim().toLowerCase() === slug
    );
    if (bySlug) return bySlug;
  }

  return undefined;
}

function routePointToCity(
  point: RoutePoint,
  destinations: TripPlannerAiRequestDestination[]
): JourneyCity | null {
  const dest = resolveDestinationForPoint(point, destinations);
  if (!dest) return null;
  return destinationToCity(dest);
}

/**
 * Existing backbone routes in chronological order from the request itinerary
 * (plus any subcollection routes not yet placed).
 */
function collectExistingRoutesChronologically(
  request: TripPlannerAiRequest,
  explicitRoutes?: TripRoute[]
): Array<{ route: TripRoute; date: string }> {
  const ordered: Array<{ route: TripRoute; date: string }> = [];
  const seen = new Set<string>();

  for (const day of request.itinerary) {
    for (const slot of day.routes) {
      const route = slot.route;
      if (!route?.id || seen.has(route.id)) continue;
      seen.add(route.id);
      ordered.push({ route, date: day.date });
    }
  }

  const extras = [...(explicitRoutes ?? [])]
    .filter((r) => r?.id && !seen.has(r.id))
    .sort((a, b) => a.order - b.order);

  for (const route of extras) {
    const date =
      isoDateFromDatetime(route.departure?.datetime) ||
      isoDateFromDatetime(route.arrival?.datetime) ||
      request.trip.startDate;
    ordered.push({ route, date });
  }

  return ordered;
}

/**
 * City path from existing inter-city routes only.
 * Skips legs that cannot be resolved to destinations, and collapses
 * consecutive repeats of the same destination city.
 */
function cityPathFromExisting(
  existing: Array<{ route: TripRoute; date: string }>,
  destinations: TripPlannerAiRequestDestination[],
  home: TripPlannerAiRequestDestination | undefined
): JourneyCity[] {
  if (existing.length === 0) {
    const path: JourneyCity[] = [];
    const homeCity = home ? destinationToCity(home) : null;
    if (homeCity) path.push(homeCity);
    for (const dest of destinations) {
      if (dest.stopType === "home") continue;
      const city = destinationToCity(dest);
      if (!city) continue;
      if (path.length > 0 && sameCity(path[path.length - 1]!, city)) continue;
      path.push(city);
    }
    return path;
  }

  const path: JourneyCity[] = [];
  const push = (city: JourneyCity | null) => {
    if (!city) return;
    if (path.length > 0 && sameCity(path[path.length - 1]!, city)) return;
    path.push(city);
  };

  push(routePointToCity(existing[0]!.route.from, destinations));
  for (const { route } of existing) {
    // Only advance the path for inter-city legs.
    const fromCity = routePointToCity(route.from, destinations);
    const toCity = routePointToCity(route.to, destinations);
    if (fromCity && toCity && sameCity(fromCity, toCity)) {
      // Local airport/station transfer — ignore for journey path.
      continue;
    }
    push(toCity);
  }

  return path;
}

function distanceBetween(a: JourneyCity, b: JourneyCity): number {
  if (a.location && b.location) return haversineKm(a.location, b.location);
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

function pickAnchorIndex(path: JourneyCity[], missing: JourneyCity): number {
  let bestIdx = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < path.length; i += 1) {
    const candidate = path[i]!;
    let score = distanceBetween(candidate, missing);
    if (candidate.stopType === "destination") score -= 200;
    if (candidate.stopType === "transit") score -= 50;
    if (candidate.stopType === "home") score += 100;
    if (
      missing.countryId &&
      candidate.countryId &&
      missing.countryId === candidate.countryId
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

function stayWindowEnd(path: JourneyCity[], anchorIdx: number): number {
  const anchorKey = cityKeyOf(path[anchorIdx]!);
  let end = anchorIdx;
  for (let i = anchorIdx + 1; i < path.length; i += 1) {
    if (cityKeyOf(path[i]!) === anchorKey) {
      end = i;
      continue;
    }
    break;
  }
  return end;
}

function insertMissingDestinations(
  path: JourneyCity[],
  destinations: TripPlannerAiRequestDestination[]
): JourneyCity[] {
  let next = [...path];
  const present = () => new Set(next.map((c) => cityKeyOf(c)));

  const toInsert: JourneyCity[] = [];
  for (const dest of destinations) {
    if (dest.stopType === "home") continue;
    const city = destinationToCity(dest);
    if (!city) continue;
    if (present().has(city.cityId)) continue;
    if (toInsert.some((c) => c.cityId === city.cityId)) continue;
    toInsert.push(city);
  }

  const groups = new Map<number, JourneyCity[]>();
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

  const sortedAnchors = [...groups.keys()].sort((a, b) => b - a);
  for (const anchorIdx of sortedAnchors) {
    const group = groups.get(anchorIdx) ?? [];
    if (group.length === 0) continue;
    const anchor = next[anchorIdx];
    if (!anchor) continue;
    const windowEnd = stayWindowEnd(next, anchorIdx);
    group.sort(
      (a, b) => distanceBetween(anchor, a) - distanceBetween(anchor, b)
    );
    const detour: JourneyCity[] = [...group, { ...anchor }];
    next = [
      ...next.slice(0, windowEnd + 1),
      ...detour,
      ...next.slice(windowEnd + 1),
    ];
  }

  return next;
}

function findDestination(
  destinations: TripPlannerAiRequestDestination[],
  city: JourneyCity
): TripPlannerAiRequestDestination | undefined {
  return destinations.find(
    (d) => d.cityId.trim().toLowerCase() === city.cityId
  );
}

function isHttpUrl(value: string | undefined | null): value is string {
  return Boolean(value && /^https?:\/\//i.test(value.trim()));
}

/**
 * Copy price/link from an existing TripRoute when already set (e.g. by AI).
 * Never invents fares here; never attaches them to flights.
 */
function fareFromExistingRoute(route: TripRoute): RouteFareHint | undefined {
  if (route.transport === "flight") return undefined;
  const priceAmount =
    typeof route.priceAmount === "number" &&
    Number.isFinite(route.priceAmount) &&
    route.priceAmount >= 0
      ? route.priceAmount
      : undefined;
  const priceCurrency =
    typeof route.priceCurrency === "string" &&
    /^[A-Za-z]{3}$/.test(route.priceCurrency.trim())
      ? route.priceCurrency.trim().toUpperCase()
      : undefined;
  const priceLabel = route.priceLabel?.trim() || undefined;
  const link = isHttpUrl(route.link) ? route.link.trim() : undefined;
  if (priceAmount == null && !priceCurrency && !priceLabel && !link) {
    return undefined;
  }
  return {
    ...(priceAmount != null ? { priceAmount } : {}),
    ...(priceCurrency ? { priceCurrency } : {}),
    ...(priceLabel ? { priceLabel } : {}),
    ...(link ? { link } : {}),
  };
}

function withFareFields(
  base: TripPlannerAiResponseRoute,
  fare: RouteFareHint | undefined
): TripPlannerAiResponseRoute {
  if (!fare || base.transport === "flight") return base;
  return {
    ...base,
    ...(fare.priceAmount != null ? { priceAmount: fare.priceAmount } : {}),
    ...(fare.priceCurrency ? { priceCurrency: fare.priceCurrency } : {}),
    ...(fare.priceLabel ? { priceLabel: fare.priceLabel } : {}),
    ...(fare.link ? { link: fare.link } : {}),
  };
}

function pickTransport(
  fromDest: TripPlannerAiRequestDestination | undefined,
  toDest: TripPlannerAiRequestDestination | undefined,
  from: JourneyCity,
  to: JourneyCity
): TripRouteTransport {
  const fromTransport = fromDest?.cityInfo?.transport;
  const toTransport = toDest?.cityInfo?.transport;
  const dist = distanceBetween(from, to);
  const sameCountry =
    Boolean(from.countryId && to.countryId && from.countryId === to.countryId) ||
    Boolean(
      from.country &&
        to.country &&
        from.country.toLowerCase() === to.country.toLowerCase()
    );

  const fromHasTrain = (fromTransport?.trainStations?.length ?? 0) > 0;
  const toHasTrain = (toTransport?.trainStations?.length ?? 0) > 0;
  const fromHasAirport = (fromTransport?.airports?.length ?? 0) > 0;
  const toHasAirport = (toTransport?.airports?.length ?? 0) > 0;

  if (sameCountry && fromHasTrain && toHasTrain && dist < 1_200) return "train";
  if (fromHasAirport && toHasAirport && dist >= 250) return "flight";
  if (sameCountry && dist < 400) return "bus";
  if (fromHasAirport || toHasAirport) return "flight";
  if (fromHasTrain || toHasTrain) return "train";
  return dist >= 800 ? "flight" : "bus";
}

function endpointForCity(
  dest: TripPlannerAiRequestDestination | undefined,
  city: JourneyCity,
  transport: TripRouteTransport
): RoutePoint {
  const info = dest?.cityInfo;
  const tr: TripPlannerAiDestinationTransport | undefined = info?.transport;

  if (transport === "flight" && tr?.airports?.[0]) {
    const airport = tr.airports[0];
    return {
      name: airport.name,
      city: city.city,
      ...(city.country ? { country: city.country } : {}),
      placeId: airport.placeId,
      ...(airport.iataCode ? { code: airport.iataCode } : {}),
      location: airport.location,
    };
  }

  if (
    (transport === "train" || transport === "bus") &&
    tr?.trainStations?.[0]
  ) {
    const station = tr.trainStations[0];
    return {
      name: station.name,
      city: city.city,
      ...(city.country ? { country: city.country } : {}),
      placeId: station.placeId,
      location: station.location,
    };
  }

  return {
    name: city.name || city.city,
    city: city.city,
    ...(city.country ? { country: city.country } : {}),
    ...(city.location
      ? { location: city.location }
      : typeof info?.lat === "number" && typeof info?.lon === "number"
        ? { location: { lat: info.lat, lon: info.lon } }
        : {}),
  };
}

function addIsoDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function eachIsoDateInclusive(startIso: string, endIso: string): string[] {
  const start = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(`${endIso}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const from = start.getTime() <= end.getTime() ? start : end;
  const to = start.getTime() <= end.getTime() ? end : start;
  const dates: string[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) {
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${day}`);
  }
  return dates;
}

function clampDateToRange(
  date: string,
  rangeStart: string,
  rangeEnd: string
): string {
  if (date < rangeStart) return rangeStart;
  if (date > rangeEnd) return rangeEnd;
  return date;
}

/**
 * Existing arrival / departure calendar days for a destination city,
 * inferred from backbone routes that enter / leave that city.
 */
function stayBoundsForCity(
  cityId: string,
  existing: Array<{ route: TripRoute; date: string }>,
  destinations: TripPlannerAiRequestDestination[]
): { arrive: string | null; depart: string | null } {
  let arrive: string | null = null;
  let depart: string | null = null;
  for (const { route, date } of existing) {
    const toCity = routePointToCity(route.to, destinations);
    const fromCity = routePointToCity(route.from, destinations);
    if (toCity?.cityId === cityId) {
      if (!arrive || date < arrive) arrive = date;
    }
    if (fromCity?.cityId === cityId) {
      if (!depart || date > depart) depart = date;
    }
  }
  return { arrive, depart };
}

/**
 * Pick the itinerary day for a generated city→city leg using stay windows:
 * 1) destination cityInfo.startDate / endDate when set
 * 2) else split the free days between inbound arrival and outbound departure
 */
function dateForGeneratedLeg(input: {
  from: JourneyCity;
  to: JourneyCity;
  fromDest: TripPlannerAiRequestDestination;
  toDest: TripPlannerAiRequestDestination;
  existing: Array<{ route: TripRoute; date: string }>;
  destinations: TripPlannerAiRequestDestination[];
  tripStart: string;
  tripEnd: string;
  /** "outbound" = going to a newly inserted stay; "return" = coming back. */
  kind: "outbound" | "return" | "other";
}): string {
  const { from, to, fromDest, toDest, existing, destinations, tripStart, tripEnd, kind } =
    input;

  const toStart = toDest.cityInfo?.startDate?.trim();
  const fromEnd = fromDest.cityInfo?.endDate?.trim();

  // Prefer explicit destination stay windows when the user set them.
  if (kind === "outbound" && toStart) {
    return clampDateToRange(toStart, tripStart, tripEnd);
  }
  if (kind === "return" && fromEnd) {
    return clampDateToRange(fromEnd, tripStart, tripEnd);
  }

  // Infer free days at the anchor (city we're leaving on outbound / returning to).
  const anchorId = kind === "return" ? to.cityId : from.cityId;
  const bounds = stayBoundsForCity(anchorId, existing, destinations);
  const arrive = bounds.arrive || tripStart;
  const depart = bounds.depart || tripEnd;

  // If leaving an explicit stay window for a city that has no toStart,
  // travel on that city's endDate (e.g. Medina 2 days → leave on Medina end).
  if (kind === "outbound" && fromEnd) {
    const fromEndClamped = clampDateToRange(fromEnd, tripStart, tripEnd);
    // Only trust fromEnd when it falls strictly before the backbone departure day.
    if (!bounds.depart || fromEndClamped < bounds.depart) {
      return fromEndClamped;
    }
  }

  // Interior stay days after arrival, before departure (exclusive of depart day).
  const gapStart = addIsoDays(arrive, 1);
  const gapEnd = addIsoDays(depart, -1);
  if (gapStart > gapEnd) {
    return kind === "return"
      ? clampDateToRange(depart, tripStart, tripEnd)
      : clampDateToRange(arrive, tripStart, tripEnd);
  }

  const gapDays = eachIsoDateInclusive(gapStart, gapEnd);
  if (gapDays.length === 0) {
    return clampDateToRange(arrive, tripStart, tripEnd);
  }

  // Split stay: first half at anchor, second half for the detour city.
  // Outbound = first day of second half; return = last interior day.
  const mid = Math.floor(gapDays.length / 2);
  if (kind === "outbound") {
    return gapDays[mid] ?? gapDays[0]!;
  }
  if (kind === "return") {
    return gapDays[gapDays.length - 1]!;
  }

  if (toStart) return clampDateToRange(toStart, tripStart, tripEnd);
  if (fromEnd) return clampDateToRange(fromEnd, tripStart, tripEnd);
  return gapDays[mid] ?? gapDays[0]!;
}

/**
 * Emit only missing destination-city → destination-city legs.
 * Dates follow destination stay windows / inferred stay days — not piled on day 1.
 */
function findMissingGeneratedDrafts(
  path: JourneyCity[],
  existing: Array<{ route: TripRoute; date: string }>,
  destinations: TripPlannerAiRequestDestination[],
  tripStart: string,
  tripEnd: string
): GeneratedDraft[] {
  if (path.length < 2) return [];

  const unused = [...existing];
  const drafts: GeneratedDraft[] = [];
  /** cityIds that already appeared earlier on the path (helps detect return legs). */
  const seenEarlier = new Set<string>();

  for (let i = 0; i < path.length - 1; i += 1) {
    const from = path[i]!;
    const to = path[i + 1]!;
    if (sameCity(from, to)) {
      seenEarlier.add(from.cityId);
      continue;
    }

    const matchIdx = unused.findIndex(({ route }) => {
      const routeFrom = routePointToCity(route.from, destinations);
      const routeTo = routePointToCity(route.to, destinations);
      if (!routeFrom || !routeTo) return false;
      if (sameCity(routeFrom, routeTo)) return false;
      return sameCity(routeFrom, from) && sameCity(routeTo, to);
    });

    if (matchIdx >= 0) {
      unused.splice(matchIdx, 1);
      seenEarlier.add(from.cityId);
      seenEarlier.add(to.cityId);
      continue;
    }

    const fromDest = findDestination(destinations, from);
    const toDest = findDestination(destinations, to);
    if (!fromDest || !toDest) {
      seenEarlier.add(from.cityId);
      continue;
    }

    const toAlreadyVisited = seenEarlier.has(to.cityId);
    const kind: "outbound" | "return" | "other" = toAlreadyVisited
      ? "return"
      : "outbound";

    const transport = pickTransport(fromDest, toDest, from, to);
    const date = dateForGeneratedLeg({
      from,
      to,
      fromDest,
      toDest,
      existing,
      destinations,
      tripStart,
      tripEnd,
      kind,
    });

    drafts.push({
      from: endpointForCity(fromDest, from, transport),
      to: endpointForCity(toDest, to, transport),
      transport,
      date,
    });

    seenEarlier.add(from.cityId);
    seenEarlier.add(to.cityId);
  }

  return drafts;
}

function toExistingResponseRoute(route: TripRoute): TripPlannerAiResponseRoute {
  return withFareFields(
    {
      from: route.from,
      to: route.to,
      transport: route.transport,
      ...(route.departure
        ? {
            departure: {
              datetime: route.departure.datetime,
              timezone: route.departure.timezone,
              ...(typeof route.departure.timeKnown === "boolean"
                ? { timeKnown: route.departure.timeKnown }
                : {}),
            },
          }
        : {}),
      ...(route.arrival
        ? {
            arrival: {
              datetime: route.arrival.datetime,
              timezone: route.arrival.timezone,
              ...(typeof route.arrival.timeKnown === "boolean"
                ? { timeKnown: route.arrival.timeKnown }
                : {}),
            },
          }
        : {}),
      source: "existing",
    },
    fareFromExistingRoute(route)
  );
}

function toGeneratedResponseRoute(
  draft: GeneratedDraft
): TripPlannerAiResponseRoute {
  // Price/link for generated non-flight legs come from the AI planner — not invented here.
  return {
    from: draft.from,
    to: draft.to,
    transport: draft.transport,
    source: "generated",
  };
}

function seedDaysFromRequest(
  request: TripPlannerAiRequest
): TripPlannerAiResponseDay[] {
  const byDate = new Map<string, TripPlannerAiResponseDay>();

  for (const day of request.itinerary) {
    byDate.set(day.date, {
      day: day.day,
      date: day.date,
      places: [],
      routes: day.routes.map((slot) => toExistingResponseRoute(slot.route)),
    });
  }

  const allDates = eachIsoDateInclusive(
    request.trip.startDate,
    request.trip.endDate
  );

  return allDates.map((date, index) => {
    const existing = byDate.get(date);
    if (existing) {
      return {
        ...existing,
        day: index + 1,
        places: [],
      };
    }
    return {
      day: index + 1,
      date,
      places: [],
      routes: [],
    };
  });
}

function ensureExtraExistingOnDays(
  days: TripPlannerAiResponseDay[],
  requestDays: TripPlannerAiRequestItineraryDay[],
  existing: Array<{ route: TripRoute; date: string }>
): void {
  const already = new Set<string>();
  for (const day of requestDays) {
    for (const slot of day.routes) {
      if (slot.route?.id) already.add(slot.route.id);
    }
  }

  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const { route, date } of existing) {
    if (already.has(route.id)) continue;
    const day =
      byDate.get(date) ??
      days.find((d) => d.date >= date) ??
      days[days.length - 1];
    if (!day) continue;
    day.routes.push(toExistingResponseRoute(route));
  }
}

function insertGeneratedDrafts(
  days: TripPlannerAiResponseDay[],
  drafts: GeneratedDraft[],
  fallbackDate: string
): void {
  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const draft of drafts) {
    const date = draft.date || fallbackDate;
    const day =
      byDate.get(date) ??
      days.find((d) => d.date >= date) ??
      days[days.length - 1];
    if (!day) continue;
    day.routes.push(toGeneratedResponseRoute(draft));
  }
}

function sameHub(a: RoutePoint, b: RoutePoint): boolean {
  const aId = a.placeId?.trim();
  const bId = b.placeId?.trim();
  if (aId && bId && aId === bId) return true;

  const aCode = a.code?.trim().toUpperCase();
  const bCode = b.code?.trim().toUpperCase();
  if (aCode && bCode && aCode === bCode) return true;

  if (
    typeof a.location?.lat === "number" &&
    typeof a.location?.lon === "number" &&
    typeof b.location?.lat === "number" &&
    typeof b.location?.lon === "number"
  ) {
    return haversineKm(a.location, b.location) < HUB_TRANSFER_MIN_KM;
  }

  const aName = a.name?.trim().toLowerCase();
  const bName = b.name?.trim().toLowerCase();
  return Boolean(aName && bName && aName === bName);
}

/** True when consecutive legs meet in the same city at different hubs. */
function needsHubTransfer(arriveAt: RoutePoint, departFrom: RoutePoint): boolean {
  return !sameHub(arriveAt, departFrom);
}

function routeCoversTransfer(
  route: TripPlannerAiResponseRoute,
  from: RoutePoint,
  to: RoutePoint
): boolean {
  return sameHub(route.from, from) && sameHub(route.to, to);
}

function alreadyHasTransfer(
  days: TripPlannerAiResponseDay[],
  from: RoutePoint,
  to: RoutePoint
): boolean {
  for (const day of days) {
    for (const route of day.routes) {
      // Direction matters: IST→SAW outbound ≠ SAW→IST return.
      if (routeCoversTransfer(route, from, to)) return true;
    }
  }
  return false;
}

/**
 * Insert same-city bus transfers only when a later leg departs from a
 * different hub than where the traveler last arrived (airport↔station, etc.).
 * Never invents transfers without that need.
 */
function insertNeededBusTransfers(
  days: TripPlannerAiResponseDay[],
  destinations: TripPlannerAiRequestDestination[]
): void {
  type FlatLeg = {
    dayIdx: number;
    routeIdx: number;
    date: string;
    route: TripPlannerAiResponseRoute;
  };

  const flat: FlatLeg[] = [];
  for (let dayIdx = 0; dayIdx < days.length; dayIdx += 1) {
    const day = days[dayIdx]!;
    for (let routeIdx = 0; routeIdx < day.routes.length; routeIdx += 1) {
      flat.push({
        dayIdx,
        routeIdx,
        date: day.date,
        route: day.routes[routeIdx]!,
      });
    }
  }

  const lastArrivalByCity = new Map<
    string,
    { point: RoutePoint; date: string }
  >();

  type PendingTransfer = {
    dayIdx: number;
    /** Insert before this route index on that day. */
    beforeRouteIdx: number;
    from: RoutePoint;
    to: RoutePoint;
  };
  const pending: PendingTransfer[] = [];

  for (const leg of flat) {
    const fromCity = routePointToCity(leg.route.from, destinations);
    const toCity = routePointToCity(leg.route.to, destinations);

    if (fromCity) {
      const prev = lastArrivalByCity.get(fromCity.cityId);
      if (
        prev &&
        fromCity.stopType !== "home" &&
        needsHubTransfer(prev.point, leg.route.from) &&
        !alreadyHasTransfer(days, prev.point, leg.route.from)
      ) {
        pending.push({
          dayIdx: leg.dayIdx,
          beforeRouteIdx: leg.routeIdx,
          from: prev.point,
          to: leg.route.from,
        });
      }
    }

    // Inter-city departure leaves the origin city — clear hub memory.
    if (fromCity && toCity && !sameCity(fromCity, toCity)) {
      lastArrivalByCity.delete(fromCity.cityId);
    }

    if (toCity) {
      lastArrivalByCity.set(toCity.cityId, {
        point: leg.route.to,
        date: leg.date,
      });
    }
  }

  // Insert later indices first so earlier splices do not shift targets.
  pending.sort(
    (a, b) => b.dayIdx - a.dayIdx || b.beforeRouteIdx - a.beforeRouteIdx
  );

  for (const item of pending) {
    const day = days[item.dayIdx];
    if (!day) continue;
    if (alreadyHasTransfer(days, item.from, item.to)) continue;
    day.routes.splice(
      item.beforeRouteIdx,
      0,
      toGeneratedResponseRoute({
        from: item.from,
        to: item.to,
        transport: "bus",
        date: day.date,
      })
    );
  }
}

function parseInstantMs(iso: string | undefined): number | null {
  if (!iso?.trim()) return null;
  const ms = Date.parse(iso.trim());
  return Number.isFinite(ms) ? ms : null;
}

function durationMinutesBetween(
  start?: string,
  end?: string
): number | undefined {
  const a = parseInstantMs(start);
  const b = parseInstantMs(end);
  if (a == null || b == null || b <= a) return undefined;
  return Math.round((b - a) / 60_000);
}

/**
 * Hub overhead before departure / after arrival so free time does not run
 * until the flight (boarding) or start at the gate (disembark).
 * Aligned with timelineHelpers HUB_BUFFER_MINUTES.
 */
const FREE_TIME_HUB_BUFFER_MINUTES: Partial<
  Record<TripRouteTransport, number>
> = {
  flight: 90,
  train: 30,
  bus: 25,
  ferry: 40,
  metro: 15,
  taxi: 10,
  car: 15,
  airport_transfer: 20,
  other: 20,
};

function hubBufferMinutes(transport: TripRouteTransport): number {
  return FREE_TIME_HUB_BUFFER_MINUTES[transport] ?? 20;
}

function parseOffsetMinutes(iso: string): number {
  const trimmed = iso.trim();
  if (/Z$/i.test(trimmed)) return 0;
  const m = trimmed.match(/([+-])(\d{2}):?(\d{2})$/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

function formatWithOffset(utcMs: number, offsetMinutes: number): string {
  const local = new Date(utcMs + offsetMinutes * 60_000);
  const y = local.getUTCFullYear();
  const mo = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  const h = String(local.getUTCHours()).padStart(2, "0");
  const mi = String(local.getUTCMinutes()).padStart(2, "0");
  const s = String(local.getUTCSeconds()).padStart(2, "0");
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${oh}:${om}`;
}

function shiftIsoDatetime(
  iso: string | undefined,
  deltaMinutes: number
): string | undefined {
  if (!iso?.trim()) return undefined;
  const ms = parseInstantMs(iso);
  if (ms == null) return undefined;
  const offset = parseOffsetMinutes(iso);
  return formatWithOffset(ms + deltaMinutes * 60_000, offset);
}

/** Free time starts after arrival + disembark/ hub buffer. */
function freeTimeStartAfterArrival(
  arrivalIso: string | undefined,
  transport: TripRouteTransport
): string | undefined {
  return shiftIsoDatetime(arrivalIso, hubBufferMinutes(transport));
}

/** Free time ends before departure − boarding / hub buffer. */
function freeTimeEndBeforeDeparture(
  departureIso: string | undefined,
  transport: TripRouteTransport
): string | undefined {
  return shiftIsoDatetime(departureIso, -hubBufferMinutes(transport));
}

/** Soft usable-day estimate when the traveler stays in a city with no timed anchors. */
const APPROX_FULL_DAY_FREE_MINUTES = 12 * 60;

function buildFreeTime(
  start?: string,
  end?: string,
  opts?: { softFullDay?: boolean }
): TripPlannerAiResponseFreeTime {
  const trimmedStart = start?.trim() || undefined;
  const trimmedEnd = end?.trim() || undefined;
  const durationMinutes = durationMinutesBetween(trimmedStart, trimmedEnd);

  const freeTime: TripPlannerAiResponseFreeTime = {
    ...(trimmedStart ? { start: trimmedStart } : {}),
    ...(trimmedEnd ? { end: trimmedEnd } : {}),
    ...(durationMinutes != null && durationMinutes > 0
      ? { durationMinutes }
      : opts?.softFullDay && !trimmedStart && !trimmedEnd
        ? { durationMinutes: APPROX_FULL_DAY_FREE_MINUTES }
        : {}),
  };
  return freeTime;
}

function pushCityFreeTime(
  places: TripPlannerAiResponsePlace[],
  cityId: string,
  destinations: TripPlannerAiRequestDestination[],
  start?: string,
  end?: string,
  opts?: {
    softFullDay?: boolean;
    leisureType?: TripPlannerAiRequestDestination["leisureType"];
  }
): void {
  if (!isUsableCityId(cityId)) return;
  const dest = destinations.find(
    (d) => d.cityId.trim().toLowerCase() === cityId.trim().toLowerCase()
  );
  // Home is origin/return only — never emit free-time place slots.
  if (dest?.stopType === "home") return;

  const freeTime = buildFreeTime(start, end, opts);
  // After boarding/disembark buffers, window may be zero or inverted — skip.
  if (freeTime.start && freeTime.end) {
    const dur = durationMinutesBetween(freeTime.start, freeTime.end);
    if (dur == null || dur <= 0) return;
  }

  const leisureType = dest?.leisureType ?? opts?.leisureType;

  places.push({
    cityId: cityId.trim().toLowerCase(),
    freeTime,
    ...(leisureType ? { leisureType } : {}),
    places: nestedPlacesFromDestination(dest),
  });
}

/**
 * Attach places for a free-time city slot:
 * - savedPlaces (when non-empty) → `{ locationId }` only
 * - new/suggested places would use the full location payload (not invented here)
 */
function nestedPlacesFromDestination(
  dest: TripPlannerAiRequestDestination | undefined
): TripPlannerAiResponseNestedPlace[] {
  const saved = dest?.savedPlaces;
  if (!saved?.length) return [];
  return saved
    .map((p) => p.id?.trim())
    .filter((id): id is string => Boolean(id))
    .map((locationId) => ({ locationId }));
}

/**
 * Fill itinerary[].places from finalized routes.
 * One entry per city visit window on that day (a day may have multiple cities).
 * Free-time start/end come from arrival→departure anchors when known,
 * shrunk by hub buffers (e.g. flight boarding / disembark).
 * Nested places come from destinations.savedPlaces as `{ locationId }` when present.
 * Skips stopType === "home".
 */
function fillPlacesFromRoutes(
  days: TripPlannerAiResponseDay[],
  destinations: TripPlannerAiRequestDestination[],
  tripLeisureType?: TripPlannerAiRequestDestination["leisureType"]
): void {
  type Presence = { cityId: string; since?: string };
  let presence: Presence | null = null;
  const leisureFallback = { leisureType: tripLeisureType };

  for (const day of days) {
    const places: TripPlannerAiResponsePlace[] = [];

    for (const route of day.routes) {
      const fromCity = routePointToCity(route.from, destinations);
      const toCity = routePointToCity(route.to, destinations);
      const intercity = Boolean(
        fromCity && toCity && !sameCity(fromCity, toCity)
      );

      if (intercity && fromCity) {
        if (presence && presence.cityId === fromCity.cityId) {
          pushCityFreeTime(
            places,
            presence.cityId,
            destinations,
            presence.since,
            freeTimeEndBeforeDeparture(
              route.departure?.datetime,
              route.transport
            ),
            leisureFallback
          );
          presence = null;
        } else if (presence && presence.cityId !== fromCity.cityId) {
          // Stale presence — close without an end time.
          pushCityFreeTime(
            places,
            presence.cityId,
            destinations,
            presence.since,
            undefined,
            { softFullDay: !presence.since, ...leisureFallback }
          );
          presence = null;
        }
      }

      if (intercity && toCity) {
        // Don't track home as a free-time presence.
        if (toCity.stopType === "home") {
          presence = null;
        } else {
          const since = freeTimeStartAfterArrival(
            route.arrival?.datetime,
            route.transport
          );
          presence = {
            cityId: toCity.cityId,
            ...(since ? { since } : {}),
          };
        }
      } else if (!intercity) {
        // Same-city bus/transfer — stay present in that city.
        const hubCity = toCity ?? fromCity;
        if (hubCity && hubCity.stopType !== "home" && !presence) {
          presence = { cityId: hubCity.cityId };
        }
      }
    }

    if (presence) {
      pushCityFreeTime(
        places,
        presence.cityId,
        destinations,
        presence.since,
        undefined,
        { softFullDay: !presence.since, ...leisureFallback }
      );
      // Overnight stay continues; don't reuse yesterday's arrival as tomorrow's start.
      presence = { cityId: presence.cityId };
    }

    day.places = places;
  }
}

/**
 * Seed day itinerary with *existing* routes only (source: "existing").
 * Does not invent missing legs or free-time places — those come from AI +
 * {@link applyFreeTimePlacesFromRoutes}.
 */
export function seedTripPlannerAiItineraryExistingOnly(
  request: TripPlannerAiRequest,
  userRoutes?: TripRoute[]
): TripPlannerAiResponse {
  const existing = collectExistingRoutesChronologically(request, userRoutes);
  const days = seedDaysFromRequest(request);
  ensureExtraExistingOnDays(days, request.itinerary, existing);
  return { itinerary: days };
}

/**
 * After AI (or other) has finalized routes[], compute free-time windows and
 * attach savedPlaces as `{ locationId }` refs. Skips stopType === "home".
 */
export function applyFreeTimePlacesFromRoutes(
  request: TripPlannerAiRequest,
  itinerary: TripPlannerAiResponseDay[]
): TripPlannerAiResponseDay[] {
  const days = itinerary.map((day) => ({
    ...day,
    places: [] as TripPlannerAiResponsePlace[],
    routes: [...(day.routes ?? [])],
  }));
  fillPlacesFromRoutes(
    days,
    listDestinations(request.destinations),
    request.trip.leisureType
  );
  return days;
}

/**
 * Deterministic fallback: fill missing inter-city routes + bus transfers + places.
 * Prefer AI route fill via `/api/trip-planner/fill-places` in the app path.
 *
 * - Existing request routes are copied unchanged (source: "existing").
 * - Missing destination cities are inserted into the journey path.
 * - Only required city→city connections are added (source: "generated").
 * - Same-city bus transfers only when consecutive legs need a hub change
 *   (e.g. airport → train station).
 * - places[] = per-city free-time windows + nested savedPlaces refs.
 */
export function generateTripPlannerAiRoutes(
  request: TripPlannerAiRequest,
  userRoutes?: TripRoute[]
): TripPlannerAiResponse {
  const destinations = listDestinations(request.destinations);
  const home = destinations.find((d) => d.stopType === "home");

  const existing = collectExistingRoutesChronologically(request, userRoutes);
  const basePath = cityPathFromExisting(existing, destinations, home);
  const completePath = insertMissingDestinations(basePath, destinations);
  const missingDrafts = findMissingGeneratedDrafts(
    completePath,
    existing,
    destinations,
    request.trip.startDate,
    request.trip.endDate
  );

  const days = seedDaysFromRequest(request);
  ensureExtraExistingOnDays(days, request.itinerary, existing);
  insertGeneratedDrafts(days, missingDrafts, request.trip.startDate);
  insertNeededBusTransfers(days, destinations);
  fillPlacesFromRoutes(
    days,
    destinations,
    request.trip.leisureType
  );

  return { itinerary: days };
}
