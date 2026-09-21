export type ResolveCityAirportInput = {
  cityName: string;
  countryName?: string;
  cityId?: string;
  lat?: number;
  lon?: number;
};

export type ResolvedCityAirport = {
  cityName: string;
  countryName?: string;
  cityId?: string;
  code: string;
  name?: string;
  lat?: number;
  lon?: number;
  alternatives?: Array<{
    code: string;
    name?: string;
    lat?: number;
    lon?: number;
  }>;
};

export type ResolveCityAirportsRequest = {
  cities: ResolveCityAirportInput[];
  language?: string;
};

export type ResolveCityAirportsResult = {
  airports: ResolvedCityAirport[];
};

export type ModelCityAirport = {
  cityName?: string;
  countryName?: string;
  cityId?: string;
  code?: string;
  name?: string;
  lat?: number;
  lon?: number;
  alternatives?: Array<{
    code?: string;
    name?: string;
    lat?: number;
    lon?: number;
  }>;
};

export type ModelResolveCityAirports = {
  airports?: ModelCityAirport[];
};
