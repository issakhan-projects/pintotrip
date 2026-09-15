import type { SavedLocation } from "@/hooks/useLocations";
import type { TripDestinationStop } from "@/types/trip-planner";
import { distanceKm } from "./clusterPlaces";
import {
  destinationCityKey,
  destinationCountryKey,
} from "./tripDestinations";

/** Places this far from a destination pin still count as geographically relevant. */
const GEO_NEAR_KM = 80;

function placeCountryKey(place: SavedLocation): string {
  return destinationCountryKey(place.country.name, place.country.id);
}

function placeCityKey(place: SavedLocation): string {
  return destinationCityKey(place.city.name, place.city.id);
}

function matchesCity(place: SavedLocation, dest: TripDestinationStop): boolean {
  const destCity = destinationCityKey(dest.cityName, dest.cityId);
  const placeCity = placeCityKey(place);
  if (destCity && placeCity && destCity === placeCity) return true;
  const destName = dest.cityName.trim().toLowerCase();
  const placeName = place.city.name.trim().toLowerCase();
  return Boolean(destName && placeName && destName === placeName);
}

function matchesCountry(
  place: SavedLocation,
  dest: TripDestinationStop
): boolean {
  const destCountry = destinationCountryKey(dest.countryName, dest.countryId);
  const placeCountry = placeCountryKey(place);
  if (destCountry && placeCountry && destCountry === placeCountry) return true;
  const destName = dest.countryName.trim().toLowerCase();
  const placeName = place.country.name.trim().toLowerCase();
  return Boolean(destName && placeName && destName === placeName);
}

function isNearDestination(
  place: SavedLocation,
  dest: TripDestinationStop
): boolean {
  if (
    typeof dest.lat !== "number" ||
    typeof dest.lon !== "number" ||
    !Number.isFinite(dest.lat) ||
    !Number.isFinite(dest.lon)
  ) {
    return false;
  }
  return (
    distanceKm(
      { lat: place.lat, lon: place.lon },
      { lat: dest.lat, lon: dest.lon }
    ) <= GEO_NEAR_KM
  );
}

/** Saved places that belong to a trip city/country or sit near a destination pin. */
export function matchLocationsToDestinations(
  locations: SavedLocation[],
  destinations: TripDestinationStop[]
): SavedLocation[] {
  if (destinations.length === 0) return [];
  return locations.filter((place) => {
    if (place.status === "cancelled") return false;
    return destinations.some(
      (dest) => matchesCity(place, dest) || isNearDestination(place, dest)
    );
  });
}

export function destinationForLocation(
  place: SavedLocation,
  destinations: TripDestinationStop[]
): TripDestinationStop | null {
  const cityHit = destinations.find((dest) => matchesCity(place, dest));
  if (cityHit) return cityHit;
  const near = destinations.find((dest) => isNearDestination(place, dest));
  if (near) return near;
  const countryHit = destinations.find((dest) => matchesCountry(place, dest));
  return countryHit ?? null;
}

export function sortLocationsForDestination(
  locations: SavedLocation[],
  destinations: TripDestinationStop[]
): SavedLocation[] {
  return [...locations].sort((a, b) => {
    const aCity = destinations.some((dest) => matchesCity(a, dest)) ? 0 : 1;
    const bCity = destinations.some((dest) => matchesCity(b, dest)) ? 0 : 1;
    return aCity - bCity || a.title.localeCompare(b.title);
  });
}
