import { createHash } from "crypto";

/** Bump when prompt/schema changes invalidate prior cache entries. */
export const AI_CACHE_VERSION = 1;

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Stable fingerprint from ordered key/value pairs (undefined/null omitted). */
export function fingerprintParts(
  operation: string,
  parts: Record<string, string | number | boolean | undefined | null>
): string {
  const normalized: Record<string, string | number | boolean> = {
    op: operation,
    v: AI_CACHE_VERSION,
  };
  for (const key of Object.keys(parts).sort()) {
    const value = parts[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "string") {
      normalized[key] = value.trim().toLowerCase();
    } else {
      normalized[key] = value;
    }
  }
  return sha256Hex(JSON.stringify(normalized));
}

/** Round coordinates so near-identical map points share a cache key. */
export function roundCoord(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function findPlaceImageFingerprint(params: {
  imageContentHash: string;
  language: string;
}): string {
  return fingerprintParts("findPlace", {
    type: "image",
    imageHash: params.imageContentHash,
    language: params.language,
  });
}

export function findPlaceLinkFingerprint(params: {
  link: string;
  language: string;
}): string {
  return fingerprintParts("findPlace", {
    type: "link",
    link: params.link,
    language: params.language,
  });
}

/** Full city intelligence (includes user nationality / currency). */
export function cityIntelligenceFullFingerprint(params: {
  city: string;
  country: string;
  lat: number;
  lon: number;
  userCountry: string;
  userCurrency: string;
  language: string;
}): string {
  return fingerprintParts("getCityIntelligence", {
    scope: "full",
    city: params.city,
    country: params.country,
    lat: roundCoord(params.lat),
    lon: roundCoord(params.lon),
    userCountry: params.userCountry,
    userCurrency: params.userCurrency,
    language: params.language,
  });
}

/**
 * Slow-changing city facts (climate, transport, apps, etc.).
 * Excludes nationality / FX so they can be reused across travelers.
 */
export function cityIntelligenceSlowFingerprint(params: {
  city: string;
  country: string;
  lat: number;
  lon: number;
  language: string;
}): string {
  return fingerprintParts("getCityIntelligence", {
    scope: "slow",
    city: params.city,
    country: params.country,
    lat: roundCoord(params.lat),
    lon: roundCoord(params.lon),
    language: params.language,
  });
}

export function planTripFingerprint(params: {
  cityName: string;
  countryName: string;
  leisureType: string;
  language: string;
  currency: string;
  mode: string;
  emptyDaysKey: string;
  occupiedDaysKey: string;
  lat?: number;
  lon?: number;
}): string {
  return fingerprintParts("planTrip", {
    city: params.cityName,
    country: params.countryName,
    leisure: params.leisureType,
    language: params.language,
    currency: params.currency,
    mode: params.mode,
    empty: params.emptyDaysKey,
    occupied: params.occupiedDaysKey,
    lat:
      typeof params.lat === "number" ? roundCoord(params.lat) : undefined,
    lon:
      typeof params.lon === "number" ? roundCoord(params.lon) : undefined,
  });
}
