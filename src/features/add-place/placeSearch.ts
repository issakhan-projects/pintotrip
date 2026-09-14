import { loadPlacesLibrary } from "@/lib/maps/loader";
import {
  PLACE_PHOTOS_TTL_MS,
  PLACES_SEARCH_TTL_MS,
  cachedRequest,
  normalizeQuery,
  roundCoord,
} from "@/lib/maps/requestCache";

/** Place list / detail thumbnail — matches destination cover fetch size. */
const PHOTO_MAX_WIDTH = 1200;

/** Max distance (km) when matching a planned place to a Google result. */
const SUGGEST_PHOTO_MATCH_KM = 5;

function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type SearchedPlace = {
  placeId: string;
  title: string;
  address: string;
  cityName: string;
  countryName: string;
  lat: number;
  lon: number;
  /** Google Place photo URI when available. */
  photoUrl?: string;
};

function readComponent(
  components: google.maps.places.AddressComponent[] | undefined,
  type: string
): string {
  return (
    components?.find((c) => c.types.includes(type))?.longText?.trim() ?? ""
  );
}

function parseCityCountry(
  components: google.maps.places.AddressComponent[] | undefined
): { cityName: string; countryName: string } {
  const countryName = readComponent(components, "country");
  const cityName =
    readComponent(components, "locality") ||
    readComponent(components, "postal_town") ||
    readComponent(components, "administrative_area_level_2") ||
    readComponent(components, "administrative_area_level_1");
  return { cityName, countryName };
}

function toLatLng(location: google.maps.LatLng | google.maps.LatLngLiteral): {
  lat: number;
  lon: number;
} | null {
  if (!location) return null;
  if (typeof (location as google.maps.LatLng).lat === "function") {
    const ll = location as google.maps.LatLng;
    return { lat: ll.lat(), lon: ll.lng() };
  }
  const literal = location as google.maps.LatLngLiteral;
  if (typeof literal.lat !== "number" || typeof literal.lng !== "number") {
    return null;
  }
  return { lat: literal.lat, lon: literal.lng };
}

/** Find places by name via Google Places Text Search (cached + deduped). */
export async function searchPlacesByName(
  query: string
): Promise<SearchedPlace[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const key = `places:search:${normalizeQuery(trimmed)}`;

  try {
    return await cachedRequest(key, PLACES_SEARCH_TTL_MS, async () => {
      const { Place } = await loadPlacesLibrary();
      // Field mask: only what the add-place UI needs. No Place Details per suggestion.
      const { places } = await Place.searchByText({
        textQuery: trimmed,
        fields: [
          "id",
          "displayName",
          "formattedAddress",
          "location",
          "addressComponents",
        ],
        maxResultCount: 6,
      });

      const results: SearchedPlace[] = [];
      for (const place of places) {
        const coords = place.location ? toLatLng(place.location) : null;
        const placeId = place.id?.trim();
        const title = place.displayName?.trim();
        if (!coords || !placeId || !title) continue;

        const { cityName, countryName } = parseCityCountry(
          place.addressComponents
        );
        results.push({
          placeId,
          title,
          address: place.formattedAddress?.trim() || title,
          cityName: cityName || countryName || "Unknown",
          countryName: countryName || cityName || "Unknown",
          lat: coords.lat,
          lon: coords.lon,
        });
      }
      return results;
    });
  } catch {
    return [];
  }
}

/**
 * First Google Place photo URI for a known place id (cached).
 * Used when saving a place from name search.
 */
export async function fetchPlacePhotoUrl(
  placeId: string
): Promise<string | null> {
  const id = placeId.trim();
  if (!id) return null;

  const key = `places:photo:${normalizeQuery(id)}`;

  try {
    return await cachedRequest(key, PLACE_PHOTOS_TTL_MS, async () => {
      const { Place } = await loadPlacesLibrary();
      const place = new Place({ id });
      await place.fetchFields({ fields: ["photos"] });
      const photo = place.photos?.[0];
      if (!photo) return null;
      try {
        return photo.getURI({ maxWidth: PHOTO_MAX_WIDTH }) || null;
      } catch {
        return null;
      }
    });
  } catch {
    return null;
  }
}

/**
 * Resolve a Google Place photo for an AI-suggested place (title + coords).
 * Uses Text Search with a location bias, then the first photo when available.
 * Returns null when no nearby match or photo exists — callers should keep UI fallbacks.
 */
export async function fetchSuggestedPlacePhoto(input: {
  title: string;
  cityName: string;
  countryName?: string;
  lat: number;
  lon: number;
}): Promise<string | null> {
  const title = input.title.trim();
  const cityName = input.cityName.trim();
  if (!title || !Number.isFinite(input.lat) || !Number.isFinite(input.lon)) {
    return null;
  }

  const country = input.countryName?.trim() ?? "";
  const textQuery = [title, cityName, country].filter(Boolean).join(", ");
  const key = `places:suggest-photo:${normalizeQuery(textQuery)}:${roundCoord(input.lat)}:${roundCoord(input.lon)}`;

  try {
    return await cachedRequest(key, PLACE_PHOTOS_TTL_MS, async () => {
      const { Place } = await loadPlacesLibrary();
      const { places } = await Place.searchByText({
        textQuery,
        fields: ["id", "displayName", "location", "photos"],
        maxResultCount: 5,
        locationBias: {
          center: { lat: input.lat, lng: input.lon },
          radius: SUGGEST_PHOTO_MATCH_KM * 1000,
        },
      });

      const target = { lat: input.lat, lon: input.lon };
      let bestId: string | null = null;
      let bestPhotoUrl: string | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const place of places) {
        const placeId = place.id?.trim();
        const coords = place.location ? toLatLng(place.location) : null;
        if (!placeId || !coords) continue;

        const km = distanceKm(target, coords);
        if (km > SUGGEST_PHOTO_MATCH_KM || km >= bestDistance) continue;

        bestDistance = km;
        bestId = placeId;
        const photo = place.photos?.[0];
        if (photo) {
          try {
            bestPhotoUrl = photo.getURI({ maxWidth: PHOTO_MAX_WIDTH }) || null;
          } catch {
            bestPhotoUrl = null;
          }
        } else {
          bestPhotoUrl = null;
        }
      }

      if (bestPhotoUrl) return bestPhotoUrl;
      if (!bestId) return null;
      return fetchPlacePhotoUrl(bestId);
    });
  } catch {
    return null;
  }
}
