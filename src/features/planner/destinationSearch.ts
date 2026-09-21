import { geocodeByAddress } from "@/lib/maps/geocode";
import {
  PLACES_SEARCH_TTL_MS,
  cachedRequest,
  normalizeQuery,
} from "@/lib/maps/requestCache";
import { fetchPexelsCityPhoto } from "@/lib/pexels";

export type GeocodedPlace = {
  cityName: string;
  countryName: string;
  /** ISO 3166-1 alpha-2 when available from geocoder. */
  countryCode?: string;
  lat?: number;
  lon?: number;
  label: string;
  /** Pexels (or other external) image URLs for trip covers. */
  photos?: string[];
};

function readComponent(
  components: google.maps.GeocoderAddressComponent[],
  type: string
): string {
  return (
    components.find((c) => c.types.includes(type))?.long_name?.trim() ?? ""
  );
}

function parseCityCountry(
  components: google.maps.GeocoderAddressComponent[]
): { cityName: string; countryName: string; countryCode: string } {
  const countryName =
    components.find((c) => c.types.includes("country"))?.long_name?.trim() ??
    "";
  const countryCode =
    components
      .find((c) => c.types.includes("country"))
      ?.short_name?.trim()
      .toUpperCase() ?? "";
  const cityName =
    readComponent(components, "locality") ||
    readComponent(components, "postal_town") ||
    readComponent(components, "administrative_area_level_2") ||
    readComponent(components, "administrative_area_level_1");
  return { cityName, countryName, countryCode };
}

function fromGeocoderResult(
  result: google.maps.GeocoderResult
): GeocodedPlace | null {
  const { cityName, countryName, countryCode } = parseCityCountry(
    result.address_components ?? []
  );
  const loc = result.geometry?.location;
  if (!loc || (!cityName && !countryName)) return null;
  const lat = typeof loc.lat === "function" ? loc.lat() : Number(loc.lat);
  const lon = typeof loc.lng === "function" ? loc.lng() : Number(loc.lng);
  return {
    cityName: cityName || countryName,
    countryName: countryName || cityName,
    ...(countryCode && /^[A-Z]{2}$/.test(countryCode) ? { countryCode } : {}),
    lat,
    lon,
    label: [cityName, countryName].filter(Boolean).join(", "),
  };
}

/**
 * Resolve a cover photo for a city destination via Pexels.
 * Same source as plan-place thumbs — no Google Places Text Search / Photos.
 */
export async function fetchDestinationPhotos(place: {
  cityName: string;
  countryName: string;
  lat?: number;
  lon?: number;
}): Promise<string[]> {
  const city = place.cityName.trim();
  const country = place.countryName.trim();
  if (!city && !country) return [];

  const photo = await fetchPexelsCityPhoto({
    cityName: city || country,
    countryName: country && country !== city ? country : undefined,
  });
  return photo?.url ? [photo.url] : [];
}

/**
 * Destination search via Google Geocoding (existing Maps integration).
 * Debounced by callers; results are cached + deduped here.
 * (Not Places Autocomplete — session tokens do not apply to Geocoding.)
 */
export async function autocompleteDestinations(
  query: string
): Promise<GeocodedPlace[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const key = `geocode:dest:${normalizeQuery(trimmed)}`;

  try {
    return await cachedRequest(key, PLACES_SEARCH_TTL_MS, async () => {
      const results = await geocodeByAddress(trimmed);
      const places: GeocodedPlace[] = [];
      for (const result of results.slice(0, 6)) {
        const place = fromGeocoderResult(result);
        if (place) places.push(place);
      }
      return places;
    });
  } catch {
    return [];
  }
}
