/**
 * AI helpers to fill missing inter-city (and needed hub-transfer) routes.
 * Existing routes are never modified — AI only appends source:"generated" legs.
 */

import type {
  TripPlannerAiRequest,
  TripPlannerAiRequestDestination,
  TripPlannerAiResponseDay,
  TripPlannerAiResponseRoute,
} from "./tripPlannerAiTypes";
import {
  TRIP_ROUTE_TRANSPORTS,
  type RoutePoint,
  type TripRouteTransport,
} from "../types";

const TRANSPORT_SET = new Set<string>(TRIP_ROUTE_TRANSPORTS);

export const FILL_ROUTES_SYSTEM_PROMPT = `You fill EMPTY / missing trip routes so the traveler can complete the journey including home.

RULES:
1. PRESERVE every existing itinerary route exactly — do NOT rewrite, reorder, or change them.
2. Return ONLY new legs that are missing (source will be set to "generated" server-side).
3. Cover required city→city connections so every destination/transit city is reachable in a sensible order within trip.startDate–endDate.
4. When a destination has stopType "home" (origin/return city):
   - ALWAYS add an outbound intercity leg home → first destination/transit (near trip.startDate) if missing.
   - ALWAYS add a return intercity leg last destination/transit → home (near trip.endDate) if missing.
   - Prefer flight when home and the next city are in different countries or far apart.
   - Home MAY start/end at an airport hub (use home airports when provided). The first/last home leg is the flight/train itself — NOT a local hop to the airport.
   - NEVER add same-city local transfers involving home (no airport_transfer, bus, taxi, or metro between home city center ↔ home airport/station).
5. Use stay windows (cityInfo.startDate/endDate) when placing long-haul / intercity legs (e.g. leave after a stay ends).
6. Choose realistic transport for the corridor (train | bus | taxi | car | flight | metro | ferry | airport_transfer | other). Do NOT hardcode train.
7. Same-city bus / taxi / metro / airport_transfer ONLY for non-home cities, and ONLY when consecutive legs meet at different hubs (airport ↔ station). Never invent transfers without that need. Direction matters. Never for stopType=home.
8. Use hub pins from destination transport (airports / trainStations) when present — prefer IATA/station codes and lat/lon. Home may only list airports — use those as from/to for home flights.
9. from.city / to.city = display city names; include location when known.
10. departure/arrival: include timezone when known; set timeKnown=true ONLY when the clock time is truly known. Prefer approximate day anchors (timeKnown=false) over inventing exact times.
11. For non-flight NEW legs, include approximate one-way adult fare + official booking/timetable https link when known. NEVER invent flight price/link.
12. Respect spendMoney when choosing among realistic options: low → cheaper modes when comparable; high → faster/premium OK.
13. Do NOT schedule sightseeing places here — routes only.
14. Prefer fewer, necessary legs over redundant hops. Do not duplicate a connection that already exists (same from→to city/hub that day or already covered).

OUTPUT SCHEMA (strict JSON):
{
  "routes": [
    {
      "day": 1,
      "date": "YYYY-MM-DD",
      "transport": "train",
      "from": {
        "name": "",
        "city": "",
        "country": "",
        "code": "",
        "placeId": "",
        "location": { "lat": 0, "lon": 0 }
      },
      "to": {
        "name": "",
        "city": "",
        "country": "",
        "code": "",
        "placeId": "",
        "location": { "lat": 0, "lon": 0 }
      },
      "departure": { "datetime": "YYYY-MM-DDTHH:mm:ssZ", "timezone": "", "timeKnown": false },
      "arrival": { "datetime": "YYYY-MM-DDTHH:mm:ssZ", "timezone": "", "timeKnown": false },
      "priceAmount": 0,
      "priceCurrency": "USD",
      "priceLabel": "≈ 0 USD",
      "link": "https://..."
    }
  ]
}

If nothing is missing, return {"routes":[]}.`;

export function slimDestinationsForRoutesPrompt(
  destinations: Record<string, TripPlannerAiRequestDestination>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, dest] of Object.entries(destinations)) {
    if (!dest) continue;
    const cityId = (dest.cityId || key).trim().toLowerCase();
    if (!isAsciiId(cityId)) continue;

    const transport = dest.cityInfo?.transport;
    out[cityId] = {
      cityId,
      cityName: dest.cityName,
      countryId: dest.countryId,
      countryName: dest.countryName,
      stopType: dest.stopType,
      ...(dest.cityInfo
        ? {
            cityInfo: {
              ...(typeof dest.cityInfo.lat === "number"
                ? { lat: dest.cityInfo.lat }
                : {}),
              ...(typeof dest.cityInfo.lon === "number"
                ? { lon: dest.cityInfo.lon }
                : {}),
              ...(dest.cityInfo.timezone
                ? { timezone: dest.cityInfo.timezone }
                : {}),
              ...(dest.cityInfo.startDate
                ? { startDate: dest.cityInfo.startDate }
                : {}),
              ...(dest.cityInfo.endDate
                ? { endDate: dest.cityInfo.endDate }
                : {}),
              ...(transport
                ? {
                    transport: {
                      airports: (transport.airports ?? []).slice(0, 4).map((a) => ({
                        name: a.name,
                        ...(a.iataCode ? { code: a.iataCode } : {}),
                        ...(a.placeId ? { placeId: a.placeId } : {}),
                        location: a.location,
                      })),
                      trainStations: (transport.trainStations ?? [])
                        .slice(0, 4)
                        .map((s) => ({
                          name: s.name,
                          ...(s.placeId ? { placeId: s.placeId } : {}),
                          location: s.location,
                        })),
                    },
                  }
                : {}),
            },
          }
        : {}),
    };
  }
  return out;
}

export function slimItineraryRoutesForPrompt(
  itinerary: TripPlannerAiResponseDay[]
): unknown[] {
  return itinerary.map((day) => ({
    day: day.day,
    date: day.date,
    routes: (day.routes ?? []).map((r, routeIndex) => ({
      routeIndex,
      source: r.source,
      transport: r.transport,
      from: slimPoint(r.from),
      to: slimPoint(r.to),
      ...(r.departure ? { departure: r.departure } : {}),
      ...(r.arrival ? { arrival: r.arrival } : {}),
    })),
  }));
}

function slimPoint(p: RoutePoint): Record<string, unknown> {
  return {
    name: p.name,
    city: p.city,
    ...(p.country ? { country: p.country } : {}),
    ...(p.code ? { code: p.code } : {}),
    ...(p.placeId ? { placeId: p.placeId } : {}),
    ...(p.location ? { location: p.location } : {}),
  };
}

export function buildFillRoutesPayload(
  request: TripPlannerAiRequest,
  itinerary: TripPlannerAiResponseDay[],
  language?: string
): { system: string; user: string } {
  const home = Object.values(request.destinations).find(
    (d) => d?.stopType === "home"
  );
  const homeHint = home
    ? [
        "",
        `HOME ORIGIN/RETURN (stopType=home): ${home.cityName} (${home.cityId}).`,
        "Include missing outbound home→first city and return last city→home INTERCITY legs.",
        "Home legs may start/end at a home airport hub — do NOT add local airport_transfer/bus/taxi/metro at home.",
      ].join("\n")
    : "";

  const spendMoney = request.trip.spendMoney ?? "medium";
  const spendHint =
    spendMoney === "low"
      ? "prefer cheaper comparable modes"
      : spendMoney === "high"
        ? "faster/premium OK when realistic"
        : "typical tourist options";

  const user = [
    `Language for hub/city display names: ${language?.trim() || "en"}`,
    `Trip: ${request.trip.startDate} → ${request.trip.endDate}`,
    `Budget (spendMoney): ${spendMoney} — ${spendHint}`,
    request.trip.currency
      ? `Currency for non-flight fares when known: ${request.trip.currency}`
      : "Currency: local or USD when known",
    "",
    "DESTINATIONS (include home for origin/return — generate intercity legs involving home when missing; no local home transfers):",
    JSON.stringify(slimDestinationsForRoutesPrompt(request.destinations)),
    homeHint,
    "",
    "ITINERARY WITH EXISTING ROUTES ONLY (do not change these; add missing legs):",
    JSON.stringify(slimItineraryRoutesForPrompt(itinerary)),
    "",
    'Return JSON {"routes":[...]} with only NEW legs, or {"routes":[]} if complete.',
  ].join("\n");

  return { system: FILL_ROUTES_SYSTEM_PROMPT, user };
}

function isAsciiId(value: string): boolean {
  const id = value.trim().toLowerCase();
  if (!id || id === "unknown") return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t || null;
}

function asNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function asHttpUrl(value: unknown): string | null {
  const s = asString(value);
  if (!s || !/^https?:\/\//i.test(s)) return null;
  return s;
}

function parseTransport(value: unknown): TripRouteTransport | null {
  const s = asString(value)?.toLowerCase();
  if (!s || !TRANSPORT_SET.has(s)) return null;
  return s as TripRouteTransport;
}

function parsePoint(raw: unknown): RoutePoint | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = asString(o.name);
  const city = asString(o.city);
  if (!name || !city) return null;

  const country = asString(o.country) ?? undefined;
  const code = asString(o.code)?.toUpperCase() ?? undefined;
  const placeId = asString(o.placeId) ?? undefined;
  let location: { lat: number; lon: number } | undefined;
  if (o.location && typeof o.location === "object") {
    const loc = o.location as Record<string, unknown>;
    const lat = asNumber(loc.lat);
    const lon = asNumber(loc.lon);
    if (lat != null && lon != null) location = { lat, lon };
  }

  return {
    name,
    city,
    ...(country ? { country } : {}),
    ...(code ? { code } : {}),
    ...(placeId ? { placeId } : {}),
    ...(location ? { location } : {}),
  };
}

function parseInstant(
  raw: unknown
):
  | { datetime: string; timezone: string; timeKnown?: boolean }
  | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const datetime = asString(o.datetime);
  if (!datetime) return undefined;
  const timezone = asString(o.timezone) ?? "";
  const timeKnown =
    typeof o.timeKnown === "boolean" ? o.timeKnown : undefined;
  return {
    datetime,
    timezone,
    ...(timeKnown !== undefined ? { timeKnown } : {}),
  };
}

function routeKey(r: TripPlannerAiResponseRoute): string {
  const from =
    r.from.code?.toUpperCase() ||
    r.from.placeId ||
    `${r.from.city}|${r.from.name}`.toLowerCase();
  const to =
    r.to.code?.toUpperCase() ||
    r.to.placeId ||
    `${r.to.city}|${r.to.name}`.toLowerCase();
  return `${from}->${to}|${r.transport}`;
}

/**
 * Append AI-generated routes onto the skeleton itinerary.
 * Never mutates existing legs (source:"existing").
 */
export function mergeAiRoutesIntoItinerary(
  itinerary: TripPlannerAiResponseDay[],
  aiRaw: unknown
): TripPlannerAiResponseDay[] {
  if (!aiRaw || typeof aiRaw !== "object") return itinerary;
  const body = aiRaw as Record<string, unknown>;
  const routesRaw = Array.isArray(body.routes) ? body.routes : [];
  if (routesRaw.length === 0) return itinerary;

  const days = itinerary.map((day) => ({
    ...day,
    routes: [...(day.routes ?? [])],
  }));
  const byDate = new Map(days.map((d) => [d.date, d]));
  const byDayNum = new Map(days.map((d) => [d.day, d]));

  const existingKeys = new Set<string>();
  for (const day of days) {
    for (const r of day.routes) {
      existingKeys.add(routeKey(r));
    }
  }

  for (const row of routesRaw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const transport = parseTransport(o.transport);
    const from = parsePoint(o.from);
    const to = parsePoint(o.to);
    if (!transport || !from || !to) continue;

    const date = asString(o.date);
    const dayNum = asNumber(o.day);
    const target =
      (date ? byDate.get(date) : undefined) ??
      (dayNum != null ? byDayNum.get(Math.floor(dayNum)) : undefined) ??
      (date
        ? days.find((d) => d.date >= date) ?? days[days.length - 1]
        : undefined);
    if (!target) continue;

    const draft: TripPlannerAiResponseRoute = {
      from,
      to,
      transport,
      source: "generated",
    };

    const departure = parseInstant(o.departure);
    const arrival = parseInstant(o.arrival);
    if (departure) draft.departure = departure;
    if (arrival) draft.arrival = arrival;

    if (transport !== "flight") {
      const priceAmount = asNumber(o.priceAmount);
      const priceCurrency = asString(o.priceCurrency);
      const priceLabel = asString(o.priceLabel);
      const link = asHttpUrl(o.link);
      if (priceAmount != null && priceAmount >= 0) {
        draft.priceAmount = priceAmount;
      }
      if (priceCurrency && /^[A-Za-z]{3}$/.test(priceCurrency)) {
        draft.priceCurrency = priceCurrency.toUpperCase();
      }
      if (priceLabel) draft.priceLabel = priceLabel;
      if (link) draft.link = link;
    }

    const key = routeKey(draft);
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    target.routes.push(draft);
  }

  // Keep each day's routes roughly chronological when times exist.
  for (const day of days) {
    day.routes.sort((a, b) => {
      const at = a.departure?.datetime ?? a.arrival?.datetime ?? "";
      const bt = b.departure?.datetime ?? b.arrival?.datetime ?? "";
      if (at && bt) return at.localeCompare(bt);
      if (at) return -1;
      if (bt) return 1;
      return 0;
    });
  }

  return days;
}

const HOME_LOCAL_TRANSFER_TRANSPORTS = new Set<TripRouteTransport>([
  "airport_transfer",
  "bus",
  "taxi",
  "metro",
]);

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

function homeCityIds(
  destinations: Record<string, TripPlannerAiRequestDestination>
): Set<string> {
  const ids = new Set<string>();
  for (const [key, dest] of Object.entries(destinations)) {
    if (dest?.stopType !== "home") continue;
    const id = (dest.cityId || key).trim().toLowerCase();
    if (id) ids.add(id);
  }
  return ids;
}

function pointLooksLikeHomeCity(
  point: RoutePoint,
  homeIds: Set<string>,
  destinations: Record<string, TripPlannerAiRequestDestination>
): boolean {
  if (homeIds.size === 0) return false;

  for (const homeId of homeIds) {
    const dest = destinations[homeId];
    if (!dest) continue;
    const cityName = dest.cityName?.trim().toLowerCase();
    const pointCity = point.city?.trim().toLowerCase();
    if (cityName && pointCity && cityName === pointCity) return true;

    const airports = dest.cityInfo?.transport?.airports ?? [];
    const code = point.code?.trim().toUpperCase();
    const placeId = point.placeId?.trim();
    if (
      code &&
      airports.some((a) => a.iataCode?.trim().toUpperCase() === code)
    ) {
      return true;
    }
    if (placeId && airports.some((a) => a.placeId === placeId)) {
      return true;
    }
    if (
      typeof point.location?.lat === "number" &&
      typeof point.location?.lon === "number"
    ) {
      if (
        typeof dest.cityInfo?.lat === "number" &&
        typeof dest.cityInfo?.lon === "number" &&
        haversineKm(point.location, {
          lat: dest.cityInfo.lat,
          lon: dest.cityInfo.lon,
        }) < 80
      ) {
        return true;
      }
      for (const airport of airports) {
        if (
          airport.location &&
          haversineKm(point.location, airport.location) < 40
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function isSameCityLocalHop(route: TripPlannerAiResponseRoute): boolean {
  const fromCity = route.from.city?.trim().toLowerCase();
  const toCity = route.to.city?.trim().toLowerCase();
  if (fromCity && toCity && fromCity === toCity) return true;
  if (
    typeof route.from.location?.lat === "number" &&
    typeof route.from.location?.lon === "number" &&
    typeof route.to.location?.lat === "number" &&
    typeof route.to.location?.lon === "number"
  ) {
    return haversineKm(route.from.location, route.to.location) < 80;
  }
  return false;
}

/**
 * Drop generated local/hub transfers involving stopType=home.
 * Home intercity legs may start/end at an airport — without a preceding
 * city↔airport transfer.
 */
export function stripHomeLocalTransfers(
  itinerary: TripPlannerAiResponseDay[],
  destinations: Record<string, TripPlannerAiRequestDestination>
): TripPlannerAiResponseDay[] {
  const homeIds = homeCityIds(destinations);
  if (homeIds.size === 0) return itinerary;

  return itinerary.map((day) => ({
    ...day,
    routes: (day.routes ?? []).filter((route) => {
      if (route.source !== "generated") return true;
      if (!HOME_LOCAL_TRANSFER_TRANSPORTS.has(route.transport)) return true;

      const fromHome = pointLooksLikeHomeCity(
        route.from,
        homeIds,
        destinations
      );
      const toHome = pointLooksLikeHomeCity(route.to, homeIds, destinations);
      if (!fromHome && !toHome) return true;

      // airport_transfer involving home — always drop
      if (route.transport === "airport_transfer") return false;

      // Same-city hub hop at home (bus/taxi/metro) — drop
      if (fromHome && toHome && isSameCityLocalHop(route)) return false;

      // One end home + local transfer transport + short hop — drop
      if ((fromHome || toHome) && isSameCityLocalHop(route)) return false;

      return true;
    }),
  }));
}
