import type { CityIntelligenceResult } from "@/types/city-intelligence";
import type { FavoriteCityTravelInfo } from "@/types/favorite-city";

/**
 * Map a City Intelligence payload onto the fields we persist on
 * users/{uid}/favoriteCities/{id}.
 */
export function travelInfoFromCityIntelligence(
  data: CityIntelligenceResult | null | undefined,
  language?: string
): FavoriteCityTravelInfo | undefined {
  if (!data) return undefined;

  const details = data.details;
  const currency =
    data.exchangeRate?.to?.trim().toUpperCase() ||
    details?.dailyBudget?.currency?.trim().toUpperCase() ||
    undefined;

  const midUser = details?.dailyBudget?.midRange?.userCurrency;
  const midLocal = details?.dailyBudget?.midRange?.local;
  const userCode = data.exchangeRate?.from?.trim().toUpperCase() || "";
  const localCode =
    details?.dailyBudget?.currency?.trim().toUpperCase() ||
    data.exchangeRate?.to?.trim().toUpperCase() ||
    "";

  let approximateDailyBudget: FavoriteCityTravelInfo["approximateDailyBudget"];
  if (midUser != null && Number.isFinite(midUser) && userCode) {
    approximateDailyBudget = {
      amount: midUser,
      currency: userCode,
      ...(details?.dailyBudget?.description
        ? { summary: details.dailyBudget.description }
        : {}),
    };
  } else if (midLocal != null && Number.isFinite(midLocal) && localCode) {
    approximateDailyBudget = {
      amount: midLocal,
      currency: localCode,
      ...(details?.dailyBudget?.description
        ? { summary: details.dailyBudget.description }
        : {}),
    };
  } else if (details?.dailyBudget?.description) {
    approximateDailyBudget = {
      ...(localCode ? { currency: localCode } : {}),
      summary: details.dailyBudget.description,
    };
  }

  const bestTimeSummary =
    data.bestTimeToVisit?.summary?.trim() ||
    data.bestTimeToVisit?.months?.join(", ") ||
    "";
  const bestTimeToVisit = bestTimeSummary
    ? {
        summary: bestTimeSummary,
        ...(data.bestTimeToVisit?.months?.length
          ? { months: data.bestTimeToVisit.months }
          : {}),
        ...(data.bestTimeToVisit?.source
          ? { source: data.bestTimeToVisit.source }
          : {}),
      }
    : undefined;

  const visa = data.visa
    ? {
        required: data.visa.required,
        ...(data.visa.type != null ? { type: data.visa.type } : {}),
        ...(data.visa.cost != null ? { cost: data.visa.cost } : {}),
        ...(data.visa.description
          ? { description: data.visa.description }
          : {}),
        ...(data.visa.verificationRequired != null
          ? { verificationRequired: data.visa.verificationRequired }
          : {}),
      }
    : undefined;

  const safeRate = data.safeRate
    ? {
        score: data.safeRate.score,
        outOf: data.safeRate.outOf,
        summary: data.safeRate.summary,
        ...(data.safeRate.source ? { source: data.safeRate.source } : {}),
      }
    : undefined;

  const lang = language?.trim();
  const travelInfo: FavoriteCityTravelInfo = {
    ...(safeRate ? { safeRate } : {}),
    ...(currency ? { currency } : {}),
    ...(lang ? { language: lang } : {}),
    ...(approximateDailyBudget ? { approximateDailyBudget } : {}),
    ...(bestTimeToVisit ? { bestTimeToVisit } : {}),
    ...(visa ? { visa } : {}),
  };

  return Object.keys(travelInfo).length > 0 ? travelInfo : undefined;
}
