/**
 * Attach authoritative Frankfurter FX to a city-intelligence payload.
 * Local currency identity (name/code/symbol) still comes from the model;
 * rates never do — only top-level `exchangeRate` is filled.
 */

import { logger } from "firebase-functions";
import {
  FRANKFURTER_SOURCE,
  frankfurterExchangeRateProvider,
} from "./frankfurter";
import type { CityIntelligenceResult } from "./types";

function localCurrencyCode(result: CityIntelligenceResult): string | undefined {
  const fromBudget = result.details?.dailyBudget?.currency?.trim().toUpperCase();
  if (fromBudget && /^[A-Z]{3}$/.test(fromBudget)) return fromBudget;

  const fromFx = result.exchangeRate?.to?.trim().toUpperCase();
  if (fromFx && /^[A-Z]{3}$/.test(fromFx)) return fromFx;

  return undefined;
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

  // Strip any prior FX so we never surface stale / AI rates.
  const withoutAiFx: CityIntelligenceResult = {
    ...result,
    exchangeRate: undefined,
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

    return {
      ...withoutAiFx,
      exchangeRate,
      details: withoutAiFx.details
        ? {
            ...withoutAiFx.details,
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
