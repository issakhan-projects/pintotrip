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
} from "./types";
import {
  fetchTripWeatherForecast,
  isIsoDate,
} from "./openWeatherForecast";

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

    try {
      const result = await fetchTripWeatherForecast({
        lat: input.lat,
        lon: input.lon,
        startDate: input.startDate,
        endDate: input.endDate,
        units: input.units ?? "metric",
        cityName: input.cityName,
        apiKey,
      });

      logger.info("getTripWeather success", {
        lat: input.lat,
        lon: input.lon,
        dayCount: result.days.length,
        availableCount: result.days.filter((d) => d.available).length,
      });

      return {
        success: true,
        units: result.units,
        lat: result.lat,
        lon: result.lon,
        cityName: result.cityName,
        days: result.days,
        fetchedAt: result.fetchedAt,
        ...(result.note ? { note: result.note } : {}),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("getTripWeather failed", { message });

      if (/endDate must be|cannot exceed/i.test(message)) {
        throw new HttpsError("invalid-argument", message);
      }
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
