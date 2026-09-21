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
  PlannedDaySuggestion,
  PlannedRouteSuggestion,
  TripPlanningContext,
  LeisureType,
} from "../trip/types";
import {
  FILL_PLACES_SYSTEM_PROMPT,
  buildFillPlacesUserPrompt,
} from "../trip/fillPlacesPrompts";

/** Vision-capable / lightweight text model for landmark + metadata enrichment. */
export const LOCATION_MODEL = "gpt-5.6-luna";

/** Text model for city travel intelligence synthesis. */
const CITY_INTELLIGENCE_MODEL = "gpt-5.6-luna";

/** Text + web search model for AI trip day filling. */
const PLAN_TRIP_MODEL = "gpt-5.6-luna";

/** Output caps — enough for required JSON, blocks runaway verbosity. */
const LOCATION_MAX_TOKENS = 2200;
const LOCATION_VERIFY_MAX_TOKENS = 2200;
const CITY_MAX_TOKENS = 2800;
const CITY_TIME_SENSITIVE_MAX_TOKENS = 900;
const PLAN_TRIP_MAX_TOKENS = 4500;

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
    input: {
      city: string;
      country: string;
      lat: number;
      lon: number;
      userCountry: string;
      userCurrency: string;
      language: string;
      cityId: string;
      countryId: string;
    }
  ): Promise<{
    result: CityIntelligenceResult;
    raw: ModelCityIntelligence;
    metrics: Omit<OpenAICallMetrics, "verificationPerformed">;
  }>;
  /**
   * Refresh visa / local budget only, merging into cached slow facts.
   * Exchange rates are attached separately via Frankfurter.
   */
  analyzeTimeSensitive(
    input: {
      city: string;
      country: string;
      lat: number;
      lon: number;
      userCountry: string;
      userCurrency: string;
      language: string;
      cityId: string;
      countryId: string;
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
    context: TripPlanningContext;
    language: string;
    primaryCityName: string;
    primaryCountryName: string;
  }): Promise<{
    resultDays: PlannedDaySuggestion[];
    resultRoutes: PlannedRouteSuggestion[];
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
 * FX rates come from Frankfurter — never from the model.
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
        cityId: input.cityId,
        countryId: input.countryId,
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
        cityId: input.cityId,
        countryId: input.countryId,
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
 * OpenAI-backed trip itinerary planner. Leisure type shapes style;
 * web search grounds places and transfer fares when needed.
 */
export function createOpenAITripPlanner(): OpenAITripPlanner {
  const client = createOpenAIClient();

  return {
    async plan(input) {
      const userPrompt = buildPlanTripUserPrompt({
        context: input.context,
        language: input.language,
      });

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
      let parsed;
      try {
        parsed = parseModelPlanTrip(
          extractPlanTripJsonObject(text),
          input.primaryCityName,
          input.primaryCountryName
        );
      } catch (err) {
        logger.error("planTrip model JSON parse failed", {
          error: err instanceof Error ? err.message : String(err),
          responseChars: text.length,
          responsePreview: text.slice(0, 800),
          responseTail: text.slice(-400),
        });
        throw err;
      }

      return {
        resultDays: parsed.days,
        resultRoutes: parsed.routes,
        metrics: {
          model: PLAN_TRIP_MODEL,
          usage,
          cost: estimateGpt4oCost(usage),
        },
      };
    },
  };
}

const FILL_PLACES_MAX_TOKENS = 4500;

export type OpenAIPlacesFiller = {
  fill(input: {
    language?: string;
    leisureType?: LeisureType;
    leisureCustom?: string;
    currency?: string;
    destinationsJson: string;
    itineraryJson: string;
  }): Promise<{
    text: string;
    metrics: { model: string; usage: AITokenUsage; cost: number };
  }>;
};

/**
 * OpenAI filler for trip free-time place slots (saved refs + new locations).
 */
export function createOpenAIPlacesFiller(): OpenAIPlacesFiller {
  const client = createOpenAIClient();

  return {
    async fill(input) {
      const userPrompt = buildFillPlacesUserPrompt({
        language: input.language,
        leisureType: input.leisureType,
        leisureCustom: input.leisureCustom,
        currency: input.currency,
        destinationsJson: input.destinationsJson,
        itineraryJson: input.itineraryJson,
      });

      const response = await client.responses.create({
        model: PLAN_TRIP_MODEL,
        max_output_tokens: FILL_PLACES_MAX_TOKENS,
        tools: [{ type: "web_search", search_context_size: "medium" }],
        instructions: FILL_PLACES_SYSTEM_PROMPT,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: userPrompt }],
          },
        ],
      });

      const text = response.output_text;
      if (!text) {
        throw new Error("OpenAI returned an empty places fill response.");
      }

      const usage = usageFromResponse(response.usage);
      return {
        text,
        metrics: {
          model: PLAN_TRIP_MODEL,
          usage,
          cost: estimateGpt4oCost(usage),
        },
      };
    },
  };
}

type ReasoningEffort = "minimal" | "low" | "medium" | "high";

/**
 * Chat Completions JSON helper for Trip Planner AI stages (routes / places).
 * Uses max_completion_tokens + low reasoning; retries on empty content.
 */
export async function completeTripPlannerAiJson(params: {
  system: string;
  user: string;
  maxCompletionTokens: number;
  reasoningEffort?: ReasoningEffort;
}): Promise<{
  text: string;
  metrics: { model: string; usage: AITokenUsage; cost: number };
}> {
  const client = createOpenAIClient();
  const reasoningEffort = params.reasoningEffort ?? "low";

  const run = async (maxTokens: number, effort: ReasoningEffort) => {
    const completion = await client.chat.completions.create({
      model: PLAN_TRIP_MODEL,
      max_completion_tokens: maxTokens,
      reasoning_effort: effort,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
    });
    return completion;
  };

  let completion = await run(params.maxCompletionTokens, reasoningEffort);
  let text = completion.choices[0]?.message?.content?.trim() ?? "";

  if (!text) {
    const retryTokens = Math.min(params.maxCompletionTokens * 2, 24_000);
    completion = await run(retryTokens, "minimal");
    text = completion.choices[0]?.message?.content?.trim() ?? "";
  }

  if (!text) {
    const finishReason = completion.choices[0]?.finish_reason ?? null;
    const reasoningTokens =
      completion.usage?.completion_tokens_details?.reasoning_tokens ?? null;
    throw new Error(
      `OpenAI returned an empty Trip Planner AI response (finish_reason=${finishReason}, reasoning_tokens=${reasoningTokens}).`
    );
  }

  const usage = usageFromCompletion(completion.usage);
  return {
    text,
    metrics: {
      model: PLAN_TRIP_MODEL,
      usage,
      cost: estimateGpt4oCost(usage),
    },
  };
}
