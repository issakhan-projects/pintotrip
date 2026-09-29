import { loadPlacesLibrary } from "@/lib/maps/loader";
import { fetchPexelsPhoto, fetchPexelsPhotos } from "@/lib/pexels";
import {
  PLACES_SEARCH_TTL_MS,
  cachedRequest,
  normalizeQuery,
} from "@/lib/maps/requestCache";
import {
  trackPlacesApiCacheHit,
  trackPlacesApiNetwork,
} from "@/lib/maps/placesApiUsage";

export type SearchedPlace = {
  placeId: string;
  title: string;
  cityName: string;
  countryName: string;
  address: string;
  lat: number;
  lon: number;
  /** Pexels image URL when resolved. */
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

function buildPhotoQuery(parts: Array<string | undefined | null>): string {
  return parts
    .map((p) => p?.trim() ?? "")
    .filter(Boolean)
    .join(", ");
}

/** Stable id for a concrete Pexels photo (dedupe by photo, not by query). */
function pexelsPhotoResultId(photo: {
  id?: number | null;
  url: string;
}): string {
  if (photo.id != null && Number.isFinite(photo.id)) {
    return `pexels:id:${photo.id}`;
  }
  return pexelsPhotoUrlExcludeId(photo.url);
}

/** Exclude key from an already-assigned image URL (itinerary / plan thumbs). */
export function pexelsPhotoUrlExcludeId(url: string): string {
  return `pexels:url:${normalizeQuery(url)}`;
}

function photoIsExcluded(
  photo: { id?: number | null; url: string },
  exclude?: ReadonlySet<string>
): boolean {
  if (!exclude || exclude.size === 0) return false;
  if (exclude.has(pexelsPhotoUrlExcludeId(photo.url))) return true;
  if (photo.id != null && Number.isFinite(photo.id)) {
    if (exclude.has(`pexels:id:${photo.id}`)) return true;
  }
  return false;
}

/** Find places by name via Google Places Text Search (cached + deduped). */
export async function searchPlacesByName(
  query: string,
  options?: { maxResultCount?: number }
): Promise<SearchedPlace[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const maxResultCount = Math.min(
    10,
    Math.max(1, options?.maxResultCount ?? 6)
  );
  const key = `places:search:${normalizeQuery(trimmed)}:n${maxResultCount}`;

  try {
    return await cachedRequest(
      key,
      PLACES_SEARCH_TTL_MS,
      async () => {
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
          maxResultCount,
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
      },
      {
        onNetworkFetch: () =>
          trackPlacesApiNetwork({
            kind: "textSearch",
            source: "add-place/searchPlacesByName",
            detail: { query: trimmed },
          }),
        onCacheHit: () =>
          trackPlacesApiCacheHit({
            kind: "textSearch",
            source: "add-place/searchPlacesByName",
            detail: { query: trimmed },
          }),
      }
    );
  } catch {
    return [];
  }
}

/**
 * Pexels photo for a named place (cached via fetchPexelsPhoto).
 * Used when saving / previewing a place from name search.
 */
export async function fetchPlacePhotoUrl(input: {
  title: string;
  cityName?: string;
  countryName?: string;
}): Promise<string | null> {
  const query = buildPhotoQuery([
    input.title,
    input.cityName,
    input.countryName,
  ]);
  if (!query) return null;
  const photo = await fetchPexelsPhoto({ query });
  return photo?.url ?? null;
}

/**
 * Resolve a Pexels photo for an AI-suggested place (title + city).
 * Prefer place-name queries first so thumbs match the landmark, not the city.
 * Picks the first photo whose id/url is not already used in this plan.
 * Returns null when no match — callers should keep UI fallbacks.
 */
export async function fetchSuggestedPlacePhoto(input: {
  title: string;
  cityName: string;
  countryName?: string;
  lat: number;
  lon: number;
  /**
   * Photo result ids already assigned in this plan (`pexels:id:…` / `pexels:url:…`).
   * Avoids the same stock image on every day place.
   */
  excludePlaceIds?: ReadonlySet<string>;
}): Promise<{ photoUrl: string; placeId: string } | null> {
  const title = input.title.trim();
  const cityName = input.cityName.trim();
  if (!title || !cityName) return null;

  // Title-first: "Burj Khalifa" beats "Burj Khalifa, Dubai, UAE" which often
  // ranks a generic Dubai skyline ahead of the landmark.
  const queries = [
    title,
    buildPhotoQuery([title, cityName]),
    buildPhotoQuery([title, cityName, input.countryName]),
  ].filter((q, i, arr) => q.length > 0 && arr.indexOf(q) === i);

  const exclude = input.excludePlaceIds;

  for (const query of queries) {
    const photos = await fetchPexelsPhotos({ query, perPage: 10 });
    for (const photo of photos) {
      if (!photo.url) continue;
      if (photoIsExcluded(photo, exclude)) continue;
      const placeId = pexelsPhotoResultId(photo);
      return { photoUrl: photo.url, placeId };
    }
  }

  return null;
}
