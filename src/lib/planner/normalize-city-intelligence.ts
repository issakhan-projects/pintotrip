import type {
  CityIntelligenceDetails,
  CityIntelligenceResult,
} from "@/types/city-intelligence";
import { CITY_INTELLIGENCE_DISCLAIMER } from "@/types/city-intelligence";
import type {
  TripCityIntelligence,
  TripDestination,
} from "@/types/trip-planner";
import {
  countryIdFromParts,
  isAsciiId,
  resolveAsciiId,
} from "@/lib/utils";

/** Pre-migration trip docs used singular `result` and a flatter field layout. */
type LegacyTripCityIntelligence = TripCityIntelligence & {
  result?: unknown;
};

type LegacyIntelEntry = {
  city?: {
    name?: string;
    country?: string;
    cityId?: string;
    countryId?: string;
  };
  currency?: string;
  exchangeRate?: CityIntelligenceResult["exchangeRate"];
  safeRate?: CityIntelligenceResult["safeRate"];
  bestTimeToVisit?: CityIntelligenceResult["bestTimeToVisit"];
  visa?: CityIntelligenceResult["visa"];
  visaRequirements?: { summary?: string; source?: string };
  approximateDailyBudget?: {
    amount?: number;
    currency?: string;
    summary?: string;
  };
  usefulApps?: CityIntelligenceResult["usefulApps"];
  disclaimer?: string;
  generatedAt?: string;
  details?: CityIntelligenceDetails & {
    city?: { name?: string; country?: string };
    currency?: { code?: string; name?: string };
    visa?: CityIntelligenceResult["visa"];
    bestTimeToVisit?: {
      months?: string[];
      season?: string;
      description?: string;
    };
    practicalInfo?: CityIntelligenceDetails["practicalInfo"] & {
      safety?: string;
      safeRate?: { score?: number; outOf?: number; summary?: string };
    };
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function matchDestination(
  entry: LegacyIntelEntry,
  destinations: TripDestination[],
  index: number
): TripDestination | undefined {
  const name = (
    entry.city?.name ||
    entry.details?.city?.name ||
    ""
  )
    .trim()
    .toLowerCase();
  if (name) {
    const byName = destinations.find(
      (d) => d.cityName?.trim().toLowerCase() === name
    );
    if (byName) return byName;
  }
  return destinations[index];
}

/**
 * Map a stored (possibly legacy) intelligence entry onto the current
 * `CityIntelligenceResult` contract so Step 1 UI can render it.
 */
export function normalizeCityIntelligenceEntry(
  raw: unknown,
  destinations: TripDestination[] = [],
  index = 0
): CityIntelligenceResult | null {
  const record = asRecord(raw);
  if (!record) return null;

  const entry = record as LegacyIntelEntry;
  const detailsRaw = entry.details;
  const fallback = matchDestination(entry, destinations, index);

  const name =
    entry.city?.name?.trim() ||
    detailsRaw?.city?.name?.trim() ||
    fallback?.cityName?.trim() ||
    "";
  const country =
    entry.city?.country?.trim() ||
    detailsRaw?.city?.country?.trim() ||
    fallback?.countryName?.trim() ||
    "";

  const cityId = resolveAsciiId(
    entry.city?.cityId || fallback?.cityId,
    name
  );
  if (!isAsciiId(cityId) && !name && !country) {
    // Empty / unusable payload — drop rather than invent a ghost city.
    return null;
  }

  const countryId =
    (isAsciiId(entry.city?.countryId)
      ? entry.city!.countryId!.trim().toLowerCase()
      : null) ||
    (isAsciiId(fallback?.countryId)
      ? fallback!.countryId!.trim().toLowerCase()
      : null) ||
    countryIdFromParts(country || "xx");

  const visa =
    entry.visa ??
    detailsRaw?.visa ??
    (entry.visaRequirements?.summary
      ? {
          required: "unknown" as const,
          description: entry.visaRequirements.summary,
          verificationRequired: true as const,
        }
      : undefined);

  const bestTimeToVisit =
    entry.bestTimeToVisit ??
    (detailsRaw?.bestTimeToVisit
      ? {
          summary:
            [
              detailsRaw.bestTimeToVisit.season,
              detailsRaw.bestTimeToVisit.description,
            ]
              .filter(Boolean)
              .join(" — ") ||
            detailsRaw.bestTimeToVisit.months?.join(", ") ||
            "",
          months: detailsRaw.bestTimeToVisit.months,
        }
      : undefined);

  const safeFromDetails = detailsRaw?.practicalInfo?.safeRate;
  const safetySummary =
    entry.safeRate?.summary?.trim() ||
    safeFromDetails?.summary?.trim() ||
    detailsRaw?.practicalInfo?.safety?.trim() ||
    "";
  const safeScore =
    entry.safeRate?.score ??
    (safeFromDetails?.score != null ? safeFromDetails.score : undefined);
  const safeRate: CityIntelligenceResult["safeRate"] | undefined =
    Number.isFinite(safeScore)
      ? {
          score: safeScore as number,
          outOf:
            entry.safeRate?.outOf ??
            safeFromDetails?.outOf ??
            10,
          summary:
            safetySummary ||
            "Approximate tourist safety guidance for typical visitors.",
          source:
            entry.safeRate?.source ||
            "Approximate traveler safety score — not an official rating",
        }
      : safetySummary
        ? {
            // Summary-only legacy payloads — UI prefers `.summary` over score.
            score: 0,
            outOf: 10,
            summary: safetySummary,
            source:
              "Approximate traveler safety score — not an official rating",
          }
        : undefined;

  const approx = entry.approximateDailyBudget;
  const destinationCurrency =
    detailsRaw?.currency?.code?.trim() ||
    (typeof entry.currency === "string" ? entry.currency.trim() : "") ||
    "";
  const legacyCurrencyCode =
    detailsRaw?.dailyBudget?.currency?.trim() ||
    destinationCurrency ||
    approx?.currency?.trim() ||
    "";

  let details: CityIntelligenceDetails | undefined = detailsRaw
    ? {
        dailyBudget: detailsRaw.dailyBudget,
        climate: detailsRaw.climate,
        practicalInfo: detailsRaw.practicalInfo
          ? {
              transport: detailsRaw.practicalInfo.transport,
              walkability: detailsRaw.practicalInfo.walkability,
              payment: detailsRaw.practicalInfo.payment,
              tips: detailsRaw.practicalInfo.tips,
            }
          : undefined,
      }
    : undefined;

  if (
    approx?.amount != null &&
    Number.isFinite(approx.amount) &&
    !details?.dailyBudget?.midRange
  ) {
    const amountCurrency = approx.currency?.trim() || legacyCurrencyCode;
    const destCode = destinationCurrency || amountCurrency;
    const currenciesDiffer =
      Boolean(destCode) &&
      Boolean(amountCurrency) &&
      destCode.toUpperCase() !== amountCurrency.toUpperCase();

    details = {
      ...details,
      dailyBudget: currenciesDiffer
        ? {
            // Keep destination code for the Currency tile; budget via description.
            currency: destCode,
            description:
              approx.summary ||
              `~${approx.amount} ${amountCurrency} / day`,
          }
        : {
            currency: amountCurrency || destCode,
            midRange: { local: approx.amount },
            description: approx.summary || undefined,
          },
    };
  } else if (legacyCurrencyCode && !details?.dailyBudget?.currency) {
    details = {
      ...details,
      dailyBudget: {
        ...(details?.dailyBudget ?? { currency: legacyCurrencyCode }),
        currency: legacyCurrencyCode,
      },
    };
  }

  const exchangeRate = entry.exchangeRate;

  const generatedAt =
    typeof entry.generatedAt === "string" && entry.generatedAt.trim()
      ? entry.generatedAt
      : new Date(0).toISOString();

  return {
    city: {
      name: name || cityId,
      country: country || countryId,
      cityId: isAsciiId(cityId) ? cityId : "city",
      countryId,
    },
    ...(visa ? { visa } : {}),
    ...(exchangeRate ? { exchangeRate } : {}),
    ...(safeRate ? { safeRate } : {}),
    ...(bestTimeToVisit?.summary ? { bestTimeToVisit } : {}),
    ...(entry.usefulApps ? { usefulApps: entry.usefulApps } : {}),
    disclaimer: CITY_INTELLIGENCE_DISCLAIMER,
    generatedAt,
    ...(details ? { details } : {}),
  };
}

/**
 * Coalesce singular legacy `result` → `results[]` and normalize each entry.
 */
export function normalizeTripCityIntelligence(
  raw: TripCityIntelligence | LegacyTripCityIntelligence | undefined,
  destinations: TripDestination[] = []
): TripCityIntelligence {
  const legacy = raw as LegacyTripCityIntelligence | undefined;
  const status = legacy?.status ?? "pending";

  const sourceList: unknown[] = Array.isArray(legacy?.results)
    ? legacy.results
    : legacy?.result != null
      ? [legacy.result]
      : [];

  const results = sourceList
    .map((entry, index) =>
      normalizeCityIntelligenceEntry(entry, destinations, index)
    )
    .filter((entry): entry is CityIntelligenceResult => entry != null);

  const { result: _legacyResult, results: _rawResults, ...rest } =
    legacy ?? { status };
  void _legacyResult;
  void _rawResults;

  return {
    ...rest,
    status,
    ...(results.length > 0 ? { results } : {}),
    ...(legacy?.errorMessage ? { errorMessage: legacy.errorMessage } : {}),
    ...(legacy?.lastUpdatedAt
      ? { lastUpdatedAt: legacy.lastUpdatedAt }
      : {}),
  };
}
