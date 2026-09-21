import { geocodeByAddress } from "@/lib/maps";
import { resolveCountryCode } from "@/lib/countries";

export type ResolvedAccommodationLocation = {
  lat?: number;
  lon?: number;
  address?: string;
  placeId?: string;
  cityName?: string;
  countryName?: string;
};

/** Map-search suggestion from Geocoding (not Places Text Search). */
export type AccommodationSearchResult = {
  placeId: string;
  title: string;
  cityName: string;
  countryName: string;
  address: string;
  lat: number;
  lon: number;
};

/**
 * Pull a human-readable stay name from common booking URL path segments
 * (Booking.com hotel slugs, etc.). Returns null when nothing useful is found.
 */
export function hotelNameFromBookingUrl(rawUrl?: string | null): string | null {
  const trimmed = rawUrl?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    );
    const parts = url.pathname
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);

    // booking.com/hotel/{country}/{hotel-slug}.html
    const hotelIdx = parts.findIndex((part) => part.toLowerCase() === "hotel");
    if (hotelIdx >= 0 && parts[hotelIdx + 2]) {
      return slugToName(parts[hotelIdx + 2]);
    }

    // Generic: last path segment that looks like a name slug
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const candidate = slugToName(parts[i]);
      if (candidate && candidate.length >= 3 && !/^\d+$/.test(candidate)) {
        return candidate;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function slugToName(slug: string): string {
  return slug
    .replace(/\.[a-z0-9-]+$/i, "")
    .replace(/[_+]+/g, "-")
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .trim();
}

function readComponent(
  components: Array<{ long_name: string; types: string[] }> | undefined,
  type: string
): string {
  return (
    components?.find((c) => c.types.includes(type))?.long_name?.trim() ?? ""
  );
}

function parseCityCountry(
  components: Array<{ long_name: string; types: string[] }> | undefined
): { cityName: string; countryName: string } {
  const countryName = readComponent(components, "country");
  const cityName =
    readComponent(components, "locality") ||
    readComponent(components, "postal_town") ||
    readComponent(components, "administrative_area_level_2") ||
    readComponent(components, "administrative_area_level_1");
  return { cityName, countryName };
}

type GeocodeResultLike = {
  place_id?: string;
  formatted_address?: string;
  address_components?: Array<{ long_name: string; types: string[] }>;
  geometry?: {
    location?:
      | { lat: () => number; lng: () => number }
      | { lat: number; lng: number };
  };
};

function titleFromGeocodeResult(
  result: GeocodeResultLike,
  query: string
): string {
  const components = result.address_components;
  const named =
    readComponent(components, "premise") ||
    readComponent(components, "establishment") ||
    readComponent(components, "point_of_interest");
  if (named) return named;

  const formatted = result.formatted_address?.trim() || "";
  if (formatted) {
    const first = formatted.split(",")[0]?.trim();
    if (first) return first;
  }

  return query.trim();
}

function fromGeocodeResult(
  result: GeocodeResultLike,
  query: string
): AccommodationSearchResult | null {
  const placeId = result.place_id?.trim();
  const loc = result.geometry?.location;
  if (!placeId || !loc) return null;

  const lat = typeof loc.lat === "function" ? loc.lat() : Number(loc.lat);
  const lon = typeof loc.lng === "function" ? loc.lng() : Number(loc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const { cityName, countryName } = parseCityCountry(result.address_components);
  const title = titleFromGeocodeResult(result, query);
  const address = result.formatted_address?.trim() || title;

  return {
    placeId,
    title,
    address,
    cityName: cityName || countryName || "Unknown",
    countryName: countryName || cityName || "Unknown",
    lat,
    lon,
  };
}

function isoCountryFromParts(
  countryId?: string,
  countryName?: string
): string | undefined {
  const fromId = countryId?.trim().toUpperCase();
  if (fromId && /^[A-Z]{2}$/.test(fromId)) return fromId;
  const fromName = resolveCountryCode(countryName || "");
  return fromName || undefined;
}

/**
 * Stay search via Geocoding (cached). Biased with destination city/country.
 * Replaces Places Text Search-per-keystroke in AccommodationSheet.
 */
export async function searchAccommodationByGeocode(input: {
  query: string;
  destinationCity: string;
  destinationCountry?: string;
  countryId?: string;
}): Promise<AccommodationSearchResult[]> {
  const q = input.query.trim();
  if (q.length < 2) return [];

  const city = input.destinationCity.trim();
  const country = input.destinationCountry?.trim() || "";
  const textQuery = [q, city, country].filter(Boolean).join(", ");
  const countryCode = isoCountryFromParts(input.countryId, country);

  try {
    const results = await geocodeByAddress(textQuery, {
      ...(countryCode ? { country: countryCode } : {}),
    });
    const places: AccommodationSearchResult[] = [];
    const seen = new Set<string>();
    for (const result of results.slice(0, 6)) {
      const place = fromGeocodeResult(result, q);
      if (!place || seen.has(place.placeId)) continue;
      seen.add(place.placeId);
      places.push(place);
    }
    return places;
  } catch {
    return [];
  }
}

/**
 * Best-effort lat/lon for a stay: keep existing coords, else Geocode from
 * place name or booking-link slug + destination city.
 */
export async function resolveAccommodationLocation(input: {
  name?: string;
  link?: string;
  lat?: number;
  lon?: number;
  address?: string;
  placeId?: string;
  cityName?: string;
  countryName?: string;
  destinationCity: string;
  destinationCountry?: string;
  countryId?: string;
}): Promise<ResolvedAccommodationLocation> {
  if (
    typeof input.lat === "number" &&
    Number.isFinite(input.lat) &&
    typeof input.lon === "number" &&
    Number.isFinite(input.lon)
  ) {
    return {
      lat: input.lat,
      lon: input.lon,
      address: input.address,
      placeId: input.placeId,
      cityName: input.cityName,
      countryName: input.countryName,
    };
  }

  const destination = [input.destinationCity, input.destinationCountry]
    .filter(Boolean)
    .join(", ");
  const fromLink = hotelNameFromBookingUrl(input.link);
  const queries = [
    input.name?.trim()
      ? `${input.name.trim()} ${destination}`.trim()
      : null,
    fromLink ? `${fromLink} ${destination}`.trim() : null,
    input.address?.trim()
      ? `${input.address.trim()} ${destination}`.trim()
      : null,
  ].filter((q): q is string => Boolean(q && q.length >= 2));

  const countryCode = isoCountryFromParts(
    input.countryId,
    input.destinationCountry
  );

  for (const query of queries) {
    try {
      const results = await geocodeByAddress(query, {
        ...(countryCode ? { country: countryCode } : {}),
      });
      const top = results[0];
      if (!top) continue;
      const place = fromGeocodeResult(top, query);
      if (!place) continue;
      return {
        lat: place.lat,
        lon: place.lon,
        address: place.address || input.address,
        placeId: place.placeId || input.placeId,
        cityName: place.cityName || input.cityName,
        countryName: place.countryName || input.countryName,
      };
    } catch {
      // Try next query.
    }
  }

  return {
    address: input.address,
    placeId: input.placeId,
    cityName: input.cityName,
    countryName: input.countryName,
  };
}
