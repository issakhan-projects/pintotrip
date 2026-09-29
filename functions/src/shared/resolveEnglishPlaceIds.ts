/**
 * Resolve English/ASCII cityId + ISO countryId from coordinates.
 * Uses Google Geocoding (language=en) so localized display names never
 * become Firestore path keys.
 */

import { logger } from "firebase-functions";
import { googlePrivateApiKey } from "./config";

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

export type EnglishPlaceIds = {
  /** ISO 3166-1 alpha-2 lowercase (e.g. "sa"). */
  countryId: string;
  /** ISO 3166-1 alpha-2 uppercase (e.g. "SA"). */
  countryCode: string;
  /** English ASCII city slug (e.g. "makkah"). */
  cityId: string;
  cityNameEn?: string;
  countryNameEn?: string;
};

type GeocodeAddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

type GeocodeResult = {
  address_components?: GeocodeAddressComponent[];
};

type GeocodeResponse = {
  status?: string;
  results?: GeocodeResult[];
  error_message?: string;
};

function asciiSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isAsciiSlug(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === "unknown" || trimmed === "xx") return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed);
}

function componentByType(
  components: GeocodeAddressComponent[],
  type: string
): GeocodeAddressComponent | undefined {
  return components.find((c) => Array.isArray(c.types) && c.types.includes(type));
}

function parseEnglishPlaceIds(
  components: GeocodeAddressComponent[]
): EnglishPlaceIds | null {
  const country = componentByType(components, "country");
  const countryCode = country?.short_name?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{2}$/.test(countryCode)) return null;

  const cityLong =
    componentByType(components, "locality")?.long_name ||
    componentByType(components, "postal_town")?.long_name ||
    componentByType(components, "administrative_area_level_2")?.long_name ||
    componentByType(components, "administrative_area_level_1")?.long_name ||
    "";

  const citySlug = asciiSlug(cityLong);
  // Country alone is enough — city may be missing at ocean/rural coords.
  const cityId = isAsciiSlug(citySlug) ? citySlug : "nearby";
  const countryNameEn = country?.long_name?.trim() || undefined;

  return {
    countryId: countryCode.toLowerCase(),
    countryCode,
    cityId,
    ...(cityLong.trim() && isAsciiSlug(citySlug)
      ? { cityNameEn: cityLong.trim() }
      : {}),
    ...(countryNameEn ? { countryNameEn } : {}),
  };
}

/**
 * Reverse-geocode lat/lon with language=en → ISO countryId + ASCII cityId.
 * Soft-fails to null when the key is missing or Geocoding errors.
 */
export async function resolveEnglishPlaceIdsFromCoords(
  lat: number,
  lon: number
): Promise<EnglishPlaceIds | null> {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return null;
  }

  let apiKey = "";
  try {
    apiKey = googlePrivateApiKey.value();
  } catch {
    apiKey = "";
  }
  if (!apiKey) {
    logger.warn("resolveEnglishPlaceIds: GOOGLE_PRIVATE_API_KEY missing");
    return null;
  }

  try {
    const url = new URL(GEOCODE_URL);
    url.searchParams.set("latlng", `${lat},${lon}`);
    url.searchParams.set("language", "en");
    url.searchParams.set("key", apiKey);

    const response = await fetch(url.toString());
    const json = (await response.json()) as GeocodeResponse;

    if (!response.ok || (json.status && json.status !== "OK")) {
      logger.warn("resolveEnglishPlaceIds: geocode failed", {
        status: json.status,
        error: json.error_message,
        httpStatus: response.status,
      });
      return null;
    }

    const components = json.results?.[0]?.address_components;
    if (!components?.length) return null;

    return parseEnglishPlaceIds(components);
  } catch (err) {
    logger.warn("resolveEnglishPlaceIds: request error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
