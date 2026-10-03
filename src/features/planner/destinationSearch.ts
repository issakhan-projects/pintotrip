import {
  cityCountryFromGeocodeResults,
  englishPlaceIdsFromNames,
} from "@/lib/maps/detectLocation";
import { geocodeByAddress } from "@/lib/maps/geocode";
import {
  PLACES_SEARCH_TTL_MS,
  cachedRequest,
  normalizeQuery,
} from "@/lib/maps/requestCache";
import { fetchPexelsCityPhoto } from "@/lib/pexels";
import { isAsciiId } from "@/lib/utils";

export type GeocodedPlace = {
  cityName: string;
  countryName: string;
  /** ISO 3166-1 alpha-2 when available from geocoder. */
  countryCode?: string;
  /** English/ASCII city slug when resolvable from the city-level name. */
  cityId?: string;
  /** English/ASCII country id (ISO lowercase when known). */
  countryId?: string;
  lat?: number;
  lon?: number;
  label: string;
  /** Pexels (or other external) image URLs for trip covers. */
  photos?: string[];
};

function fromGeocoderResult(
  result: google.maps.GeocoderResult
): GeocodedPlace | null {
  // City-level (Istanbul), not district (Fatih) — shared with map pick.
  const { city, country, countryCode } = cityCountryFromGeocodeResults([
    result,
  ]);
  const loc = result.geometry?.location;
  if (!loc || (!city && !country)) return null;
  const lat = typeof loc.lat === "function" ? loc.lat() : Number(loc.lat);
  const lon = typeof loc.lng === "function" ? loc.lng() : Number(loc.lng);
  const englishIds = englishPlaceIdsFromNames(city, country, countryCode);
  return {
    cityName: city || country,
    countryName: country || city,
    ...(countryCode && /^[A-Z]{2}$/.test(countryCode) ? { countryCode } : {}),
    ...(englishIds?.cityId && isAsciiId(englishIds.cityId)
      ? { cityId: englishIds.cityId }
      : {}),
    ...(englishIds?.countryId && isAsciiId(englishIds.countryId)
      ? { countryId: englishIds.countryId }
      : {}),
    lat,
    lon,
    label: [city || country, country || city].filter(Boolean).join(", "),
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
