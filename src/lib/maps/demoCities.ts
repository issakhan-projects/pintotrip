import type { CityHighlightStatus } from "./cityStatus";

/**
 * Optional hardcoded cities for DDS smoke tests.
 * Production highlighting uses locations grouped by city — leave empty.
 *
 * @see https://developers.google.com/maps/documentation/javascript/dds-boundaries/coverage
 */
export const DEMO_SELECTED_CITIES: Array<{
  key: string;
  cityName: string;
  countryName: string;
  countryId: string;
  status: CityHighlightStatus;
  lat: number;
  lon: number;
  featureType:
    | "COUNTRY"
    | "LOCALITY"
    | "ADMINISTRATIVE_AREA_LEVEL_1"
    | "ADMINISTRATIVE_AREA_LEVEL_2";
}> = [];
