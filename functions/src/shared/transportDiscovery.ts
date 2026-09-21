/**
 * Transport discovery for trip destinations.
 *
 * Airports + train stations: Google Places Text Search (New).
 * Airports also get one IATA AI call per city.
 * Shared Firestore cache (`cityTransportCache`) skips Places when the city
 * was already discovered. Does not charge user AI credits.
 */

import { logger } from "firebase-functions";
import { createOpenAIClient, LOCATION_MODEL } from "./openai";
import { googlePrivateApiKey } from "./config";
import {
  cityTransportCacheKey,
  getCityTransportCache,
  setCityTransportCache,
  transportFromCacheEntry,
  type CityTransportCacheEntry,
} from "./cityTransportCache";

export type TripTransportType = "airport" | "train_station";

export type TripTransportLocation = {
  placeId: string;
  name: string;
  type: TripTransportType;
  location: {
    lat: number;
    lon: number;
  };
  address?: string;
  types?: string[];
  /** Google Maps place URL from Places API (Text Search). */
  googleMapsUri?: string;
};

export type TripAirport = {
  placeId: string;
  name: string;
  type: "airport";
  iataCode?: string | null;
  location: {
    lat: number;
    lon: number;
  };
  address?: string;
  types?: string[];
};

export type TripDestinationTransport = {
  airports: TripAirport[];
  trainStations?: TripTransportLocation[];
  lastCheckedAt: string;
};

export type TransportDestinationInput = {
  cityName: string;
  countryName?: string;
  cityId?: string;
  countryId?: string;
  lat?: number;
  lon?: number;
  transport?: TripDestinationTransport;
};

const PLACES_TEXT_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchText";

const TEXT_SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.formattedAddress",
  "places.types",
  "places.googleMapsUri",
].join(",");

const MAX_RESULTS = 10;
const IATA_MAX_TOKENS = 400;

const IATA_SYSTEM_PROMPT = `You are an airport identification service.

Given a city, country and a list of airport names, return the official IATA airport code for each airport.

Rules:
- Return strict JSON only.
- Preserve every input airport name exactly.
- Return exactly one result for every input airport.
- Use the standard 3-letter IATA airport code.
- Do not invent a code.
- If the IATA code cannot be confidently determined, return null.
- Do not add airports.
- Do not remove airports.
- Do not return explanations.

Schema:
{
  "airports": [
    {
      "name": "string",
      "iataCode": "string | null"
    }
  ]
}`;

type PlacesApiPlace = {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  location?: { latitude?: number; longitude?: number };
  formattedAddress?: string;
  types?: string[];
  googleMapsUri?: string;
};

type PlacesApiResponse = {
  places?: PlacesApiPlace[];
  error?: { message?: string; status?: string; code?: number };
};

type ModelIataAirport = {
  name?: string;
  iataCode?: string | null;
};

type ModelIataResponse = {
  airports?: ModelIataAirport[];
};

/** Places Table A type + natural-language query for Text Search. */
type TextSearchKind = {
  domainType: TripTransportType;
  includedType: "international_airport" | "train_station";
  queryNoun: string;
};

const AIRPORT_SEARCH: TextSearchKind = {
  domainType: "airport",
  includedType: "international_airport",
  queryNoun: "international airport",
};

const TRAIN_STATION_SEARCH: TextSearchKind = {
  domainType: "train_station",
  includedType: "train_station",
  queryNoun: "train station",
};

function hasUsableTransport(
  transport: TripDestinationTransport | undefined
): boolean {
  return Boolean(transport?.airports && transport.airports.length > 0);
}

function normalizeIata(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1]?.trim() || trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Expected a JSON object in model response.");
  }
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

function dedupeByPlaceId<T extends { placeId: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (!item.placeId || seen.has(item.placeId)) continue;
    seen.add(item.placeId);
    out.push(item);
  }
  return out;
}

function normalizePlace(
  place: PlacesApiPlace,
  type: TripTransportType,
  options?: { includeGoogleMapsUri?: boolean }
): TripTransportLocation | null {
  const placeId = typeof place.id === "string" ? place.id.trim() : "";
  const name =
    typeof place.displayName?.text === "string"
      ? place.displayName.text.trim()
      : "";
  const lat = place.location?.latitude;
  const lon = place.location?.longitude;
  if (
    !placeId ||
    !name ||
    typeof lat !== "number" ||
    !Number.isFinite(lat) ||
    typeof lon !== "number" ||
    !Number.isFinite(lon)
  ) {
    return null;
  }

  const address =
    typeof place.formattedAddress === "string" && place.formattedAddress.trim()
      ? place.formattedAddress.trim()
      : undefined;
  const types = Array.isArray(place.types)
    ? place.types.filter((t): t is string => typeof t === "string" && Boolean(t))
    : undefined;
  const googleMapsUri =
    typeof place.googleMapsUri === "string" && place.googleMapsUri.trim()
      ? place.googleMapsUri.trim()
      : undefined;

  return {
    placeId,
    name,
    type,
    location: { lat, lon },
    ...(address ? { address } : {}),
    ...(types && types.length > 0 ? { types } : {}),
    ...(options?.includeGoogleMapsUri && googleMapsUri
      ? { googleMapsUri }
      : {}),
  };
}

function buildTextQuery(
  kind: TextSearchKind,
  cityName: string,
  countryName?: string
): string {
  const country = (countryName || "").trim();
  return country
    ? `${kind.queryNoun} in ${cityName}, ${country}`
    : `${kind.queryNoun} in ${cityName}`;
}

/**
 * Places Text Search (New) for airports or train stations.
 * Query: "{international airport|train station} in {city}, {country}"
 */
async function searchPlacesByText(input: {
  cityName: string;
  countryName?: string;
  kind: TextSearchKind;
  includeGoogleMapsUri?: boolean;
}): Promise<TripTransportLocation[]> {
  const apiKey = googlePrivateApiKey.value();
  if (!apiKey) {
    throw new Error("GOOGLE_PRIVATE_API_KEY secret is not configured");
  }

  const city = input.cityName.trim();
  if (!city) return [];

  const body = {
    textQuery: buildTextQuery(input.kind, city, input.countryName),
    includedType: input.kind.includedType,
    maxResultCount: MAX_RESULTS,
  };

  const response = await fetch(PLACES_TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": TEXT_SEARCH_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json()) as PlacesApiResponse;
  if (!response.ok) {
    const message =
      json.error?.message ||
      `Places Text Search failed (${response.status})`;
    throw new Error(message);
  }

  const places = Array.isArray(json.places) ? json.places : [];
  const normalized: TripTransportLocation[] = [];
  for (const place of places) {
    const item = normalizePlace(place, input.kind.domainType, {
      includeGoogleMapsUri: input.includeGoogleMapsUri,
    });
    if (item) normalized.push(item);
  }
  return dedupeByPlaceId(normalized);
}

async function searchAirportsByText(input: {
  cityName: string;
  countryName?: string;
}): Promise<TripTransportLocation[]> {
  return searchPlacesByText({
    ...input,
    kind: AIRPORT_SEARCH,
  });
}

async function searchTrainStationsByText(input: {
  cityName: string;
  countryName?: string;
}): Promise<TripTransportLocation[]> {
  return searchPlacesByText({
    ...input,
    kind: TRAIN_STATION_SEARCH,
    includeGoogleMapsUri: true,
  });
}

/**
 * One AI request per city: airport names → IATA codes.
 * Never charges user credits.
 */
async function resolveAirportIataCodes(input: {
  cityName: string;
  countryName?: string;
  airportNames: string[];
}): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (input.airportNames.length === 0) return map;

  const client = createOpenAIClient();
  const userPayload = {
    city: input.cityName,
    country: input.countryName || "",
    airports: input.airportNames,
  };

  const completion = await client.chat.completions.create({
    model: LOCATION_MODEL,
    max_completion_tokens: IATA_MAX_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: IATA_SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify(userPayload),
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty model response for airport IATA enrichment.");
  }

  const parsed = extractJsonObject(content) as ModelIataResponse;
  const rows = Array.isArray(parsed.airports) ? parsed.airports : [];

  for (const name of input.airportNames) {
    map.set(name, null);
  }

  for (const row of rows) {
    if (typeof row.name !== "string" || !row.name.trim()) continue;
    const name = row.name.trim();
    if (!map.has(name)) continue;
    map.set(name, normalizeIata(row.iataCode));
  }

  return map;
}

function toAirports(
  places: TripTransportLocation[],
  iataByName: Map<string, string | null>
): TripAirport[] {
  return places.map((place) => ({
    placeId: place.placeId,
    name: place.name,
    type: "airport" as const,
    iataCode: iataByName.has(place.name)
      ? iataByName.get(place.name)!
      : null,
    location: place.location,
    ...(place.address ? { address: place.address } : {}),
    ...(place.types ? { types: place.types } : {}),
  }));
}

/**
 * Prefer existing usable transport over empty failed rediscovery.
 * Merge IATA onto existing airports when rediscovery returns the same placeIds.
 */
export function mergeTransportPreferExisting(
  existing: TripDestinationTransport | undefined,
  discovered: TripDestinationTransport | undefined
): TripDestinationTransport | undefined {
  if (!discovered) return existing;
  if (!existing) return discovered;

  if (hasUsableTransport(existing) && !hasUsableTransport(discovered)) {
    return existing;
  }

  if (!hasUsableTransport(discovered)) {
    return existing;
  }

  const existingIata = new Map(
    existing.airports.map((a) => [a.placeId, a.iataCode] as const)
  );

  const airports = discovered.airports.map((airport) => {
    const prev = existingIata.get(airport.placeId);
    if (
      (airport.iataCode == null || airport.iataCode === "") &&
      typeof prev === "string" &&
      prev
    ) {
      return { ...airport, iataCode: prev };
    }
    return airport;
  });

  const trainStations =
    discovered.trainStations ?? existing.trainStations;

  return {
    airports: dedupeByPlaceId(airports),
    ...(trainStations && trainStations.length > 0
      ? { trainStations: dedupeByPlaceId(trainStations) }
      : {}),
    lastCheckedAt: discovered.lastCheckedAt,
  };
}

async function writeTransportCache(params: {
  cacheKey: string;
  destination: TransportDestinationInput;
  airports: TripAirport[];
  trainStations?: TripTransportLocation[];
  airportsChecked: boolean;
  trainStationsChecked?: boolean;
  lastCheckedAt: string;
}): Promise<void> {
  await setCityTransportCache({
    cacheKey: params.cacheKey,
    input: {
      cityName: params.destination.cityName,
      countryName: params.destination.countryName,
      cityId: params.destination.cityId,
      countryId: params.destination.countryId,
    },
    airports: params.airports,
    trainStations: params.trainStations,
    airportsChecked: params.airportsChecked,
    trainStationsChecked: params.trainStationsChecked,
    lastCheckedAt: params.lastCheckedAt,
  });
}

/** Persist trip-local transport into the shared city cache (best-effort). */
async function backfillTransportCache(
  destination: TransportDestinationInput,
  transport: TripDestinationTransport,
  options: { includeTrainStations: boolean }
): Promise<void> {
  const cacheKey = cityTransportCacheKey(destination);
  if (!cacheKey) return;

  const existing = await getCityTransportCache(cacheKey);
  if (
    existing?.airportsChecked &&
    existing.airports.length > 0 &&
    (!options.includeTrainStations || existing.trainStationsChecked)
  ) {
    return;
  }

  await writeTransportCache({
    cacheKey,
    destination,
    airports:
      transport.airports.length > 0
        ? transport.airports
        : (existing?.airports ?? []),
    trainStations:
      options.includeTrainStations
        ? (transport.trainStations ?? existing?.trainStations ?? [])
        : existing?.trainStations,
    airportsChecked: true,
    trainStationsChecked: options.includeTrainStations
      ? true
      : existing?.trainStationsChecked,
    lastCheckedAt: transport.lastCheckedAt || new Date().toISOString(),
  });
}

/**
 * Discover airports (Text Search) + optional train stations (Text Search) for one city.
 * Only cityName is required (countryName improves query precision).
 * Reads/writes `cityTransportCache` so Places is skipped for known cities.
 */
export async function discoverDestinationTransport(
  destination: TransportDestinationInput,
  options: { includeTrainStations: boolean }
): Promise<TripDestinationTransport | undefined> {
  if (hasUsableTransport(destination.transport)) {
    void backfillTransportCache(
      destination,
      destination.transport!,
      options
    ).catch(() => undefined);
    return destination.transport;
  }

  const cityName =
    typeof destination.cityName === "string" ? destination.cityName.trim() : "";
  if (!cityName) {
    logger.info("transportDiscovery skipped: missing cityName", {
      cityId: destination.cityId,
    });
    return undefined;
  }

  const cacheKey = cityTransportCacheKey({
    cityName,
    countryName: destination.countryName,
    cityId: destination.cityId,
    countryId: destination.countryId,
  });

  let cached: CityTransportCacheEntry | null = null;
  if (cacheKey) {
    cached = await getCityTransportCache(cacheKey);
  }

  // Full cache hit: airports known; trains known or not needed.
  if (
    cached?.airportsChecked &&
    (!options.includeTrainStations || cached.trainStationsChecked)
  ) {
    logger.info("transportDiscovery cache hit", {
      cacheKey,
      cityName,
      airportCount: cached.airports.length,
      trainStationCount: cached.trainStations?.length ?? 0,
      includeTrainStations: options.includeTrainStations,
    });
    return transportFromCacheEntry(cached, options);
  }

  // Partial hit: reuse airports; Text Search trains only.
  if (
    cached?.airportsChecked &&
    options.includeTrainStations &&
    !cached.trainStationsChecked
  ) {
    logger.info("transportDiscovery cache partial — fetching train stations", {
      cacheKey,
      cityName,
      airportCount: cached.airports.length,
    });

    let trainStations: TripTransportLocation[] = [];
    try {
      trainStations = await searchTrainStationsByText({
        cityName,
        countryName: destination.countryName,
      });
    } catch (err) {
      logger.error("transportDiscovery train_station Text Search failed", {
        cityName,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const lastCheckedAt = new Date().toISOString();
    if (cacheKey) {
      await writeTransportCache({
        cacheKey,
        destination: { ...destination, cityName },
        airports: cached.airports,
        trainStations,
        airportsChecked: true,
        trainStationsChecked: true,
        lastCheckedAt,
      });
    }

    const merged: TripDestinationTransport = {
      airports: cached.airports,
      ...(trainStations.length > 0 ? { trainStations } : {}),
      lastCheckedAt,
    };
    if (!hasUsableTransport(merged) && trainStations.length === 0) {
      return undefined;
    }
    return merged;
  }

  let airportPlaces: TripTransportLocation[] = [];
  let airportsSearchOk = false;
  try {
    airportPlaces = await searchAirportsByText({
      cityName,
      countryName: destination.countryName,
    });
    airportsSearchOk = true;
  } catch (err) {
    logger.error("transportDiscovery airport Text Search failed", {
      cityName,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let trainStations: TripTransportLocation[] | undefined;
  let trainStationsChecked: boolean | undefined;
  if (options.includeTrainStations) {
    try {
      trainStations = await searchTrainStationsByText({
        cityName,
        countryName: destination.countryName,
      });
      trainStationsChecked = true;
    } catch (err) {
      logger.error("transportDiscovery train_station Text Search failed", {
        cityName,
        error: err instanceof Error ? err.message : String(err),
      });
      trainStations = undefined;
      trainStationsChecked = undefined;
    }
  }

  let iataByName = new Map<string, string | null>();
  if (airportPlaces.length > 0) {
    try {
      iataByName = await resolveAirportIataCodes({
        cityName,
        countryName: destination.countryName,
        airportNames: airportPlaces.map((p) => p.name),
      });
    } catch (err) {
      logger.error(
        "transportDiscovery IATA enrichment failed; saving without codes",
        {
          cityName,
          airportCount: airportPlaces.length,
          error: err instanceof Error ? err.message : String(err),
        }
      );
      for (const place of airportPlaces) {
        iataByName.set(place.name, null);
      }
    }
  }

  const airports = toAirports(airportPlaces, iataByName);
  const lastCheckedAt = new Date().toISOString();

  // Cache only after a successful Places response (including empty).
  if (cacheKey && airportsSearchOk) {
    await writeTransportCache({
      cacheKey,
      destination: { ...destination, cityName },
      airports,
      trainStations: trainStationsChecked ? trainStations ?? [] : undefined,
      airportsChecked: true,
      trainStationsChecked,
      lastCheckedAt,
    });
    logger.info("transportDiscovery cache write", {
      cacheKey,
      cityName,
      airportCount: airports.length,
      trainStationCount: trainStations?.length ?? 0,
      trainStationsChecked: Boolean(trainStationsChecked),
    });
  }

  if (airports.length === 0 && (!trainStations || trainStations.length === 0)) {
    return undefined;
  }

  return {
    airports,
    ...(options.includeTrainStations && trainStations
      ? { trainStations }
      : {}),
    lastCheckedAt,
  };
}

/**
 * Enrich every destination city. Continues on per-city failures.
 * Multi-city trips also discover train stations via Text Search.
 */
export async function discoverTransportForDestinations(
  destinations: TransportDestinationInput[]
): Promise<Array<TripDestinationTransport | undefined>> {
  const includeTrainStations = destinations.length > 1;
  const results: Array<TripDestinationTransport | undefined> = [];

  for (const destination of destinations) {
    try {
      const discovered = await discoverDestinationTransport(destination, {
        includeTrainStations,
      });
      results.push(
        mergeTransportPreferExisting(destination.transport, discovered)
      );
    } catch (err) {
      logger.error("transportDiscovery city failed; continuing", {
        cityName: destination.cityName,
        error: err instanceof Error ? err.message : String(err),
      });
      results.push(destination.transport);
    }
  }

  return results;
}
