/**
 * getTripWeather — daily forecast for a trip date range via OpenWeatherMap.
 */

export type GetTripWeatherRequest = {
  lat: number;
  lon: number;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  /** metric | imperial — default metric */
  units?: "metric" | "imperial";
  cityName?: string;
};

export type TripWeatherDay = {
  /** YYYY-MM-DD */
  date: string;
  /** False when OpenWeather has no forecast for this date yet. */
  available: boolean;
  tempMin?: number;
  tempMax?: number;
  /** Representative daytime temperature. */
  temp?: number;
  description?: string;
  /** OpenWeather icon code, e.g. "01d". */
  icon?: string;
  humidity?: number;
  windSpeed?: number;
  /** 0–100, from 3h pop when available. */
  precipitationChance?: number;
};

export type GetTripWeatherResult = {
  success: true;
  units: "metric" | "imperial";
  lat: number;
  lon: number;
  cityName?: string;
  days: TripWeatherDay[];
  /** ISO timestamp when forecast was fetched. */
  fetchedAt: string;
  /** Human note when some trip days are outside the free forecast window. */
  note?: string;
};
