/**
 * Attach authoritative Frankfurter FX to a city-intelligence payload.
 * Local currency identity (name/code/symbol) still comes from the model;
 * rates never do.
 */

import { logger } from "firebase-functions";
import {
  FRANKFURTER_SOURCE,
  frankfurterExchangeRateProvider,
} from "./frankfurter";
import type { CityIntelligenceResult } from "./types";

function localCurrencyCode(result: CityIntelligenceResult): string | undefined {
  const fromDetails = result.details?.currency?.code?.trim().toUpperCase();
  if (fromDetails && /^[A-Z]{3}$/.test(fromDetails)) return fromDetails;

  // Top-level currency is often "SAR — Saudi Riyal"
  const label = result.currency?.trim() ?? "";
  const codeMatch = label.match(/\b([A-Za-z]{3})\b/);
  const code = codeMatch?.[1]?.toUpperCase();
  return code && /^[A-Z]{3}$/.test(code) ? code : undefined;
}

function convertLocalToUser(
  local: number | null | undefined,
  rate: number
): number | null {
  if (local == null || !Number.isFinite(local) || rate <= 0) return null;
  return Math.round((local / rate) * 100) / 100;
}

/**
 * Fetch Frankfurter rate (user currency → local) and merge into the result.
 * Soft-fails: returns the original payload if FX cannot be resolved.
 */
export async function attachFrankfurterExchangeRate(
  result: CityIntelligenceResult,
  userCurrency: string
): Promise<CityIntelligenceResult> {
  const from = userCurrency.trim().toUpperCase();
  const to = localCurrencyCode(result);

  // Strip any model-synthesized FX so we never surface AI rates.
  const withoutAiFx: CityIntelligenceResult = {
    ...result,
    exchangeRate: undefined,
    details: result.details
      ? {
          ...result.details,
          currency: result.details.currency
            ? {
                ...result.details.currency,
                exchangeRate: null,
              }
            : result.details.currency,
        }
      : result.details,
  };

  if (!from || !to) return withoutAiFx;

  try {
    const { rate, asOf } = await frankfurterExchangeRateProvider.getRate(
      from,
      to
    );

    const exchangeRate = {
      from,
      to,
      rate,
      asOf,
      source: FRANKFURTER_SOURCE,
    };

    const dailyBudget = withoutAiFx.details?.dailyBudget;
    let nextDailyBudget = dailyBudget;
    if (dailyBudget) {
      const fillTier = (tier?: {
        local?: number | null;
        userCurrency?: number | null;
      }) => {
        if (!tier) return tier;
        const converted = convertLocalToUser(tier.local, rate);
        if (converted == null) return tier;
        return { ...tier, userCurrency: converted };
      };
      nextDailyBudget = {
        ...dailyBudget,
        budget: fillTier(dailyBudget.budget),
        midRange: fillTier(dailyBudget.midRange),
        luxury: fillTier(dailyBudget.luxury),
      };
    }

    let approximateDailyBudget = withoutAiFx.approximateDailyBudget;
    if (
      nextDailyBudget &&
      (!approximateDailyBudget ||
        approximateDailyBudget.currency.toUpperCase() !== from)
    ) {
      const mid =
        nextDailyBudget.midRange?.userCurrency ??
        nextDailyBudget.budget?.userCurrency;
      if (mid != null && Number.isFinite(mid)) {
        approximateDailyBudget = {
          amount: mid,
          currency: from,
          summary:
            nextDailyBudget.description?.trim() ||
            approximateDailyBudget?.summary,
          source: approximateDailyBudget?.source ?? "Estimated daily mid-range budget",
        };
      }
    }

    return {
      ...withoutAiFx,
      exchangeRate,
      approximateDailyBudget,
      details: withoutAiFx.details
        ? {
            ...withoutAiFx.details,
            currency: withoutAiFx.details.currency
              ? {
                  ...withoutAiFx.details.currency,
                  exchangeRate: {
                    from,
                    to,
                    rate,
                    approximate: false,
                  },
                }
              : withoutAiFx.details.currency,
            dailyBudget: nextDailyBudget,
          }
        : withoutAiFx.details,
    };
  } catch (err) {
    logger.warn("Frankfurter exchange rate unavailable", {
      from,
      to,
      error: err instanceof Error ? err.message : String(err),
    });
    return withoutAiFx;
  }
}
