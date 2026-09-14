/**
 * City intelligence contracts.
 *
 * IMPORTANT: Visa, exchange rates, and similar data are time-sensitive.
 * Prefer authoritative external APIs over LLM-only answers.
 * Always surface a verification disclaimer to users.
 */

export const CITY_INTELLIGENCE_DISCLAIMER =
  "Travel information can change. Verify important details with official sources before traveling.";

export interface GetCityIntelligenceRequest {
  city: string;
  country: string;
  lat: number;
  lon: number;
  userCountry?: string;
  userCurrency?: string;
  language?: string;
}

/** Optional richer model payload retained for future UI. */
export interface CityIntelligenceDetails {
  city?: { name: string; country: string };
  currency?: {
    name: string;
    code: string;
    symbol: string;
    exchangeRate?: {
      from: string;
      to: string;
      rate: number | null;
      approximate: boolean;
    } | null;
  };
  bestTimeToVisit?: {
    months?: string[];
    season?: string;
    description?: string;
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
    safety?: string;
    /** Tourist safety score from 0 (very unsafe) to 10 (very safe). */
    safeRate?: {
      score: number | null;
      outOf: number;
      summary?: string;
    } | null;
    tips?: string[];
  };
  /** Destination-specific apps a short-term traveler should install. */
  usefulApps?: UsefulApp[];
}

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
  /** Official site URL when verified; omit rather than invent. */
  officialUrl?: string;
  isRecommended: boolean;
}

export interface CityIntelligenceResult {
  currency: string;
  /** Current exchange rate relative to the user's currency when available. */
  exchangeRate?: {
    from: string;
    to: string;
    rate: number;
    asOf: string;
    source: string;
  };
  /**
   * Approximate tourist safety score for the city (0–10).
   * Guidance only — not a guarantee; conditions vary by neighborhood and time.
   */
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
  visaRequirements?: {
    summary: string;
    /** Never treat LLM output as authoritative for visas. */
    source: string;
    requiresOfficialVerification: true;
  };
  approximateDailyBudget?: {
    amount: number;
    currency: string;
    summary?: string;
    source?: string;
  };
  /**
   * Destination-specific apps useful on arrival (~4–8).
   * Based on the destination city, not the traveler's home country.
   */
  usefulApps?: UsefulApp[];
  disclaimer: typeof CITY_INTELLIGENCE_DISCLAIMER;
  /** ISO timestamp of when this payload was assembled. */
  generatedAt: string;
  /** Richer structured payload from the model (optional). */
  details?: CityIntelligenceDetails;
}

/**
 * Provider interfaces for future authoritative integrations.
 */
export interface ExchangeRateProvider {
  readonly name: string;
  getRate(from: string, to: string): Promise<{
    rate: number;
    asOf: string;
  }>;
}

export interface VisaInfoProvider {
  readonly name: string;
  getRequirements(input: {
    nationality: string;
    destinationCountry: string;
  }): Promise<{
    summary: string;
    source: string;
  }>;
}

export interface CityIntelligenceAssembler {
  assemble(
    request: GetCityIntelligenceRequest
  ): Promise<CityIntelligenceResult>;
}
