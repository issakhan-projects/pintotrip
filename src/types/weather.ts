/**
 * Client types for getTripWeather Cloud Function.
 * Mirrored from functions/src/weather/types.ts
 */

export type GetTripWeatherRequest = {
  lat: number;
  lon: number;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  units?: "metric" | "imperial";
  cityName?: string;
};

export type TripWeatherDay = {
  date: string;
  available: boolean;
  tempMin?: number;
  tempMax?: number;
  temp?: number;
  description?: string;
  icon?: string;
  humidity?: number;
  windSpeed?: number;
  precipitationChance?: number;
};

export type GetTripWeatherResult = {
  success: true;
  units: "metric" | "imperial";
  lat: number;
  lon: number;
  cityName?: string;
  days: TripWeatherDay[];
  fetchedAt: string;
  note?: string;
};
