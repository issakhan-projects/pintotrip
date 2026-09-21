import { onCall, HttpsError } from "firebase-functions/https";
import { logger } from "firebase-functions";
import { requireAuth } from "../shared/auth";
import { DEFAULT_FUNCTIONS_REGION, openaiApiKey } from "../shared/config";
import { createOpenAIClient } from "../shared/openai";
import { recordAIUsage, usageFromCompletion, estimateGpt4oCost } from "../shared/aiUsage";
import {
  assertSufficientCredits,
  deductCredits,
} from "../shared/creditService";
import type { InsufficientAICreditsError } from "../shared/credits";
import { initAdmin } from "../shared/admin";
import {
  AI_CACHE_TTL,
  executeCachedAI,
  resolveCityAirportsFingerprint,
} from "../shared/ai";
import type {
  ModelResolveCityAirports,
  ResolveCityAirportInput,
  ResolveCityAirportsRequest,
  ResolveCityAirportsResult,
  ResolvedCityAirport,
} from "./airportTypes";

const MODEL = "gpt-5.6-luna";
const MAX_TOKENS = 900;
const MAX_CITIES = 12;

const SYSTEM_PROMPT = `You map travel cities to their primary commercial airports.
Return JSON only with this shape:
{"airports":[{"cityName":"","countryName":"","cityId":"","code":"ALA","name":"Almaty International Airport","lat":43.35,"lon":77.04,"alternatives":[{"code":"","name":"","lat":0,"lon":0}]}]}

Rules:
- code must be a real IATA 3-letter uppercase airport code
- Prefer the main international airport that serves the city
- Include lat/lon for the chosen airport when known
- alternatives: up to 2 other useful airports for the same city (optional)
- If you cannot resolve a city, omit it from airports
- cityId must be English/ASCII lowercase slug when provided in the request; never invent localized script ids
- Never invent fake airport codes`;

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1]?.trim() || trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Expected a JSON object in model response.");
  }
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

function normalizeIata(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function normalizeCoord(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function parseCities(data: unknown): ResolveCityAirportInput[] {
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request body is required.");
  }
  const body = data as Record<string, unknown>;
  if (!Array.isArray(body.cities) || body.cities.length === 0) {
    throw new HttpsError("invalid-argument", "cities[] is required.");
  }
  if (body.cities.length > MAX_CITIES) {
    throw new HttpsError(
      "invalid-argument",
      `At most ${MAX_CITIES} cities are allowed.`
    );
  }

  const cities: ResolveCityAirportInput[] = [];
  for (const entry of body.cities) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const cityName =
      typeof row.cityName === "string" ? row.cityName.trim() : "";
    if (!cityName) continue;
    const countryName =
      typeof row.countryName === "string" && row.countryName.trim()
        ? row.countryName.trim()
        : undefined;
    const cityId =
      typeof row.cityId === "string" &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.cityId.trim())
        ? row.cityId.trim()
        : undefined;
    const lat = normalizeCoord(row.lat);
    const lon = normalizeCoord(row.lon);
    cities.push({
      cityName,
      ...(countryName ? { countryName } : {}),
      ...(cityId ? { cityId } : {}),
      ...(lat != null ? { lat } : {}),
      ...(lon != null ? { lon } : {}),
    });
  }

  if (cities.length === 0) {
    throw new HttpsError(
      "invalid-argument",
      "At least one city with cityName is required."
    );
  }
  return cities;
}

function citiesKey(cities: ResolveCityAirportInput[]): string {
  return cities
    .map((city) =>
      [
        city.cityId || "",
        city.cityName.toLowerCase(),
        (city.countryName || "").toLowerCase(),
        typeof city.lat === "number" ? city.lat.toFixed(2) : "",
        typeof city.lon === "number" ? city.lon.toFixed(2) : "",
      ].join("|")
    )
    .sort()
    .join(";");
}

function parseModelResult(
  raw: unknown,
  requested: ResolveCityAirportInput[]
): ResolveCityAirportsResult {
  const model = (raw || {}) as ModelResolveCityAirports;
  const byKey = new Map<string, ResolveCityAirportInput>();
  for (const city of requested) {
    byKey.set(
      `${(city.cityId || "").toLowerCase()}|${city.cityName.toLowerCase()}`,
      city
    );
  }

  const airports: ResolvedCityAirport[] = [];
  for (const row of model.airports ?? []) {
    const code = normalizeIata(row.code);
    if (!code) continue;
    const cityName =
      typeof row.cityName === "string" && row.cityName.trim()
        ? row.cityName.trim()
        : "";
    if (!cityName) continue;

    const match =
      byKey.get(
        `${(row.cityId || "").toLowerCase()}|${cityName.toLowerCase()}`
      ) ||
      [...byKey.values()].find(
        (city) => city.cityName.toLowerCase() === cityName.toLowerCase()
      );

    const alternatives = (row.alternatives ?? [])
      .map((alt) => {
        const altCode = normalizeIata(alt.code);
        if (!altCode || altCode === code) return null;
        const lat = normalizeCoord(alt.lat);
        const lon = normalizeCoord(alt.lon);
        return {
          code: altCode,
          ...(typeof alt.name === "string" && alt.name.trim()
            ? { name: alt.name.trim() }
            : {}),
          ...(lat != null ? { lat } : {}),
          ...(lon != null ? { lon } : {}),
        };
      })
      .filter((alt): alt is NonNullable<typeof alt> => Boolean(alt))
      .slice(0, 2);

    const lat = normalizeCoord(row.lat);
    const lon = normalizeCoord(row.lon);
    airports.push({
      cityName: match?.cityName || cityName,
      ...(match?.countryName || row.countryName
        ? { countryName: match?.countryName || String(row.countryName).trim() }
        : {}),
      ...(match?.cityId ? { cityId: match.cityId } : {}),
      code,
      ...(typeof row.name === "string" && row.name.trim()
        ? { name: row.name.trim() }
        : {}),
      ...(lat != null ? { lat } : {}),
      ...(lon != null ? { lon } : {}),
      ...(alternatives.length > 0 ? { alternatives } : {}),
    });
  }

  return { airports };
}

async function runAirportModel(
  cities: ResolveCityAirportInput[],
  language: string
): Promise<{
  result: ResolveCityAirportsResult;
  model: string;
  usage: ReturnType<typeof usageFromCompletion>;
  cost: number;
}> {
  const client = createOpenAIClient();
  const userPayload = {
    language,
    cities: cities.map((city) => ({
      cityName: city.cityName,
      countryName: city.countryName,
      cityId: city.cityId,
      lat: city.lat,
      lon: city.lon,
    })),
  };

  const completion = await client.chat.completions.create({
    model: MODEL,
    max_completion_tokens: MAX_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Resolve primary airports for these cities:\n${JSON.stringify(userPayload)}`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty model response for resolveCityAirports.");
  }
  const parsed = parseModelResult(extractJsonObject(content), cities);
  const usage = usageFromCompletion(completion.usage);
  const cost = estimateGpt4oCost(usage);
  return { result: parsed, model: MODEL, usage, cost };
}

export type ResolveCityAirportsResponse =
  | ResolveCityAirportsResult
  | InsufficientAICreditsError;

/**
 * resolveCityAirports
 * Maps trip cities → primary IATA airports (+ lat/lon). Heavily cached.
 */
export const resolveCityAirports = onCall(
  {
    region: DEFAULT_FUNCTIONS_REGION,
    secrets: [openaiApiKey],
    invoker: "public",
    cors: true,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (request): Promise<ResolveCityAirportsResponse> => {
    initAdmin();
    const uid = requireAuth(request);
    const cities = parseCities(request.data);
    const language =
      typeof (request.data as ResolveCityAirportsRequest)?.language === "string" &&
      (request.data as ResolveCityAirportsRequest).language!.trim()
        ? (request.data as ResolveCityAirportsRequest).language!.trim()
        : "en";

    const fingerprint = resolveCityAirportsFingerprint({
      citiesKey: citiesKey(cities),
      language,
    });

    try {
      const executed = await executeCachedAI<ResolveCityAirportsResult>({
        functionName: "resolveCityAirports",
        fingerprint,
        operation: "resolveCityAirports",
        ttlMs: AI_CACHE_TTL.resolveCityAirports,
        execute: async () => {
          const creditCheck = await assertSufficientCredits(
            uid,
            "resolveCityAirports"
          );
          if (!creditCheck.ok) {
            throw Object.assign(
              new Error("INSUFFICIENT_AI_CREDITS"),
              creditCheck.response
            );
          }
          return runAirportModel(cities, language);
        },
      });

      if (executed.billable) {
        await deductCredits(uid, "resolveCityAirports");
        await recordAIUsage({
          userId: uid,
          operation: "resolveCityAirports",
          cost: executed.cost,
        });
      }

      return executed.result;
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "error" in err &&
        (err as { error: unknown }).error === "INSUFFICIENT_AI_CREDITS"
      ) {
        return err as InsufficientAICreditsError;
      }
      logger.error("resolveCityAirports failed", {
        uid,
        error: err instanceof Error ? err.message : String(err),
      });
      const message =
        err instanceof Error ? err.message : "Airport lookup failed.";
      if (/OPENAI_API_KEY/i.test(message)) {
        throw new HttpsError(
          "failed-precondition",
          "OPENAI_API_KEY is not configured for Cloud Functions."
        );
      }
      throw new HttpsError("internal", message);
    }
  }
);
