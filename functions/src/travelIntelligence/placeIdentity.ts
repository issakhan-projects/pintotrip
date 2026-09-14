/**
 * Deterministic place / city / country identity for Travel Intelligence.
 * No AI — grid + normalized title matching only.
 */

import { createHash } from "crypto";
import type { SourceLocation } from "./types";

/** ~111m grid — nearby pins of the same place collapse together. */
const COORD_PRECISION = 3;

export function normalizeTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugifyId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "unknown";
}

export function roundCoord(value: number, precision = COORD_PRECISION): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function resolveCountryId(
  country: { id?: string; name: string } | string
): string {
  if (typeof country === "string") {
    return slugifyId(country);
  }
  const id = country.id?.trim();
  if (id) return slugifyId(id);
  return slugifyId(country.name);
}

export function resolveCityId(
  city: { id?: string; name: string },
  countryId: string
): string {
  const local = city.id?.trim() ? slugifyId(city.id) : slugifyId(city.name);
  return `${countryId}_${local}`;
}

/**
 * Stable global place key from coordinates + city + country + title.
 * Location Firestore doc ids are user-specific auto-ids, so they are not used.
 */
export function buildPlaceId(input: {
  title: string;
  lat: number;
  lon: number;
  cityName: string;
  countryName: string;
  cityId?: string;
  countryId?: string;
}): string {
  const countryId =
    input.countryId?.trim() || resolveCountryId(input.countryName);
  const cityId =
    input.cityId?.trim() ||
    resolveCityId({ id: undefined, name: input.cityName }, countryId);
  const title = normalizeTitle(input.title);
  const lat = roundCoord(input.lat);
  const lon = roundCoord(input.lon);

  const raw = `${title}|${cityId}|${countryId}|${lat}|${lon}`;
  // Short hash keeps doc ids compact while remaining deterministic.
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 24);
  const titleSlug = slugifyId(title).slice(0, 40);
  return `${titleSlug}_${hash}`;
}

export function placeIdFromLocation(loc: SourceLocation): string {
  return buildPlaceId({
    title: loc.title,
    lat: loc.lat,
    lon: loc.lon,
    cityName: loc.city.name,
    countryName: loc.country.name,
    cityId: loc.city.id,
    countryId: loc.country.id,
  });
}

/**
 * Privacy-preserving link id for unique-user counters.
 * Does not store the raw userId in aggregate documents.
 */
export function uniqueLinkId(scopeId: string, userId: string): string {
  return createHash("sha256")
    .update(`${scopeId}:${userId}`)
    .digest("hex")
    .slice(0, 32);
}

/** Haversine distance in meters (for optional nearby checks). */
export function distanceMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Same physical place if titles match and coordinates are within ~150m. */
export const NEARBY_PLACE_METERS = 150;

export function isSamePhysicalPlace(
  a: { title: string; lat: number; lon: number },
  b: { title: string; lat: number; lon: number }
): boolean {
  if (normalizeTitle(a.title) !== normalizeTitle(b.title)) return false;
  return distanceMeters(a, b) <= NEARBY_PLACE_METERS;
}
