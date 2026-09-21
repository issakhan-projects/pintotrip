import type { ItineraryDayWeather } from "@/types/trip-planner";
import type { TripPlannerAiRequestDayWeather } from "@/types/trip-planner-ai-request";
import type {
  GetTripWeatherRequest,
  GetTripWeatherResult,
  TripWeatherDay,
} from "@/types/weather";
import type { TemperatureUnit } from "@/types/user";
import { getTripWeather } from "@/services/functions";
import { addUtcDays, startOfUtcDay } from "@/services/trip-planner";
import type { TripDestinationStop, TripPlannerDoc } from "@/types/trip-planner";
import { devLog } from "@/lib/devLog";
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

export function openWeatherUnitsFromTemperature(
  temperatureUnit?: TemperatureUnit
): "metric" | "imperial" {
  return temperatureUnit === "fahrenheit" ? "imperial" : "metric";
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
  const start = startOfUtcDay(new Date(`${startDate}T00:00:00.000Z`));
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
  if (cached && Date.now() - cached.storedAt < WEATHER_CACHE_TTL_MS) {
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
      devLog.warn("getTripWeather failed", err);
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
  cityId?: string;
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
  units: "metric" | "imperial";
};

function slimAiWeather(
  weather: ItineraryDayWeather,
  owner: TripDestinationStop
): TripPlannerAiRequestDayWeather {
  const cityId = owner.cityId?.trim().toLowerCase();
  return {
    available: weather.available,
    ...(cityId ? { cityId } : {}),
    ...(owner.cityName ? { cityName: owner.cityName } : {}),
    ...(weather.tempMin != null ? { tempMin: weather.tempMin } : {}),
    ...(weather.tempMax != null ? { tempMax: weather.tempMax } : {}),
    ...(weather.temp != null ? { temp: weather.temp } : {}),
    ...(weather.description ? { description: weather.description } : {}),
    ...(weather.icon ? { icon: weather.icon } : {}),
    ...(weather.humidity != null ? { humidity: weather.humidity } : {}),
    ...(weather.windSpeed != null ? { windSpeed: weather.windSpeed } : {}),
    ...(weather.precipitationChance != null
      ? { precipitationChance: weather.precipitationChance }
      : {}),
    units: weather.units ?? "metric",
  };
}

/**
 * Fetch forecasts for each trip city (city dates when set) and map onto
 * overall trip days. Reuses cache; does not invent weather.
 * Units follow the user's temperature preference (°C metric / °F imperial).
 */
export async function weatherForTrip(
  trip: TripPlannerDoc,
  options?: {
    units?: "metric" | "imperial";
    temperatureUnit?: TemperatureUnit;
  }
): Promise<{
  byIsoDate: Map<string, ItineraryDayWeather>;
  /** Slim rows ready for TripPlannerAiRequest.itinerary[].weather */
  aiByIsoDate: Map<string, TripPlannerAiRequestDayWeather>;
  payload: DayWeatherPayload[];
}> {
  const destinations = listTripDestinations(trip);
  const tripStart = trip.startDate.toDate();
  const tripEnd = trip.endDate.toDate();
  const units =
    options?.units ??
    openWeatherUnitsFromTemperature(options?.temperatureUnit);
  const byIsoDate = new Map<string, ItineraryDayWeather>();
  const aiByIsoDate = new Map<string, TripPlannerAiRequestDayWeather>();
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
    return { byIsoDate, aiByIsoDate, payload };
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
    const match =
      results.find(
        (row) =>
          row.dest.cityName === owner.cityName &&
          row.dest.countryName === owner.countryName
      ) ?? results[0]!;
    const forecast = match.result.days.find((d) => d.date === iso);
    const weather = forecast
      ? toDayWeather(forecast, match.result.fetchedAt, match.result.units)
      : unavailableDayWeather(match.result.fetchedAt, match.result.units);
    const aiWeather = slimAiWeather(weather, owner);
    byIsoDate.set(iso, weather);
    aiByIsoDate.set(iso, aiWeather);
    payload.push({
      date: iso,
      ...(owner.cityId ? { cityId: owner.cityId } : {}),
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
      units: weather.units ?? units,
    });
    cursor = addUtcDays(cursor, 1);
  }

  return { byIsoDate, aiByIsoDate, payload };
}
