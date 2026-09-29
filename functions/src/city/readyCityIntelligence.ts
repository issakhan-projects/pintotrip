/**
 * Shared destination facts for City Intelligence — one doc per city, all users.
 *
 * Path: readyCityIntelligence/{countryId}/cities/{cityId}
 *
 * Flat fields (NOT keyed by language). Canonical English text so every
 * traveler reuses the same cache. Visa + FX are never stored here.
 *
 * Admin SDK only — never client-readable.
 */

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { adminDb } from "../shared/admin";
import type { ModelCityIntelligence } from "./parseModelResponse";
import { toSlowCityIntelligence } from "./parseModelResponse";
import type { UsefulApp } from "./types";

const ROOT = "readyCityIntelligence";

/** Reusable destination facts (no visa, no exchange rates, no language split). */
export type ReadyCityIntelligenceInfo = {
  currency: {
    name: string;
    code: string;
    symbol: string;
  };
  bestTimeToVisit?: {
    months?: string[];
    season?: string;
    description?: string;
  };
  safeRate?: {
    score: number;
    outOf: number;
    summary: string;
  };
  usefulApps?: UsefulApp[];
  dailyBudget?: {
    currency: string;
    budget?: { local?: number | null };
    midRange?: { local?: number | null };
    luxury?: { local?: number | null };
    description?: string;
  };
  climate?: ModelCityIntelligence["climate"];
  practicalInfo?: ModelCityIntelligence["practicalInfo"];
  lastCheckedAt?: string;
};

export type ReadyCityIntelligenceDoc = ReadyCityIntelligenceInfo & {
  countryId: string;
  cityId: string;
  /** English display name when known. */
  cityName: string;
  /** English display name when known. */
  countryName: string;
  updatedAt?: Timestamp;
  createdAt?: Timestamp;
  source?: string;
  /**
   * @deprecated Legacy language-keyed shape. Read once for migration; never write.
   */
  info?: Record<string, ReadyCityIntelligenceInfo>;
};

export type ReadyCompleteness = {
  ready: ReadyCityIntelligenceInfo | null;
  /** True when all shared fields are present — only visa/FX needed from live path. */
  complete: boolean;
  missing: Array<
    | "currency"
    | "bestTimeToVisit"
    | "safeRate"
    | "usefulApps"
    | "dailyBudget"
    | "climate"
    | "practicalInfo"
  >;
};

function isAsciiSlug(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === "unknown") return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed);
}

function isCountryId(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === "xx" || trimmed === "unknown") return false;
  return /^[a-z]{2}$/.test(trimmed);
}

function cityRef(countryId: string, cityId: string) {
  return adminDb().doc(`${ROOT}/${countryId}/cities/${cityId}`);
}

function localOnlyTier(tier?: {
  local?: number | null;
  userCurrency?: number | null;
}): { local?: number | null } | undefined {
  if (!tier) return undefined;
  return { local: tier.local ?? null };
}

/**
 * Strip nationality / FX fields into the durable ready-info shape.
 */
export function toReadyCityIntelligenceInfo(
  full: ModelCityIntelligence
): ReadyCityIntelligenceInfo {
  const slow = toSlowCityIntelligence(full);
  const rawSafe = slow.practicalInfo?.safeRate;
  let safeRate: ReadyCityIntelligenceInfo["safeRate"];
  if (
    rawSafe?.score != null &&
    Number.isFinite(rawSafe.score) &&
    rawSafe.outOf != null &&
    Number.isFinite(rawSafe.outOf) &&
    rawSafe.outOf > 0
  ) {
    const outOf = rawSafe.outOf;
    const score = Math.min(outOf, Math.max(0, rawSafe.score));
    safeRate = {
      score: Math.round(score * 10) / 10,
      outOf,
      summary:
        rawSafe.summary?.trim() ||
        slow.practicalInfo?.safety?.trim() ||
        "Approximate tourist safety guidance for typical visitors.",
    };
  }

  return {
    currency: {
      name: slow.currency.name,
      code: slow.currency.code,
      symbol: slow.currency.symbol,
    },
    ...(slow.bestTimeToVisit
      ? { bestTimeToVisit: slow.bestTimeToVisit }
      : {}),
    ...(safeRate ? { safeRate } : {}),
    ...(slow.usefulApps?.length ? { usefulApps: slow.usefulApps } : {}),
    ...(slow.dailyBudget
      ? {
          dailyBudget: {
            currency: slow.dailyBudget.currency,
            budget: localOnlyTier(slow.dailyBudget.budget),
            midRange: localOnlyTier(slow.dailyBudget.midRange),
            luxury: localOnlyTier(slow.dailyBudget.luxury),
            ...(slow.dailyBudget.description
              ? { description: slow.dailyBudget.description }
              : {}),
          },
        }
      : {}),
    ...(slow.climate ? { climate: slow.climate } : {}),
    ...(slow.practicalInfo ? { practicalInfo: slow.practicalInfo } : {}),
    ...(slow.lastCheckedAt ? { lastCheckedAt: slow.lastCheckedAt } : {}),
  };
}

/**
 * Expand ready info back into ModelCityIntelligence.
 * Visa/FX stay empty — filled by a small AI call + Frankfurter.
 */
export function readyInfoToModelCityIntelligence(
  info: ReadyCityIntelligenceInfo,
  city: { name: string; country: string }
): ModelCityIntelligence {
  let practicalInfo = info.practicalInfo
    ? { ...info.practicalInfo }
    : undefined;

  if (info.safeRate) {
    const safeRate = {
      score: info.safeRate.score,
      outOf: info.safeRate.outOf,
      summary: info.safeRate.summary,
    };
    practicalInfo = {
      ...(practicalInfo ?? {}),
      safeRate,
      safety: practicalInfo?.safety ?? info.safeRate.summary,
    };
  }

  return {
    city,
    currency: info.currency,
    bestTimeToVisit: info.bestTimeToVisit,
    visa: undefined,
    dailyBudget: info.dailyBudget
      ? {
          currency: info.dailyBudget.currency,
          budget: info.dailyBudget.budget
            ? { local: info.dailyBudget.budget.local ?? null, userCurrency: null }
            : undefined,
          midRange: info.dailyBudget.midRange
            ? {
                local: info.dailyBudget.midRange.local ?? null,
                userCurrency: null,
              }
            : undefined,
          luxury: info.dailyBudget.luxury
            ? {
                local: info.dailyBudget.luxury.local ?? null,
                userCurrency: null,
              }
            : undefined,
          description: info.dailyBudget.description,
        }
      : undefined,
    climate: info.climate,
    practicalInfo,
    usefulApps: info.usefulApps,
    lastCheckedAt: info.lastCheckedAt,
  };
}

function isValidReadyInfo(raw: unknown): raw is ReadyCityIntelligenceInfo {
  if (!raw || typeof raw !== "object") return false;
  const body = raw as Record<string, unknown>;
  const currency = body.currency as Record<string, unknown> | undefined;
  if (!currency || typeof currency !== "object") return false;
  if (
    typeof currency.name !== "string" ||
    !currency.name.trim() ||
    typeof currency.code !== "string" ||
    !/^[A-Za-z]{3}$/.test(currency.code.trim())
  ) {
    return false;
  }
  return true;
}

/** Prefer flat doc; fall back to legacy info.en / info.* once. */
function extractReadyInfo(
  data: ReadyCityIntelligenceDoc
): ReadyCityIntelligenceInfo | null {
  const flatCandidate: ReadyCityIntelligenceInfo = {
    currency: data.currency,
    ...(data.bestTimeToVisit
      ? { bestTimeToVisit: data.bestTimeToVisit }
      : {}),
    ...(data.safeRate ? { safeRate: data.safeRate } : {}),
    ...(data.usefulApps?.length ? { usefulApps: data.usefulApps } : {}),
    ...(data.dailyBudget ? { dailyBudget: data.dailyBudget } : {}),
    ...(data.climate ? { climate: data.climate } : {}),
    ...(data.practicalInfo ? { practicalInfo: data.practicalInfo } : {}),
    ...(data.lastCheckedAt ? { lastCheckedAt: data.lastCheckedAt } : {}),
  };
  if (isValidReadyInfo(flatCandidate)) return flatCandidate;

  const legacy = data.info;
  if (!legacy || typeof legacy !== "object") return null;
  const preferred =
    legacy.en ??
    legacy.EN ??
    Object.values(legacy).find((v) => isValidReadyInfo(v));
  return isValidReadyInfo(preferred) ? preferred : null;
}

export function assessReadyCompleteness(
  info: ReadyCityIntelligenceInfo | null
): ReadyCompleteness {
  if (!info) {
    return {
      ready: null,
      complete: false,
      missing: [
        "currency",
        "bestTimeToVisit",
        "safeRate",
        "usefulApps",
        "dailyBudget",
        "climate",
        "practicalInfo",
      ],
    };
  }

  const missing: ReadyCompleteness["missing"] = [];
  if (!info.currency?.code) missing.push("currency");
  if (!info.bestTimeToVisit) missing.push("bestTimeToVisit");
  if (!info.safeRate && !info.practicalInfo?.safeRate) missing.push("safeRate");
  if (!info.usefulApps?.length) missing.push("usefulApps");
  if (!info.dailyBudget?.currency) missing.push("dailyBudget");
  if (!info.climate) missing.push("climate");
  if (!info.practicalInfo) missing.push("practicalInfo");

  return {
    ready: info,
    complete: missing.length === 0,
    missing,
  };
}

/**
 * Read shared city intelligence (language-agnostic).
 */
export async function getReadyCityIntelligence(params: {
  countryId: string;
  cityId: string;
  cityName?: string;
  countryName?: string;
}): Promise<ReadyCompleteness & { model: ModelCityIntelligence | null }> {
  const countryId = params.countryId.trim().toLowerCase();
  const cityId = params.cityId.trim().toLowerCase();
  if (!isCountryId(countryId) || !isAsciiSlug(cityId)) {
    return { ...assessReadyCompleteness(null), model: null };
  }

  try {
    const snap = await cityRef(countryId, cityId).get();
    if (!snap.exists) {
      return { ...assessReadyCompleteness(null), model: null };
    }

    const data = snap.data() as ReadyCityIntelligenceDoc;
    const info = extractReadyInfo(data);
    const assessed = assessReadyCompleteness(info);

    if (!assessed.ready) {
      return { ...assessed, model: null };
    }

    const cityName =
      (typeof data.cityName === "string" && data.cityName.trim()) ||
      params.cityName ||
      cityId;
    const countryName =
      (typeof data.countryName === "string" && data.countryName.trim()) ||
      params.countryName ||
      countryId;

    logger.info("readyCityIntelligence hit", {
      countryId,
      cityId,
      complete: assessed.complete,
      missing: assessed.missing,
    });

    return {
      ...assessed,
      model: readyInfoToModelCityIntelligence(assessed.ready, {
        name: cityName,
        country: countryName,
      }),
    };
  } catch (err) {
    logger.warn("readyCityIntelligence read failed", {
      countryId,
      cityId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ...assessReadyCompleteness(null), model: null };
  }
}

/**
 * Persist shared destination facts (flat, English, merge-safe).
 * Does not store visa or exchange rates. Clears legacy `info.*` language maps.
 */
export async function setReadyCityIntelligence(params: {
  countryId: string;
  cityId: string;
  cityName: string;
  countryName: string;
  raw: ModelCityIntelligence;
}): Promise<void> {
  const countryId = params.countryId.trim().toLowerCase();
  const cityId = params.cityId.trim().toLowerCase();
  if (!isCountryId(countryId) || !isAsciiSlug(cityId)) {
    logger.warn("readyCityIntelligence skip write: invalid ids", {
      countryId: params.countryId,
      cityId: params.cityId,
    });
    return;
  }

  const info = toReadyCityIntelligenceInfo(params.raw);
  const ref = cityRef(countryId, cityId);

  try {
    const existing = await ref.get();
    const payload: Record<string, unknown> = {
      countryId,
      cityId,
      cityName: params.cityName.trim() || cityId,
      countryName: params.countryName.trim() || countryId,
      currency: info.currency,
      ...(info.bestTimeToVisit
        ? { bestTimeToVisit: info.bestTimeToVisit }
        : {}),
      ...(info.safeRate ? { safeRate: info.safeRate } : {}),
      ...(info.usefulApps?.length ? { usefulApps: info.usefulApps } : {}),
      ...(info.dailyBudget ? { dailyBudget: info.dailyBudget } : {}),
      ...(info.climate ? { climate: info.climate } : {}),
      ...(info.practicalInfo ? { practicalInfo: info.practicalInfo } : {}),
      ...(info.lastCheckedAt ? { lastCheckedAt: info.lastCheckedAt } : {}),
      updatedAt: FieldValue.serverTimestamp(),
      source: "getCityIntelligence",
      // Drop language-keyed legacy field so the doc stays flat.
      info: FieldValue.delete(),
    };
    if (!existing.exists) {
      payload.createdAt = FieldValue.serverTimestamp();
    }

    await ref.set(payload, { merge: true });

    logger.info("readyCityIntelligence saved", {
      countryId,
      cityId,
      hasUsefulApps: Boolean(info.usefulApps?.length),
      hasSafeRate: Boolean(info.safeRate),
      currency: info.currency.code,
    });
  } catch (err) {
    logger.warn("readyCityIntelligence write failed", {
      countryId,
      cityId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
