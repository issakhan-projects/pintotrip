import { onCall, HttpsError } from "firebase-functions/https";
import { logger } from "firebase-functions";
import { requireAuth, assertNonEmptyString } from "../shared/auth";
import {
  DEFAULT_FUNCTIONS_REGION,
  openWeatherMapApiKey,
} from "../shared/config";
import type {
  GetTripWeatherRequest,
  GetTripWeatherResult,
  TripWeatherDay,
} from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TRIP_DAYS = 31;

type OwmForecastItem = {
  dt: number;
  main?: {
    temp?: number;
    temp_min?: number;
    temp_max?: number;
    humidity?: number;
  };
  weather?: Array<{ description?: string; icon?: string; id?: number }>;
  wind?: { speed?: number };
  pop?: number;
};

type OwmForecastResponse = {
  list?: OwmForecastItem[];
  city?: { name?: string; timezone?: number };
  message?: string | number;
  cod?: string | number;
};

function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value);
}

function parseIsoDateUtc(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
}

function toIsoDateUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function enumerateIsoDates(startDate: string, endDate: string): string[] {
  const start = parseIsoDateUtc(startDate);
  const end = parseIsoDateUtc(endDate);
  if (end.getTime() < start.getTime()) {
    throw new HttpsError(
      "invalid-argument",
      "endDate must be on or after startDate."
    );
  }

  const dates: string[] = [];
  let cursor = start;
  while (cursor.getTime() <= end.getTime()) {
    dates.push(toIsoDateUtc(cursor));
    if (dates.length > MAX_TRIP_DAYS) {
      throw new HttpsError(
        "invalid-argument",
        `Trip range cannot exceed ${MAX_TRIP_DAYS} days.`
      );
    }
    cursor = addUtcDays(cursor, 1);
  }
  return dates;
}

/** Local calendar date for a unix timestamp given city timezone offset (seconds). */
function localIsoDate(unixSeconds: number, timezoneOffsetSeconds: number): string {
  const localMs = (unixSeconds + timezoneOffsetSeconds) * 1000;
  return toIsoDateUtc(new Date(localMs));
}

function localHour(unixSeconds: number, timezoneOffsetSeconds: number): number {
  const localMs = (unixSeconds + timezoneOffsetSeconds) * 1000;
  return new Date(localMs).getUTCHours();
}

function parseRequest(data: unknown): GetTripWeatherRequest {
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request body is required.");
  }
  const body = data as Record<string, unknown>;

  const lat = body.lat;
  const lon = body.lon;
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new HttpsError("invalid-argument", "lat must be a finite number.");
  }
  if (
    typeof lon !== "number" ||
    !Number.isFinite(lon) ||
    lon < -180 ||
    lon > 180
  ) {
    throw new HttpsError("invalid-argument", "lon must be a finite number.");
  }

  assertNonEmptyString(body.startDate, "startDate");
  assertNonEmptyString(body.endDate, "endDate");
  if (!isIsoDate(body.startDate.trim()) || !isIsoDate(body.endDate.trim())) {
    throw new HttpsError(
      "invalid-argument",
      "startDate and endDate must be YYYY-MM-DD."
    );
  }

  const units =
    body.units === "imperial" || body.units === "metric"
      ? body.units
      : "metric";

  return {
    lat,
    lon,
    startDate: body.startDate.trim(),
    endDate: body.endDate.trim(),
    units,
    cityName:
      typeof body.cityName === "string" && body.cityName.trim()
        ? body.cityName.trim()
        : undefined,
  };
}

type DayBucket = {
  temps: number[];
  mins: number[];
  maxs: number[];
  humidity: number[];
  wind: number[];
  pops: number[];
  /** Prefer midday descriptions. */
  midday?: { hour: number; description: string; icon: string; temp: number };
  descriptions: Map<string, number>;
  icons: Map<string, number>;
};

function aggregateForecast(
  list: OwmForecastItem[],
  timezoneOffsetSeconds: number,
  tripDates: Set<string>
): Map<string, DayBucket> {
  const buckets = new Map<string, DayBucket>();

  for (const item of list) {
    if (typeof item.dt !== "number") continue;
    const date = localIsoDate(item.dt, timezoneOffsetSeconds);
    if (!tripDates.has(date)) continue;

    let bucket = buckets.get(date);
    if (!bucket) {
      bucket = {
        temps: [],
        mins: [],
        maxs: [],
        humidity: [],
        wind: [],
        pops: [],
        descriptions: new Map(),
        icons: new Map(),
      };
      buckets.set(date, bucket);
    }

    const temp = item.main?.temp;
    const tMin = item.main?.temp_min;
    const tMax = item.main?.temp_max;
    if (typeof temp === "number" && Number.isFinite(temp)) bucket.temps.push(temp);
    if (typeof tMin === "number" && Number.isFinite(tMin)) bucket.mins.push(tMin);
    if (typeof tMax === "number" && Number.isFinite(tMax)) bucket.maxs.push(tMax);
    if (
      typeof item.main?.humidity === "number" &&
      Number.isFinite(item.main.humidity)
    ) {
      bucket.humidity.push(item.main.humidity);
    }
    if (typeof item.wind?.speed === "number" && Number.isFinite(item.wind.speed)) {
      bucket.wind.push(item.wind.speed);
    }
    if (typeof item.pop === "number" && Number.isFinite(item.pop)) {
      bucket.pops.push(item.pop);
    }

    const weather = item.weather?.[0];
    const description = weather?.description?.trim();
    const icon = weather?.icon?.trim();
    if (description) {
      bucket.descriptions.set(
        description,
        (bucket.descriptions.get(description) ?? 0) + 1
      );
    }
    if (icon) {
      bucket.icons.set(icon, (bucket.icons.get(icon) ?? 0) + 1);
    }

    if (typeof temp === "number" && description && icon) {
      const hour = localHour(item.dt, timezoneOffsetSeconds);
      const score = Math.abs(hour - 12);
      if (!bucket.midday || score < Math.abs(bucket.midday.hour - 12)) {
        bucket.midday = { hour, description, icon, temp };
      }
    }
  }

  return buckets;
}

function mostCommon(map: Map<string, number>): string | undefined {
  let best: string | undefined;
  let count = -1;
  for (const [key, n] of map) {
    if (n > count) {
      best = key;
      count = n;
    }
  }
  return best;
}

function avg(nums: number[]): number | undefined {
  if (nums.length === 0) return undefined;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function toDay(
  date: string,
  bucket: DayBucket | undefined
): TripWeatherDay {
  if (!bucket || bucket.temps.length === 0) {
    return { date, available: false };
  }

  const tempMin = Math.min(...(bucket.mins.length ? bucket.mins : bucket.temps));
  const tempMax = Math.max(...(bucket.maxs.length ? bucket.maxs : bucket.temps));
  const temp = bucket.midday?.temp ?? avg(bucket.temps)!;
  const description =
    bucket.midday?.description ?? mostCommon(bucket.descriptions);
  const icon = bucket.midday?.icon ?? mostCommon(bucket.icons);
  const humidity = avg(bucket.humidity);
  const windSpeed = avg(bucket.wind);
  const pop = bucket.pops.length ? Math.max(...bucket.pops) : undefined;

  return {
    date,
    available: true,
    tempMin: round1(tempMin),
    tempMax: round1(tempMax),
    temp: round1(temp),
    ...(description ? { description } : {}),
    ...(icon ? { icon } : {}),
    ...(humidity != null ? { humidity: Math.round(humidity) } : {}),
    ...(windSpeed != null ? { windSpeed: round1(windSpeed) } : {}),
    ...(pop != null
      ? { precipitationChance: Math.round(Math.min(1, Math.max(0, pop)) * 100) }
      : {}),
  };
}

async function fetchOpenWeatherForecast(params: {
  lat: number;
  lon: number;
  units: "metric" | "imperial";
  apiKey: string;
}): Promise<OwmForecastResponse> {
  const url = new URL("https://api.openweathermap.org/data/2.5/forecast");
  url.searchParams.set("lat", String(params.lat));
  url.searchParams.set("lon", String(params.lon));
  url.searchParams.set("units", params.units);
  url.searchParams.set("appid", params.apiKey);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  const json = (await response.json()) as OwmForecastResponse;
  const cod = String(json.cod ?? response.status);
  if (!response.ok || cod !== "200") {
    const message =
      typeof json.message === "string"
        ? json.message
        : `OpenWeatherMap error (${cod}).`;
    throw new Error(message);
  }
  return json;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchOpenWeatherForecastWithRetry(params: {
  lat: number;
  lon: number;
  units: "metric" | "imperial";
  apiKey: string;
}): Promise<OwmForecastResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetchOpenWeatherForecast(params);
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (/Invalid API key|401|not configured/i.test(message)) {
        throw err;
      }
      if (attempt < 2) {
        await sleep(400 * 2 ** attempt);
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("OpenWeatherMap request failed.");
}

/**
 * getTripWeather
 *
 * Returns per-day forecast for the trip date range at destination coords.
 * Uses OpenWeatherMap 5-day / 3-hour forecast (server secret only).
 * Days outside the free forecast window are returned with available=false.
 */
export const getTripWeather = onCall(
  {
    region: DEFAULT_FUNCTIONS_REGION,
    secrets: [openWeatherMapApiKey],
    // Gen2 Cloud Run IAM: allow the client SDK to reach the endpoint.
    // Firebase Auth is still enforced via requireAuth below.
    invoker: "public",
    cors: true,
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request): Promise<GetTripWeatherResult> => {
    requireAuth(request);
    const input = parseRequest(request.data);

    const apiKey = openWeatherMapApiKey.value();
    if (!apiKey) {
      throw new HttpsError(
        "failed-precondition",
        "OPENWEATHERMAP_API_KEY is not configured for Cloud Functions."
      );
    }

    const tripDates = enumerateIsoDates(input.startDate, input.endDate);
    const tripDateSet = new Set(tripDates);

    try {
      const forecast = await fetchOpenWeatherForecastWithRetry({
        lat: input.lat,
        lon: input.lon,
        units: input.units ?? "metric",
        apiKey,
      });

      const timezoneOffset =
        typeof forecast.city?.timezone === "number" ? forecast.city.timezone : 0;
      const buckets = aggregateForecast(
        forecast.list ?? [],
        timezoneOffset,
        tripDateSet
      );

      const days = tripDates.map((date) => toDay(date, buckets.get(date)));
      const availableCount = days.filter((d) => d.available).length;
      const note =
        availableCount === 0
          ? "Forecast is only available for about the next 5 days. Check again closer to your trip."
          : availableCount < days.length
            ? "Some trip days are beyond the free 5-day forecast window."
            : undefined;

      logger.info("getTripWeather success", {
        lat: input.lat,
        lon: input.lon,
        dayCount: days.length,
        availableCount,
      });

      return {
        success: true,
        units: input.units ?? "metric",
        lat: input.lat,
        lon: input.lon,
        cityName: input.cityName || forecast.city?.name,
        days,
        fetchedAt: new Date().toISOString(),
        ...(note ? { note } : {}),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("getTripWeather failed", { message });

      if (/not configured|OPENWEATHERMAP/i.test(message)) {
        throw new HttpsError("failed-precondition", message);
      }
      if (/Invalid API key|401/i.test(message)) {
        throw new HttpsError(
          "failed-precondition",
          "OpenWeatherMap API key is invalid."
        );
      }
      throw new HttpsError(
        "internal",
        "Could not load weather forecast. Please try again."
      );
    }
  }
);
