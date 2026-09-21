/**
 * Parse model city-intelligence JSON and map to CityIntelligenceResult.
 */

import {
  CITY_INTELLIGENCE_DISCLAIMER,
  type CityIntelligenceResult,
  type UsefulApp,
  type UsefulAppCategory,
  type UsefulAppPlatform,
} from "./types";

export type VisaRequired = boolean | "unknown";
export type Walkability = "easy" | "moderate" | "difficult";

const USEFUL_APP_CATEGORIES = new Set<UsefulAppCategory>([
  "taxi",
  "transport",
  "maps",
  "food",
  "booking",
  "payments",
  "translation",
  "local",
]);

const USEFUL_APP_PLATFORMS = new Set<UsefulAppPlatform>([
  "ios",
  "android",
  "web",
]);

export interface ModelCityIntelligence {
  city: { name: string; country: string };
  currency: {
    name: string;
    code: string;
    symbol: string;
  };
  /** Parsed from the model, then mapped to top-level CityIntelligenceResult.bestTimeToVisit. */
  bestTimeToVisit?: {
    months?: string[];
    season?: string;
    description?: string;
  };
  visa?: {
    required: VisaRequired;
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
    walkability?: Walkability | string;
    payment?: string;
    safety?: string;
    safeRate?: {
      score: number | null;
      outOf: number;
      summary?: string;
    } | null;
    tips?: string[];
  };
  usefulApps?: UsefulApp[];
  lastCheckedAt?: string;
  warning?: string;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid string field: ${field}`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
  return items.length > 0 ? items : undefined;
}

function parseUsefulAppCategory(value: unknown): UsefulAppCategory | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  // Accept a few common aliases from the model.
  const aliases: Record<string, UsefulAppCategory> = {
    taxi: "taxi",
    "ride-hailing": "taxi",
    ridehailing: "taxi",
    rideshare: "taxi",
    transport: "transport",
    "public transport": "transport",
    transit: "transport",
    maps: "maps",
    navigation: "maps",
    "maps & navigation": "maps",
    food: "food",
    "food delivery": "food",
    booking: "booking",
    travel: "booking",
    "travel / booking": "booking",
    payments: "payments",
    payment: "payments",
    translation: "translation",
    translate: "translation",
    local: "local",
    "city-specific": "local",
  };
  const mapped = aliases[normalized] ?? (normalized as UsefulAppCategory);
  return USEFUL_APP_CATEGORIES.has(mapped) ? mapped : undefined;
}

function parseUsefulAppPlatforms(value: unknown): UsefulAppPlatform[] {
  if (!Array.isArray(value)) return [];
  const platforms: UsefulAppPlatform[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim().toLowerCase() as UsefulAppPlatform;
    if (USEFUL_APP_PLATFORMS.has(normalized) && !platforms.includes(normalized)) {
      platforms.push(normalized);
    }
  }
  return platforms;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Parse usefulApps from the model. Cap at 8; drop incomplete / unverifiable entries.
 * Omit officialUrl when missing or not a valid http(s) URL (never invent).
 */
function parseUsefulApps(value: unknown): UsefulApp[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const apps: UsefulApp[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = optionalString(row.name);
    const category = parseUsefulAppCategory(row.category);
    const description = optionalString(row.description);
    const whyUseful = optionalString(row.whyUseful);
    if (!name || !category || !description || !whyUseful) continue;

    const platforms = parseUsefulAppPlatforms(row.platforms);
    const rawUrl = optionalString(row.officialUrl);
    const officialUrl =
      rawUrl && isHttpUrl(rawUrl) ? rawUrl : undefined;

    apps.push({
      name,
      category,
      description,
      whyUseful,
      platforms,
      ...(officialUrl ? { officialUrl } : {}),
      isRecommended: row.isRecommended !== false,
    });

    if (apps.length >= 8) break;
  }

  return apps.length > 0 ? apps : undefined;
}

function parseVisaRequired(value: unknown): VisaRequired {
  if (value === true || value === false) return value;
  if (value === "unknown") return "unknown";
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
    if (lower === "unknown") return "unknown";
  }
  return "unknown";
}

/**
 * Strip optional markdown fences, then parse JSON.
 */
export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  return JSON.parse(candidate) as unknown;
}

export function parseModelCityIntelligence(
  raw: unknown
): ModelCityIntelligence {
  if (!raw || typeof raw !== "object") {
    throw new Error("Model response is not an object.");
  }

  const body = raw as Record<string, unknown>;
  const cityObj = body.city;
  if (!cityObj || typeof cityObj !== "object") {
    throw new Error("Model response missing city.");
  }
  const city = cityObj as Record<string, unknown>;

  const currencyObj = body.currency;
  if (!currencyObj || typeof currencyObj !== "object") {
    throw new Error("Model response missing currency.");
  }
  const currency = currencyObj as Record<string, unknown>;

  // Ignore any model-supplied FX — Frankfurter is the sole rate source.
  const bestRaw = body.bestTimeToVisit;
  const bestTimeToVisit =
    bestRaw && typeof bestRaw === "object"
      ? {
          months: asStringArray((bestRaw as Record<string, unknown>).months),
          season: optionalString((bestRaw as Record<string, unknown>).season),
          description: optionalString(
            (bestRaw as Record<string, unknown>).description
          ),
        }
      : undefined;

  const visaRaw = body.visa;
  let visa: ModelCityIntelligence["visa"];
  if (visaRaw && typeof visaRaw === "object") {
    const v = visaRaw as Record<string, unknown>;
    const costRaw = v.cost;
    visa = {
      required: parseVisaRequired(v.required),
      type: optionalString(v.type) ?? null,
      cost:
        costRaw && typeof costRaw === "object"
          ? {
              amount: optionalNumber((costRaw as Record<string, unknown>).amount) ?? null,
              currency:
                optionalString((costRaw as Record<string, unknown>).currency) ??
                null,
            }
          : null,
      description: optionalString(v.description),
      verificationRequired: v.verificationRequired !== false,
    };
  }

  const budgetRaw = body.dailyBudget;
  let dailyBudget: ModelCityIntelligence["dailyBudget"];
  if (budgetRaw && typeof budgetRaw === "object") {
    const b = budgetRaw as Record<string, unknown>;
    const tier = (key: string) => {
      const t = b[key];
      if (!t || typeof t !== "object") return undefined;
      const obj = t as Record<string, unknown>;
      return {
        local: optionalNumber(obj.local) ?? null,
        // Ignore model userCurrency — Frankfurter converts server-side.
        userCurrency: null,
      };
    };
    dailyBudget = {
      currency: asString(b.currency, "dailyBudget.currency"),
      budget: tier("budget"),
      midRange: tier("midRange"),
      luxury: tier("luxury"),
      description: optionalString(b.description),
    };
  }

  const climateRaw = body.climate;
  let climate: ModelCityIntelligence["climate"];
  if (climateRaw && typeof climateRaw === "object") {
    const c = climateRaw as Record<string, unknown>;
    const temp = c.averageTemperature;
    climate = {
      description: optionalString(c.description),
      averageTemperature:
        temp && typeof temp === "object"
          ? {
              min: optionalNumber((temp as Record<string, unknown>).min) ?? null,
              max: optionalNumber((temp as Record<string, unknown>).max) ?? null,
              unit: optionalString((temp as Record<string, unknown>).unit) ?? "C",
            }
          : undefined,
    };
  }

  const practicalRaw = body.practicalInfo;
  let practicalInfo: ModelCityIntelligence["practicalInfo"];
  if (practicalRaw && typeof practicalRaw === "object") {
    const p = practicalRaw as Record<string, unknown>;
    const safeRateRaw = p.safeRate;
    let safeRate: NonNullable<
      ModelCityIntelligence["practicalInfo"]
    >["safeRate"];
    if (safeRateRaw && typeof safeRateRaw === "object") {
      const sr = safeRateRaw as Record<string, unknown>;
      const score = optionalNumber(sr.score);
      const outOf = optionalNumber(sr.outOf);
      safeRate = {
        score: score === undefined ? null : score,
        outOf:
          outOf != null && Number.isFinite(outOf) && outOf > 0 ? outOf : 10,
        summary: optionalString(sr.summary),
      };
    } else if (typeof safeRateRaw === "number" && Number.isFinite(safeRateRaw)) {
      safeRate = { score: safeRateRaw, outOf: 10 };
    }
    practicalInfo = {
      transport: optionalString(p.transport),
      walkability: optionalString(p.walkability),
      payment: optionalString(p.payment),
      safety: optionalString(p.safety),
      safeRate,
      tips: asStringArray(p.tips),
    };
  }

  const usefulApps = parseUsefulApps(body.usefulApps);

  return {
    city: {
      name: asString(city.name, "city.name"),
      country: asString(city.country, "city.country"),
    },
    currency: {
      name: asString(currency.name, "currency.name"),
      code: asString(currency.code, "currency.code").toUpperCase(),
      symbol: asString(currency.symbol, "currency.symbol"),
    },
    bestTimeToVisit,
    visa,
    dailyBudget,
    climate,
    practicalInfo,
    usefulApps,
    lastCheckedAt: optionalString(body.lastCheckedAt),
    warning: optionalString(body.warning),
  };
}

function buildVisaSummary(
  visa: NonNullable<ModelCityIntelligence["visa"]>,
  userCountry: string,
  destinationCountry: string
): string {
  const base =
    visa.description?.trim() ||
    (visa.required === true
      ? `Travelers from ${userCountry} generally need a visa for ${destinationCountry}.`
      : visa.required === false
        ? `Travelers from ${userCountry} generally do not need a visa for ${destinationCountry}.`
        : `Visa requirements for travelers from ${userCountry} to ${destinationCountry} could not be reliably confirmed.`);

  const parts = [base];

  if (visa.type) {
    parts.push(`Type: ${visa.type}.`);
  }

  if (
    visa.cost?.amount != null &&
    visa.cost.currency &&
    Number.isFinite(visa.cost.amount)
  ) {
    parts.push(
      `Approximate cost: ${visa.cost.amount} ${visa.cost.currency}.`
    );
  }

  parts.push(
    "Always verify with the destination country's official government, embassy, or immigration sources before traveling."
  );

  return parts.join(" ");
}

/** Slim time-sensitive model payload (visa / local budget — FX from Frankfurter). */
export interface ModelCityTimeSensitive {
  visa?: ModelCityIntelligence["visa"];
  dailyBudget?: ModelCityIntelligence["dailyBudget"];
  lastCheckedAt?: string;
  warning?: string;
}

/**
 * Parse time-sensitive-only model JSON (partial city intelligence refresh).
 */
export function parseModelCityTimeSensitive(
  raw: unknown
): ModelCityTimeSensitive {
  if (!raw || typeof raw !== "object") {
    throw new Error("Time-sensitive response is not an object.");
  }
  const body = raw as Record<string, unknown>;

  let visa: ModelCityIntelligence["visa"];
  const visaRaw = body.visa;
  if (visaRaw && typeof visaRaw === "object") {
    const v = visaRaw as Record<string, unknown>;
    const costRaw = v.cost;
    visa = {
      required: parseVisaRequired(v.required),
      type: optionalString(v.type) ?? null,
      cost:
        costRaw && typeof costRaw === "object"
          ? {
              amount:
                optionalNumber((costRaw as Record<string, unknown>).amount) ??
                null,
              currency:
                optionalString((costRaw as Record<string, unknown>).currency) ??
                null,
            }
          : null,
      description: optionalString(v.description),
      verificationRequired: v.verificationRequired !== false,
    };
  }

  let dailyBudget: ModelCityIntelligence["dailyBudget"];
  const budgetRaw = body.dailyBudget;
  if (budgetRaw && typeof budgetRaw === "object") {
    const b = budgetRaw as Record<string, unknown>;
    const tier = (key: string) => {
      const t = b[key];
      if (!t || typeof t !== "object") return undefined;
      const obj = t as Record<string, unknown>;
      return {
        local: optionalNumber(obj.local) ?? null,
        // Ignore model userCurrency — Frankfurter converts server-side.
        userCurrency: null,
      };
    };
    const currency = optionalString(b.currency);
    if (currency) {
      dailyBudget = {
        currency,
        budget: tier("budget"),
        midRange: tier("midRange"),
        luxury: tier("luxury"),
        description: optionalString(b.description),
      };
    }
  }

  return {
    visa,
    dailyBudget,
    lastCheckedAt: optionalString(body.lastCheckedAt),
    warning: optionalString(body.warning),
  };
}

/**
 * Merge cached slow-changing city facts with a fresh time-sensitive patch.
 */
export function mergeSlowWithTimeSensitive(
  slow: ModelCityIntelligence,
  patch: ModelCityTimeSensitive
): ModelCityIntelligence {
  return {
    ...slow,
    currency: {
      ...slow.currency,
    },
    visa: patch.visa ?? slow.visa,
    dailyBudget: patch.dailyBudget ?? slow.dailyBudget,
    lastCheckedAt: patch.lastCheckedAt ?? slow.lastCheckedAt,
    warning: patch.warning ?? slow.warning,
  };
}

/**
 * Fields safe to cache across travelers (no nationality / FX dependency).
 */
export function toSlowCityIntelligence(
  full: ModelCityIntelligence
): ModelCityIntelligence {
  return {
    city: full.city,
    currency: {
      name: full.currency.name,
      code: full.currency.code,
      symbol: full.currency.symbol,
    },
    bestTimeToVisit: full.bestTimeToVisit,
    // Visa depends on nationality — omit from slow cache.
    visa: undefined,
    dailyBudget: full.dailyBudget
      ? {
          currency: full.dailyBudget.currency,
          budget: full.dailyBudget.budget
            ? { local: full.dailyBudget.budget.local, userCurrency: null }
            : undefined,
          midRange: full.dailyBudget.midRange
            ? { local: full.dailyBudget.midRange.local, userCurrency: null }
            : undefined,
          luxury: full.dailyBudget.luxury
            ? { local: full.dailyBudget.luxury.local, userCurrency: null }
            : undefined,
          description: full.dailyBudget.description,
        }
      : undefined,
    climate: full.climate,
    practicalInfo: full.practicalInfo,
    usefulApps: full.usefulApps,
    lastCheckedAt: full.lastCheckedAt,
    warning: full.warning,
  };
}

/**
 * Compact context for the time-sensitive prompt (min tokens).
 */
export function buildSlowContextForPrompt(
  slow: ModelCityIntelligence
): string {
  return JSON.stringify({
    city: slow.city,
    currency: {
      name: slow.currency.name,
      code: slow.currency.code,
      symbol: slow.currency.symbol,
    },
    dailyBudgetLocal: slow.dailyBudget
      ? {
          currency: slow.dailyBudget.currency,
          budget: slow.dailyBudget.budget?.local ?? null,
          midRange: slow.dailyBudget.midRange?.local ?? null,
          luxury: slow.dailyBudget.luxury?.local ?? null,
        }
      : null,
  });
}

/**
 * Map nested model output → callable CityIntelligenceResult (web contract).
 * Always forces the canonical disclaimer; generatedAt is server time.
 */
export function toCityIntelligenceResult(
  analysis: ModelCityIntelligence,
  context: {
    userCountry: string;
    generatedAt: string;
    cityId: string;
    countryId: string;
  }
): CityIntelligenceResult {
  // exchangeRate is attached later via Frankfurter — never from the model.
  const best = analysis.bestTimeToVisit;
  const bestTimeToVisit = best
    ? {
        summary: [best.season, best.description].filter(Boolean).join(" — "),
        months: best.months,
        source: "General climate and tourism seasonality synthesis",
      }
    : undefined;

  const rawSafe = analysis.practicalInfo?.safeRate;
  let safeScore =
    rawSafe?.score != null && Number.isFinite(rawSafe.score)
      ? rawSafe.score
      : undefined;
  const outOf =
    rawSafe?.outOf != null && Number.isFinite(rawSafe.outOf) && rawSafe.outOf > 0
      ? rawSafe.outOf
      : 10;
  if (safeScore != null) {
    safeScore = Math.min(outOf, Math.max(0, safeScore));
    safeScore = Math.round(safeScore * 10) / 10;
  }
  const safeRate =
    safeScore != null
      ? {
          score: safeScore,
          outOf,
          summary:
            rawSafe?.summary?.trim() ||
            analysis.practicalInfo?.safety?.trim() ||
            "Approximate tourist safety guidance for typical visitors.",
          source:
            "Approximate traveler safety score — not an official rating; conditions vary by area and time",
        }
      : undefined;

  const visa = analysis.visa
    ? {
        ...analysis.visa,
        description: buildVisaSummary(
          analysis.visa,
          context.userCountry,
          analysis.city.country
        ),
        verificationRequired: true as const,
      }
    : undefined;

  return {
    city: {
      name: analysis.city.name,
      country: analysis.city.country,
      cityId: context.cityId,
      countryId: context.countryId,
    },
    visa,
    safeRate,
    bestTimeToVisit,
    usefulApps: analysis.usefulApps,
    disclaimer: CITY_INTELLIGENCE_DISCLAIMER,
    generatedAt: context.generatedAt,
    details: {
      dailyBudget: analysis.dailyBudget
        ? {
            ...analysis.dailyBudget,
            currency:
              analysis.dailyBudget.currency?.trim().toUpperCase() ||
              analysis.currency.code,
          }
        : {
            currency: analysis.currency.code,
          },
      climate: analysis.climate,
      practicalInfo: analysis.practicalInfo
        ? {
            transport: analysis.practicalInfo.transport,
            walkability: analysis.practicalInfo.walkability,
            payment: analysis.practicalInfo.payment,
            tips: analysis.practicalInfo.tips,
          }
        : undefined,
    },
  };
}
