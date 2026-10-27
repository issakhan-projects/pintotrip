import type { SavedFavoriteCity } from "@/hooks/useFavoriteCities";
import type { SavedLocation } from "@/hooks/useLocations";
import { resolveCountryCode } from "@/lib/countries";
import { countryIdFromParts, isAsciiId, slugifyId } from "@/lib/utils";
import type { BadgeActivityStats } from "@/types/badge";
import type { TripPlannerDoc } from "@/types/trip-planner";
import type { UserProfile } from "@/types/user";

function countryKey(place: SavedLocation): string {
  const code =
    resolveCountryCode(place.country.id) ||
    resolveCountryCode(place.country.name);
  if (code) return code.toLowerCase();
  return countryIdFromParts(place.country.name, place.country.id);
}

function cityKey(place: SavedLocation): string {
  const country = countryKey(place);
  const cityId = isAsciiId(place.city.id)
    ? place.city.id.trim().toLowerCase()
    : slugifyId(place.city.name);
  return `${country}:${cityId}`;
}

const FOOD_CATEGORIES = new Set(["food", "cafe", "market"]);

function hasFilledTravelProfile(profile: UserProfile | null | undefined): boolean {
  const tp = profile?.travelProfile;
  if (!tp) return false;
  return Boolean(
    tp.travelExperience ||
      (tp.preferredTravelTypes && tp.preferredTravelTypes.length > 0) ||
      tp.preferredTripStyle ||
      tp.planningStyle
  );
}

/**
 * Aggregate activity counters used by the badge evaluator.
 */
export function buildBadgeActivityStats(input: {
  locations: SavedLocation[];
  trips: TripPlannerDoc[];
  favoriteCities: SavedFavoriteCity[];
  profile: UserProfile | null | undefined;
}): BadgeActivityStats {
  const { locations, trips, favoriteCities, profile } = input;

  const countries = new Set<string>();
  const cities = new Set<string>();
  let visited = 0;
  let foodPlaces = 0;

  for (const place of locations) {
    countries.add(countryKey(place));
    cities.add(cityKey(place));
    if (place.status === "visited") visited += 1;
    if (place.category && FOOD_CATEGORIES.has(place.category)) {
      foodPlaces += 1;
    }
  }

  return {
    places: locations.length,
    visited,
    countries: countries.size,
    cities: cities.size,
    trips: trips.length,
    completedTrips: trips.filter((t) => t.status === "completed").length,
    foodPlaces,
    favoriteCities: favoriteCities.length,
    travelProfile: hasFilledTravelProfile(profile) ? 1 : 0,
  };
}
