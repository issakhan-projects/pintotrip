import { searchPlacesByName } from "@/features/add-place/placeSearch";
import { geocodeByAddress } from "@/lib/maps";

export type ResolvedAccommodationLocation = {
  lat?: number;
  lon?: number;
  address?: string;
  placeId?: string;
  cityName?: string;
  countryName?: string;
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
    .join(" ")
    .trim();
}

/**
 * Best-effort lat/lon for a stay: keep existing coords, else Places/Geocode
 * from place name or booking-link slug + destination city.
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

  for (const query of queries) {
    try {
      const places = await searchPlacesByName(query);
      const place = places[0];
      if (place) {
        return {
          lat: place.lat,
          lon: place.lon,
          address: place.address || input.address,
          placeId: place.placeId,
          cityName: place.cityName || input.cityName,
          countryName: place.countryName || input.countryName,
        };
      }
    } catch {
      // Fall through to geocoder.
    }

    try {
      const results = await geocodeByAddress(query);
      const top = results[0];
      const location = top?.geometry?.location;
      if (!location) continue;
      const lat =
        typeof location.lat === "function"
          ? location.lat()
          : Number(location.lat);
      const lon =
        typeof location.lng === "function"
          ? location.lng()
          : Number(location.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      return {
        lat: lat as number,
        lon: lon as number,
        address: top.formatted_address || input.address,
        placeId: input.placeId,
        cityName: input.cityName,
        countryName: input.countryName,
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
