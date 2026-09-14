import { loadPlacesLibrary } from "@/lib/maps/loader";
import { geocodeByAddress } from "@/lib/maps/geocode";
import {
  PLACE_PHOTOS_TTL_MS,
  PLACES_SEARCH_TTL_MS,
  cachedRequest,
  normalizeQuery,
  roundCoord,
} from "@/lib/maps/requestCache";

export type GeocodedPlace = {
  cityName: string;
  countryName: string;
  /** ISO 3166-1 alpha-2 when available from geocoder. */
  countryCode?: string;
  lat?: number;
  lon?: number;
  label: string;
  /** Google Place photo URIs for trip covers. */
  photos?: string[];
};

/** Enough for cover gallery; avoid requesting unused photo SKUs. */
const MAX_DESTINATION_PHOTOS = 4;
/** Cover / card display size — 1600 was over-fetching for UI use. */
const PHOTO_MAX_WIDTH = 1200;

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

function photoUrisFromPlace(
  place: google.maps.places.Place | undefined
): string[] {
  if (!place?.photos?.length) return [];
  const urls: string[] = [];
  for (const photo of place.photos.slice(0, MAX_DESTINATION_PHOTOS)) {
    try {
      const uri = photo.getURI({ maxWidth: PHOTO_MAX_WIDTH });
      if (uri) urls.push(uri);
    } catch {
      // Skip photos that fail to resolve a URI.
    }
  }
  return urls;
}

/**
 * Resolve Google Place photos for a city destination (search / map pick).
 * Cached; Place Details only if Text Search returned an id but no photos.
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

  const bias =
    place.lat != null && place.lon != null
      ? `${roundCoord(place.lat)}:${roundCoord(place.lon)}`
      : "";
  const key = `places:photos:${normalizeQuery([city, country].filter(Boolean).join(","))}:${bias}`;

  try {
    return await cachedRequest(key, PLACE_PHOTOS_TTL_MS, async () => {
      const { Place } = await loadPlacesLibrary();
      const textQuery = [city, country].filter(Boolean).join(", ");
      const { places } = await Place.searchByText({
        textQuery,
        fields: ["id", "photos", "displayName", "location"],
        includedType: "locality",
        maxResultCount: 1,
        ...(place.lat != null && place.lon != null
          ? { locationBias: { lat: place.lat, lng: place.lon } }
          : {}),
      });

      const photos = photoUrisFromPlace(places[0]);
      if (photos.length > 0) return photos;

      // Text Search already requested photos; empty usually means none exist.
      // Only fall back to Place Details when we have an id but photos were omitted.
      const placeId = places[0]?.id?.trim();
      if (!placeId || places[0]?.photos) return [];

      const detail = new Place({ id: placeId });
      await detail.fetchFields({ fields: ["photos"] });
      return photoUrisFromPlace(detail);
    });
  } catch {
    return [];
  }
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
