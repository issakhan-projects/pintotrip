import { loadPlacesLibrary } from "@/lib/maps/loader";
import { fetchPexelsPhoto } from "@/lib/pexels";
import {
  PLACES_SEARCH_TTL_MS,
  cachedRequest,
  normalizeQuery,
} from "@/lib/maps/requestCache";

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

/** Stable id for Pexels query dedupe across a plan (not a Google Place id). */
function pexelsPhotoId(query: string, page = 1): string {
  const base = `pexels:${normalizeQuery(query)}`;
  return page > 1 ? `${base}:p${page}` : base;
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
 * Skips query keys already used in the same plan so nearby suggestions
 * don't reuse the same search page; falls back to page 2 when needed.
 * Returns null when no match — callers should keep UI fallbacks.
 */
export async function fetchSuggestedPlacePhoto(input: {
  title: string;
  cityName: string;
  countryName?: string;
  lat: number;
  lon: number;
  /** Photo query ids already assigned in this plan — avoid duplicate thumbs. */
  excludePlaceIds?: ReadonlySet<string>;
}): Promise<{ photoUrl: string; placeId: string } | null> {
  const title = input.title.trim();
  const cityName = input.cityName.trim();
  if (!title || !cityName) return null;

  const queries = [
    buildPhotoQuery([title, cityName, input.countryName]),
    buildPhotoQuery([title, cityName]),
    title,
  ].filter((q, i, arr) => q.length > 0 && arr.indexOf(q) === i);

  const exclude = input.excludePlaceIds;

  for (const query of queries) {
    for (const page of [1, 2] as const) {
      const placeId = pexelsPhotoId(query, page);
      if (exclude?.has(placeId)) continue;

      const photo = await fetchPexelsPhoto({ query, page });
      if (!photo?.url) continue;

      return { photoUrl: photo.url, placeId };
    }
  }

  return null;
}
