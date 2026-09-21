export const CITY_INTELLIGENCE_DISCLAIMER =
  "Travel information can change. Verify important details with official sources before traveling.";

export type UsefulAppCategory =
  | "taxi"
  | "transport"
  | "maps"
  | "food"
  | "booking"
  | "payments"
  | "translation"
  | "local";

export type UsefulAppPlatform = "ios" | "android" | "web";

export interface UsefulApp {
  name: string;
  category: UsefulAppCategory;
  description: string;
  whyUseful: string;
  platforms: UsefulAppPlatform[];
  officialUrl?: string;
  isRecommended: boolean;
}

export type CityIntelligenceCityInput = {
  city: string;
  country: string;
  lat: number;
  lon: number;
  cityId?: string;
  countryId?: string;
};

export interface GetCityIntelligenceRequest {
  cities: CityIntelligenceCityInput[];
  userCountry?: string;
  userCurrency?: string;
  language?: string;
}

export interface CityIntelligenceDetails {
  dailyBudget?: {
    currency: string;
    budget?: { local?: number | null; userCurrency?: number | null };
    midRange?: { local?: number | null; userCurrency?: number | null };
    luxury?: { local?: number | null; userCurrency?: number | null };
    description?: string;
  };
  climate?: {
    description?: string;
    averageTemperature?: {
      min?: number | null;
      max?: number | null;
      unit?: string;
    };
  };
  practicalInfo?: {
    transport?: string;
    walkability?: string;
    payment?: string;
    tips?: string[];
  };
}

export interface CityIntelligenceResult {
  city: {
    name: string;
    country: string;
    cityId: string;
    countryId: string;
  };
  visa?: {
    required: boolean | "unknown";
    type?: string | null;
    cost?: {
      amount?: number | null;
      currency?: string | null;
    } | null;
    description?: string;
    verificationRequired?: boolean;
  };
  exchangeRate?: {
    from: string;
    to: string;
    rate: number;
    asOf: string;
    source: string;
  };
  safeRate?: {
    score: number;
    outOf: number;
    summary: string;
    source: string;
  };
  bestTimeToVisit?: {
    summary: string;
    months?: string[];
    source?: string;
  };
  usefulApps?: UsefulApp[];
  disclaimer: typeof CITY_INTELLIGENCE_DISCLAIMER;
  generatedAt: string;
  details?: CityIntelligenceDetails;
}

export interface GetCityIntelligenceBatchResult {
  results: CityIntelligenceResult[];
  disclaimer: typeof CITY_INTELLIGENCE_DISCLAIMER;
  generatedAt: string;
}

export interface ExchangeRateProvider {
  readonly name: string;
  getRate(
    from: string,
    to: string
  ): Promise<{ rate: number; asOf: string }>;
}

export interface VisaInfoProvider {
  readonly name: string;
  getRequirements(input: {
    nationality: string;
    destinationCountry: string;
  }): Promise<{ summary: string; source: string }>;
}
