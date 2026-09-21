/**
 * Resolve IANA timezone id for coordinates.
 * Prefers Google Time Zone API; falls back to timeapi.io when Google is unavailable.
 * Example: Europe/Istanbul
 */

import { getGoogleMapsConfig } from "./config";
import { roundCoord } from "./requestCache";

const TIMEZONE_OK_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEZONE_MISS_TTL_MS = 60 * 1000;

type CacheEntry = {
  value: string | undefined;
  expiresAt: number;
};

const timezoneCache = new Map<string, CacheEntry>();
const timezoneInflight = new Map<string, Promise<string | undefined>>();

type GoogleTimezoneResponse = {
  status?: string;
  timeZoneId?: string;
  errorMessage?: string;
};

type TimeApiTimezoneResponse = {
  timeZone?: string;
};

function isIanaTimezone(value: string | undefined): value is string {
  const trimmed = value?.trim() ?? "";
  return trimmed.includes("/");
}

async function resolveViaGoogle(
  lat: number,
  lon: number
): Promise<string | undefined> {
  let apiKey: string;
  try {
    apiKey = getGoogleMapsConfig().apiKey;
  } catch {
    return undefined;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    location: `${lat},${lon}`,
    timestamp: String(timestamp),
    key: apiKey,
  });

  const response = await fetch(
    `https://maps.googleapis.com/maps/api/timezone/json?${params.toString()}`
  );
  if (!response.ok) return undefined;

  const json = (await response.json()) as GoogleTimezoneResponse;
  if (json.status !== "OK") return undefined;
  const id =
    typeof json.timeZoneId === "string" ? json.timeZoneId.trim() : "";
  return isIanaTimezone(id) ? id : undefined;
}

async function resolveViaTimeApi(
  lat: number,
  lon: number
): Promise<string | undefined> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
  });
  const response = await fetch(
    `https://timeapi.io/api/timezone/coordinate?${params.toString()}`
  );
  if (!response.ok) return undefined;
  const json = (await response.json()) as TimeApiTimezoneResponse;
  const id = typeof json.timeZone === "string" ? json.timeZone.trim() : "";
  return isIanaTimezone(id) ? id : undefined;
}

/**
 * Returns an IANA timezone string (e.g. "Europe/Istanbul"), or undefined
 * when coords are missing / no provider can resolve the zone.
 */
export async function resolveTimezoneFromCoords(
  lat: number,
  lon: number
): Promise<string | undefined> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;

  const key = `timezone:${roundCoord(lat, 3)},${roundCoord(lon, 3)}`;
  const now = Date.now();
  const hit = timezoneCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const pending = timezoneInflight.get(key);
  if (pending) return pending;

  const task = (async (): Promise<string | undefined> => {
    let resolved: string | undefined;
    try {
      resolved = await resolveViaGoogle(lat, lon);
    } catch {
      resolved = undefined;
    }
    if (!resolved) {
      try {
        resolved = await resolveViaTimeApi(lat, lon);
      } catch {
        resolved = undefined;
      }
    }

    timezoneCache.set(key, {
      value: resolved,
      expiresAt:
        Date.now() + (resolved ? TIMEZONE_OK_TTL_MS : TIMEZONE_MISS_TTL_MS),
    });
    return resolved;
  })();

  timezoneInflight.set(key, task);
  try {
    return await task;
  } finally {
    timezoneInflight.delete(key);
  }
}
