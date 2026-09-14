import type { SavedLocation } from "@/hooks/useLocations";
import {
  countryNameFromCode,
  resolveCountryCode,
} from "@/lib/countries";
import { countryIdFromParts, isAsciiId, slugifyId } from "@/lib/utils";

export interface CityGroup {
  cityId: string;
  cityName: string;
  places: SavedLocation[];
  visited: number;
  total: number;
}

export interface CountryGroup {
  countryId: string;
  countryName: string;
  cities: CityGroup[];
  visited: number;
  total: number;
}

function countVisited(places: SavedLocation[]) {
  return places.filter((place) => place.status === "visited").length;
}

/** Prefer ISO alpha-2 so "kz", "kazakhstan", and "Kazakhstan" collapse. */
function normalizedCountryKey(place: SavedLocation): {
  countryId: string;
  countryName: string;
} {
  const code =
    resolveCountryCode(place.country.id) ||
    resolveCountryCode(place.country.name);
  const countryId = code
    ? code.toLowerCase()
    : countryIdFromParts(place.country.name, place.country.id);
  return {
    countryId,
    countryName:
      place.country.name.trim() ||
      countryNameFromCode(code) ||
      countryId,
  };
}

/** Prefer stored ASCII city id; otherwise slugify the display name. */
function normalizedCityKey(place: SavedLocation): {
  cityId: string;
  cityName: string;
} {
  const cityId = isAsciiId(place.city.id)
    ? place.city.id.trim().toLowerCase()
    : slugifyId(place.city.name);
  return {
    cityId,
    cityName: place.city.name.trim() || cityId,
  };
}

export function groupLocationsByCountryCity(
  locations: SavedLocation[]
): CountryGroup[] {
  const countries = new Map<string, CountryGroup>();

  for (const place of locations) {
    const { countryId, countryName } = normalizedCountryKey(place);
    let country = countries.get(countryId);
    if (!country) {
      country = {
        countryId,
        countryName,
        cities: [],
        visited: 0,
        total: 0,
      };
      countries.set(countryId, country);
    }

    const { cityId, cityName } = normalizedCityKey(place);
    let city = country.cities.find((c) => c.cityId === cityId);
    if (!city) {
      city = {
        cityId,
        cityName,
        places: [],
        visited: 0,
        total: 0,
      };
      country.cities.push(city);
    }

    city.places.push(place);
  }

  for (const country of countries.values()) {
    for (const city of country.cities) {
      city.total = city.places.length;
      city.visited = countVisited(city.places);
      country.total += city.total;
      country.visited += city.visited;
    }
    country.cities.sort((a, b) => a.cityName.localeCompare(b.cityName));
  }

  return Array.from(countries.values()).sort((a, b) =>
    a.countryName.localeCompare(b.countryName)
  );
}

export function computePlaceStats(locations: SavedLocation[]) {
  const countries = new Set(
    locations.map((l) => normalizedCountryKey(l).countryId)
  );
  const visited = locations.filter((l) => l.status === "visited").length;
  return {
    countries: countries.size,
    places: locations.length,
    visited,
  };
}
