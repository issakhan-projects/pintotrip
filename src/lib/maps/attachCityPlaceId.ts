import type { LocationCity, LocationCountry } from "@/types/location";
import {
  looksLikeGooglePlaceId,
  resolveCityGooglePlaceId,
} from "./cityPlaceId";

/**
 * Resolve and attach `city.googlePlaceId` for a location write.
 * Never treats `city.id` (slug) as a Google Place ID.
 * If resolution fails, returns the city unchanged so saves still succeed.
 */
export async function withCityGooglePlaceId(
  city: LocationCity,
  country: LocationCountry,
  coords?: { lat: number; lon: number }
): Promise<LocationCity> {
  if (looksLikeGooglePlaceId(city.googlePlaceId)) {
    return {
      ...city,
      googlePlaceId: city.googlePlaceId!.trim(),
    };
  }

  const placeId = await resolveCityGooglePlaceId({
    key: city.id || `${country.id}:${city.name}`,
    cityName: city.name,
    countryName: country.name,
    countryId: country.id,
    cityId: city.id,
    lat: coords?.lat,
    lon: coords?.lon,
  });

  if (!placeId) return city;

  return {
    ...city,
    googlePlaceId: placeId,
  };
}
