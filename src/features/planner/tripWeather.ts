import type { ItineraryDayWeather } from "@/types/trip-planner";
import type {
  GetTripWeatherRequest,
  GetTripWeatherResult,
  TripWeatherDay,
} from "@/types/weather";
import { getTripWeather } from "@/services/functions";
import { addUtcDays, startOfUtcDay } from "@/services/trip-planner";
import type { TripDestinationStop, TripPlannerDoc } from "@/types/trip-planner";
import {
  destinationDateWindow,
  listTripDestinations,
  owningDestinationForDate,
  toIsoDate,
} from "./tripDestinations";

const WEATHER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ROUND_COORD = 3;

type CacheEntry = {
  result: GetTripWeatherResult;
  storedAt: number;
};

const weatherCache = new Map<string, CacheEntry>();
const weatherInflight = new Map<string, Promise<GetTripWeatherResult>>();

function roundCoord(value: number): number {
  const f = 10 ** ROUND_COORD;
  return Math.round(value * f) / f;
}

export function weatherCacheKey(input: {
  lat: number;
  lon: number;
  startDate: string;
  endDate: string;
  units?: "metric" | "imperial";
}): string {
  const units = input.units ?? "metric";
  return `${roundCoord(input.lat)}:${roundCoord(input.lon)}:${input.startDate}:${input.endDate}:${units}`;
}

function enumerateIsoDates(startDate: string, endDate: string): string[] {
  const start = startOfUtcDay(
    new Date(`${startDate}T00:00:00.000Z`)
  );
  const end = startOfUtcDay(new Date(`${endDate}T00:00:00.000Z`));
  const dates: string[] = [];
  let cursor = start;
  while (cursor.getTime() <= end.getTime()) {
    dates.push(toIsoDate(cursor));
    cursor = addUtcDays(cursor, 1);
    if (dates.length > 62) break;
  }
  return dates;
}

export function toDayWeather(
  day: TripWeatherDay,
  fetchedAt: string,
  units: "metric" | "imperial"
): ItineraryDayWeather {
  return {
    available: day.available,
    tempMin: day.tempMin,
    tempMax: day.tempMax,
    temp: day.temp,
    description: day.description,
    icon: day.icon,
    humidity: day.humidity,
    windSpeed: day.windSpeed,
    precipitationChance: day.precipitationChance,
    units,
    fetchedAt,
  };
}

export function unavailableDayWeather(
  fetchedAt: string,
  units: "metric" | "imperial" = "metric"
): ItineraryDayWeather {
  return {
    available: false,
    units,
    fetchedAt,
  };
}

export function isWeatherFresh(
  weather: ItineraryDayWeather | undefined
): boolean {
  if (!weather?.fetchedAt) return false;
  const age = Date.now() - Date.parse(weather.fetchedAt);
  return Number.isFinite(age) && age >= 0 && age < WEATHER_CACHE_TTL_MS;
}

function unavailableRange(
  request: GetTripWeatherRequest
): GetTripWeatherResult {
  const units = request.units ?? "metric";
  const fetchedAt = new Date().toISOString();
  return {
    success: true,
    units,
    lat: request.lat,
    lon: request.lon,
    cityName: request.cityName,
    days: enumerateIsoDates(request.startDate, request.endDate).map(
      (date) => ({
        date,
        available: false,
      })
    ),
    fetchedAt,
    note: "Weather unavailable after retry limit.",
  };
}

/**
 * OpenWeather via existing getTripWeather callable.
 * Dedupes in-flight + cached city/date/units. Limited exponential backoff.
 * Never calls OpenWeather from the browser.
 */
export async function fetchTripWeatherCached(
  request: GetTripWeatherRequest
): Promise<GetTripWeatherResult> {
  const units = request.units ?? "metric";
  const normalized: GetTripWeatherRequest = { ...request, units };
  const key = weatherCacheKey(normalized);
  const cached = weatherCache.get(key);
  if (
    cached &&
    Date.now() - cached.storedAt < WEATHER_CACHE_TTL_MS
  ) {
    return cached.result;
  }

  const pending = weatherInflight.get(key);
  if (pending) return pending;

  const task = (async () => {
    try {
      const result = await getTripWeather(normalized);
      weatherCache.set(key, { result, storedAt: Date.now() });
      return result;
    } catch (err) {
      console.warn("getTripWeather failed", err);
      return unavailableRange(normalized);
    }
  })();

  weatherInflight.set(key, task);
  try {
    return await task;
  } finally {
    weatherInflight.delete(key);
  }
}

export type DayWeatherPayload = {
  date: string;
  cityName?: string;
  available: boolean;
  tempMin?: number;
  tempMax?: number;
  temp?: number;
  description?: string;
  icon?: string;
  humidity?: number;
  windSpeed?: number;
  precipitationChance?: number;
  units?: "metric" | "imperial";
};

/**
 * Fetch forecasts for each trip city (city dates when set) and map onto
 * overall trip days. Reuses cache; does not invent weather.
 */
export async function weatherForTrip(
  trip: TripPlannerDoc
): Promise<{
  byIsoDate: Map<string, ItineraryDayWeather>;
  payload: DayWeatherPayload[];
}> {
  const destinations = listTripDestinations(trip);
  const tripStart = trip.startDate.toDate();
  const tripEnd = trip.endDate.toDate();
  const units = "metric" as const;
  const byIsoDate = new Map<string, ItineraryDayWeather>();
  const payload: DayWeatherPayload[] = [];
  const seenKeys = new Set<string>();

  const targets = destinations.filter(
    (dest) =>
      typeof dest.lat === "number" &&
      typeof dest.lon === "number" &&
      Number.isFinite(dest.lat) &&
      Number.isFinite(dest.lon)
  );

  if (targets.length === 0) {
    return { byIsoDate, payload };
  }

  const results = await Promise.all(
    targets.map(async (dest) => {
      const window = destinationDateWindow(dest, tripStart, tripEnd);
      const request: GetTripWeatherRequest = {
        lat: dest.lat as number,
        lon: dest.lon as number,
        startDate: toIsoDate(window.start),
        endDate: toIsoDate(window.end),
        units,
        cityName: dest.cityName,
      };
      const key = weatherCacheKey(request);
      if (seenKeys.has(key)) {
        return { dest, result: await fetchTripWeatherCached(request) };
      }
      seenKeys.add(key);
      return { dest, result: await fetchTripWeatherCached(request) };
    })
  );

  const start = startOfUtcDay(tripStart);
  const end = startOfUtcDay(tripEnd);
  let cursor = start;
  while (cursor.getTime() <= end.getTime()) {
    const iso = toIsoDate(cursor);
    const owner =
      owningDestinationForDate(destinations, cursor) ?? targets[0]!;
    const match = results.find(
      (row) =>
        row.dest.cityName === owner.cityName &&
        row.dest.countryName === owner.countryName
    ) ?? results[0]!;
    const forecast = match.result.days.find((d) => d.date === iso);
    const weather = forecast
      ? toDayWeather(forecast, match.result.fetchedAt, match.result.units)
      : unavailableDayWeather(match.result.fetchedAt, match.result.units);
    byIsoDate.set(iso, weather);
    payload.push({
      date: iso,
      cityName: owner.cityName,
      available: weather.available,
      tempMin: weather.tempMin,
      tempMax: weather.tempMax,
      temp: weather.temp,
      description: weather.description,
      icon: weather.icon,
      humidity: weather.humidity,
      windSpeed: weather.windSpeed,
      precipitationChance: weather.precipitationChance,
      units: weather.units,
    });
    cursor = addUtcDays(cursor, 1);
  }

  return { byIsoDate, payload };
}
