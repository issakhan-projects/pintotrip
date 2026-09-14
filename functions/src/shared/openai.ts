import OpenAI from "openai";
import { logger } from "firebase-functions";
import { openaiApiKey } from "./config";
import {
  estimateGpt4oCost,
  usageFromCompletion,
  type AITokenUsage,
} from "./aiUsage";
import {
  LOCATION_INITIAL_SYSTEM_PROMPT,
  LOCATION_VERIFICATION_SYSTEM_PROMPT,
  buildLocationImageUserPrompt,
  buildLocationLinkUserPrompt,
  buildLocationVerificationUserPrompt,
} from "../location/prompts";
import {
  extractJsonObject,
  needsVerification,
  parseModelInitialIdentification,
  parseModelVerifiedIdentification,
  toAnalyzeLocationResult,
  type ModelInitialIdentification,
  type ModelVerifiedIdentification,
} from "../location/parseModelResponse";
import type { AnalyzeLocationResult } from "../location/types";
import {
  CITY_INTELLIGENCE_SYSTEM_PROMPT,
  CITY_TIME_SENSITIVE_SYSTEM_PROMPT,
  buildCityIntelligenceUserPrompt,
  buildCityTimeSensitiveUserPrompt,
} from "../city/prompts";
import {
  buildSlowContextForPrompt,
  extractJsonObject as extractCityJsonObject,
  mergeSlowWithTimeSensitive,
  parseModelCityIntelligence,
  parseModelCityTimeSensitive,
  toCityIntelligenceResult,
  toSlowCityIntelligence,
  type ModelCityIntelligence,
} from "../city/parseModelResponse";
import type {
  CityIntelligenceResult,
  GetCityIntelligenceRequest,
} from "../city/types";
import {
  PLAN_TRIP_SYSTEM_PROMPT,
  buildPlanTripUserPrompt,
} from "../trip/prompts";
import {
  extractJsonObject as extractPlanTripJsonObject,
  parseModelPlanTrip,
} from "../trip/parseModelResponse";
import type {
  LeisureType,
  PlanTripExistingDay,
  PlannedDaySuggestion,
} from "../trip/types";

/** Vision-capable model for landmark / place identification. */
const LOCATION_MODEL = "gpt-5.6-luna";

/** Text model for city travel intelligence synthesis. */
const CITY_INTELLIGENCE_MODEL = "gpt-5.6-luna";

/** Text + web search model for AI trip day filling. */
const PLAN_TRIP_MODEL = "gpt-5.6-luna";

/** Output caps — enough for required JSON, blocks runaway verbosity. */
const LOCATION_MAX_TOKENS = 2200;
const LOCATION_VERIFY_MAX_TOKENS = 2200;
const CITY_MAX_TOKENS = 2800;
const CITY_TIME_SENSITIVE_MAX_TOKENS = 900;
const PLAN_TRIP_MAX_TOKENS = 3500;

/**
 * Server-side OpenAI client factory.
 * Only instantiate inside Cloud Functions that declare the openaiApiKey secret.
 * maxRetries limited to transient failures (SDK retries 408/429/5xx only).
 */
export function createOpenAIClient(): OpenAI {
  const apiKey = openaiApiKey.value();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY secret is not configured");
  }
  return new OpenAI({ apiKey, maxRetries: 2, timeout: 120_000 });
}

export interface OpenAICallMetrics {
  model: string;
  usage: AITokenUsage;
  cost: number;
  verificationPerformed: boolean;
}

export interface OpenAILocationAnalyzer {
  analyzeImage(
    imageUrl: string,
    language: string
  ): Promise<{
    result: AnalyzeLocationResult;
    raw: ModelInitialIdentification | ModelVerifiedIdentification;
    metrics: OpenAICallMetrics;
  }>;
  analyzeLink(
    link: string,
    language: string
  ): Promise<{
    result: AnalyzeLocationResult;
    raw: ModelInitialIdentification | ModelVerifiedIdentification;
    metrics: OpenAICallMetrics;
  }>;
}

export interface OpenAICityIntelligenceAnalyzer {
  analyze(
    input: GetCityIntelligenceRequest & {
      userCountry: string;
      userCurrency: string;
      language: string;
    }
  ): Promise<{
    result: CityIntelligenceResult;
    raw: ModelCityIntelligence;
    metrics: Omit<OpenAICallMetrics, "verificationPerformed">;
  }>;
  /**
   * Refresh visa / FX / budget conversion only, merging into cached slow facts.
   */
  analyzeTimeSensitive(
    input: GetCityIntelligenceRequest & {
      userCountry: string;
      userCurrency: string;
      language: string;
      slow: ModelCityIntelligence;
    }
  ): Promise<{
    result: CityIntelligenceResult;
    raw: ModelCityIntelligence;
    metrics: Omit<OpenAICallMetrics, "verificationPerformed">;
  }>;
}

export interface OpenAITripPlanner {
  plan(input: {
    cityName: string;
    countryName: string;
    lat?: number;
    lon?: number;
    leisureType: LeisureType;
    language: string;
    currency: string;
    emptyDays: PlanTripExistingDay[];
    occupiedDays: PlanTripExistingDay[];
  }): Promise<{
    resultDays: PlannedDaySuggestion[];
    metrics: Omit<OpenAICallMetrics, "verificationPerformed">;
  }>;
}

function mergeMetrics(
  a: OpenAICallMetrics,
  b: OpenAICallMetrics
): OpenAICallMetrics {
  const usage: AITokenUsage = {
    promptTokens: a.usage.promptTokens + b.usage.promptTokens,
    completionTokens: a.usage.completionTokens + b.usage.completionTokens,
    totalTokens: a.usage.totalTokens + b.usage.totalTokens,
  };
  return {
    model: a.model,
    usage,
    cost: Math.round((a.cost + b.cost) * 1_000_000) / 1_000_000,
    verificationPerformed: a.verificationPerformed || b.verificationPerformed,
  };
}

function usageFromResponse(usage?: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
} | null): AITokenUsage {
  const promptTokens = usage?.input_tokens ?? 0;
  const completionTokens = usage?.output_tokens ?? 0;
  const totalTokens =
    usage?.total_tokens ?? promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

/** Compact initial payload for verification (omit unused UI noise). */
function compactInitialForVerification(
  initial: ModelInitialIdentification
): string {
  return JSON.stringify({
    identified: initial.identified,
    placeName: initial.placeName,
    city: initial.city,
    country: initial.country,
    countryCode: initial.countryCode,
    latitude: initial.latitude,
    longitude: initial.longitude,
    confidence: initial.confidence,
    confidenceLevel: initial.confidenceLevel,
    reason: initial.reason,
    isDistinctive: initial.isDistinctive,
    isSpecificPlace: initial.isSpecificPlace,
    hasDistinctiveEvidence: initial.hasDistinctiveEvidence,
    couldMatchMultipleLandmarks: initial.couldMatchMultipleLandmarks,
    possibleAlternatives: initial.possibleAlternatives.slice(0, 5).map((a) => ({
      placeName: a.placeName,
      city: a.city,
      country: a.country,
      confidence: a.confidence,
    })),
    visualClues: initial.visualClues.slice(0, 8),
    suggestedSearchQueries: initial.suggestedSearchQueries.slice(0, 5),
  });
}

async function completeInitialIdentification(
  client: OpenAI,
  userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[]
): Promise<{
  raw: ModelInitialIdentification;
  metrics: OpenAICallMetrics;
}> {
  const completion = await client.chat.completions.create({
    model: LOCATION_MODEL,
    max_completion_tokens: LOCATION_MAX_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: LOCATION_INITIAL_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) {
    throw new Error("OpenAI returned an empty location analysis response.");
  }

  const usage = usageFromCompletion(completion.usage);
  let parsed: unknown;
  try {
    parsed = extractJsonObject(text);
  } catch (err) {
    logger.error("findPlace initial JSON parse failed", {
      finishReason: completion.choices[0]?.finish_reason ?? null,
      textLength: text.length,
      textTail: text.slice(-400),
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
  return {
    raw: parseModelInitialIdentification(parsed),
    metrics: {
      model: LOCATION_MODEL,
      usage,
      cost: estimateGpt4oCost(usage),
      verificationPerformed: false,
    },
  };
}

async function completeVerification(params: {
  client: OpenAI;
  language: string;
  sourceType: "image" | "link";
  imageUrl?: string;
  link?: string;
  initial: ModelInitialIdentification;
}): Promise<{
  raw: ModelVerifiedIdentification;
  metrics: OpenAICallMetrics;
}> {
  const userText = buildLocationVerificationUserPrompt({
    language: params.language,
    sourceType: params.sourceType,
    link: params.link,
    initialJson: compactInitialForVerification(params.initial),
  });

  const userContent: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "high" }
  > = [{ type: "input_text", text: userText }];

  // Re-attach image only when needed for visual comparison (not for link-only).
  if (params.sourceType === "image" && params.imageUrl) {
    userContent.push({
      type: "input_image",
      image_url: params.imageUrl,
      detail: "high",
    });
  }

  // web_search cannot be combined with JSON mode — parse JSON from text instead.
  const response = await params.client.responses.create({
    model: LOCATION_MODEL,
    max_output_tokens: LOCATION_VERIFY_MAX_TOKENS,
    tools: [{ type: "web_search", search_context_size: "medium" }],
    instructions: LOCATION_VERIFICATION_SYSTEM_PROMPT,
    input: [
      {
        role: "user",
        content: userContent,
      },
    ],
  });

  const text = response.output_text;
  if (!text) {
    throw new Error("OpenAI returned an empty location verification response.");
  }

  const usage = usageFromResponse(response.usage);
  let parsed: unknown;
  try {
    parsed = extractJsonObject(text);
  } catch (err) {
    logger.error("findPlace verification JSON parse failed", {
      responseStatus: response.status ?? null,
      incompleteDetails: response.incomplete_details ?? null,
      textLength: text.length,
      textTail: text.slice(-400),
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
  return {
    raw: parseModelVerifiedIdentification(parsed),
    metrics: {
      model: LOCATION_MODEL,
      usage,
      cost: estimateGpt4oCost(usage),
      verificationPerformed: true,
    },
  };
}

async function runAdaptivePipeline(params: {
  client: OpenAI;
  language: string;
  sourceType: "image" | "link";
  imageUrl?: string;
  link?: string;
  initialUserContent: OpenAI.Chat.Completions.ChatCompletionContentPart[];
}): Promise<{
  result: AnalyzeLocationResult;
  raw: ModelInitialIdentification | ModelVerifiedIdentification;
  metrics: OpenAICallMetrics;
}> {
  const initial = await completeInitialIdentification(
    params.client,
    params.initialUserContent
  );

  if (!needsVerification(initial.raw)) {
    return {
      raw: initial.raw,
      result: toAnalyzeLocationResult(initial.raw, {
        verificationPerformed: false,
      }),
      metrics: initial.metrics,
    };
  }

  const verified = await completeVerification({
    client: params.client,
    language: params.language,
    sourceType: params.sourceType,
    imageUrl: params.imageUrl,
    link: params.link,
    initial: initial.raw,
  });

  return {
    raw: verified.raw,
    result: toAnalyzeLocationResult(verified.raw, {
      verificationPerformed: true,
    }),
    metrics: mergeMetrics(initial.metrics, verified.metrics),
  };
}

/**
 * OpenAI-backed visual / link location analyzer with adaptive verification.
 * Clear IDs return after one vision call; uncertain cases run web search.
 */
export function createOpenAILocationAnalyzer(): OpenAILocationAnalyzer {
  const client = createOpenAIClient();

  return {
    async analyzeImage(imageUrl: string, language: string) {
      return runAdaptivePipeline({
        client,
        language,
        sourceType: "image",
        imageUrl,
        initialUserContent: [
          { type: "text", text: buildLocationImageUserPrompt(language) },
          {
            type: "image_url",
            image_url: {
              url: imageUrl,
              // High detail required for landmark recognition quality.
              detail: "high",
            },
          },
        ],
      });
    },

    async analyzeLink(link: string, language: string) {
      return runAdaptivePipeline({
        client,
        language,
        sourceType: "link",
        link,
        initialUserContent: [
          {
            type: "text",
            text: buildLocationLinkUserPrompt(language, link),
          },
        ],
      });
    },
  };
}

/**
 * OpenAI-backed city travel intelligence analyzer.
 * Visa / FX should eventually be cross-checked with authoritative providers.
 */
export function createOpenAICityIntelligenceAnalyzer(): OpenAICityIntelligenceAnalyzer {
  const client = createOpenAIClient();

  return {
    async analyze(input) {
      const generatedAt = new Date().toISOString();

      const completion = await client.chat.completions.create({
        model: CITY_INTELLIGENCE_MODEL,
        max_completion_tokens: CITY_MAX_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: CITY_INTELLIGENCE_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildCityIntelligenceUserPrompt({
              city: input.city,
              country: input.country,
              lat: input.lat,
              lon: input.lon,
              userCountry: input.userCountry,
              userCurrency: input.userCurrency,
              language: input.language,
              currentDateIso: generatedAt,
            }),
          },
        ],
      });

      const text = completion.choices[0]?.message?.content;
      if (!text) {
        throw new Error("OpenAI returned an empty city intelligence response.");
      }

      const usage = usageFromCompletion(completion.usage);
      const raw = parseModelCityIntelligence(extractCityJsonObject(text));
      const result = toCityIntelligenceResult(raw, {
        userCountry: input.userCountry,
        generatedAt,
      });

      return {
        raw,
        result,
        metrics: {
          model: CITY_INTELLIGENCE_MODEL,
          usage,
          cost: estimateGpt4oCost(usage),
        },
      };
    },

    async analyzeTimeSensitive(input) {
      const generatedAt = new Date().toISOString();
      const slowContextJson = buildSlowContextForPrompt(input.slow);

      const completion = await client.chat.completions.create({
        model: CITY_INTELLIGENCE_MODEL,
        max_completion_tokens: CITY_TIME_SENSITIVE_MAX_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: CITY_TIME_SENSITIVE_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildCityTimeSensitiveUserPrompt({
              city: input.city,
              country: input.country,
              userCountry: input.userCountry,
              userCurrency: input.userCurrency,
              language: input.language,
              currentDateIso: generatedAt,
              localCurrencyCode: input.slow.currency.code,
              slowContextJson,
            }),
          },
        ],
      });

      const text = completion.choices[0]?.message?.content;
      if (!text) {
        throw new Error(
          "OpenAI returned an empty time-sensitive city intelligence response."
        );
      }

      const usage = usageFromCompletion(completion.usage);
      const patch = parseModelCityTimeSensitive(extractCityJsonObject(text));
      const raw = mergeSlowWithTimeSensitive(input.slow, patch);
      const result = toCityIntelligenceResult(raw, {
        userCountry: input.userCountry,
        generatedAt,
      });

      return {
        raw,
        result,
        metrics: {
          model: CITY_INTELLIGENCE_MODEL,
          usage,
          cost: estimateGpt4oCost(usage),
        },
      };
    },
  };
}

export { toSlowCityIntelligence };

/**
 * OpenAI-backed trip day filler. Uses web search for real place grounding.
 */
export function createOpenAITripPlanner(): OpenAITripPlanner {
  const client = createOpenAIClient();

  return {
    async plan(input) {
      const userPrompt = buildPlanTripUserPrompt(input);

      const response = await client.responses.create({
        model: PLAN_TRIP_MODEL,
        max_output_tokens: PLAN_TRIP_MAX_TOKENS,
        tools: [{ type: "web_search", search_context_size: "medium" }],
        instructions: PLAN_TRIP_SYSTEM_PROMPT,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: userPrompt }],
          },
        ],
      });

      const text = response.output_text;
      if (!text) {
        throw new Error("OpenAI returned an empty trip plan response.");
      }

      const usage = usageFromResponse(response.usage);
      const resultDays = parseModelPlanTrip(
        extractPlanTripJsonObject(text),
        input.cityName,
        input.countryName
      );

      return {
        resultDays,
        metrics: {
          model: PLAN_TRIP_MODEL,
          usage,
          cost: estimateGpt4oCost(usage),
        },
      };
    },
  };
}
