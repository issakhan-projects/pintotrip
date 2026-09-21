/**
 * Temporary debug endpoint: AI-fill missing routes, then free-time places +
 * non-flight route fares via OpenAI.
 * Uses server-only OPENAI_API_KEY — never expose to the browser.
 * Later this logic folds into functions/src/trip/planTrip.ts.
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  buildFillPlacesPayload,
  extractJsonObject,
  mergeAiPlacesIntoItinerary,
} from "@/lib/planner/fill-places-ai";
import {
  buildFillRoutesPayload,
  mergeAiRoutesIntoItinerary,
} from "@/lib/planner/fill-routes-ai";
import { applyFreeTimePlacesFromRoutes } from "@/lib/planner/generate-trip-planner-ai-routes";
import type {
  TripPlannerAiRequest,
  TripPlannerAiResponseDay,
} from "@/types/trip-planner-ai-request";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = process.env.OPENAI_TRIP_PLACES_MODEL?.trim() || "gpt-5.6-luna";

/** gpt-5.* counts reasoning against max_completion_tokens — keep headroom. */
const ROUTES_MAX_TOKENS = 8_000;
const PLACES_MAX_TOKENS = 12_000;

type Body = {
  request?: TripPlannerAiRequest;
  /** Skeleton itinerary: existing routes only (empty days ok). */
  itinerary?: TripPlannerAiResponseDay[];
  language?: string;
};

type ReasoningEffort = "minimal" | "low" | "medium" | "high";

async function chatJson(
  client: OpenAI,
  system: string,
  user: string,
  maxTokens: number,
  reasoningEffort: ReasoningEffort = "low"
): Promise<string> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    max_completion_tokens: maxTokens,
    reasoning_effort: reasoningEffort,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const choice = completion.choices[0];
  const text = choice?.message?.content;
  if (text?.trim()) return text;

  const finishReason = choice?.finish_reason ?? null;
  const reasoningTokens =
    completion.usage?.completion_tokens_details?.reasoning_tokens ?? null;
  const completionTokens = completion.usage?.completion_tokens ?? null;

  // Common gpt-5 failure: budget spent on reasoning → empty visible content.
  if (finishReason === "length" || (reasoningTokens != null && !text?.trim())) {
    const retryTokens = Math.min(maxTokens * 2, 24_000);
    const retry = await client.chat.completions.create({
      model: MODEL,
      max_completion_tokens: retryTokens,
      reasoning_effort: "minimal",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const retryText = retry.choices[0]?.message?.content;
    if (retryText?.trim()) return retryText;

    throw new Error(
      `OpenAI returned an empty response (finish_reason=${retry.choices[0]?.finish_reason ?? finishReason}, reasoning_tokens=${retry.usage?.completion_tokens_details?.reasoning_tokens ?? reasoningTokens}, completion_tokens=${retry.usage?.completion_tokens ?? completionTokens}).`
    );
  }

  throw new Error(
    `OpenAI returned an empty response (finish_reason=${finishReason}, reasoning_tokens=${reasoningTokens}, completion_tokens=${completionTokens}).`
  );
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "OPENAI_API_KEY is not set in .env.local (server-only). Add it to test place fill.",
      },
      { status: 503 }
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const request = body.request;
  const itinerary = body.itinerary;
  if (!request?.trip?.tripId || !Array.isArray(itinerary)) {
    return NextResponse.json(
      { error: "request and itinerary are required." },
      { status: 400 }
    );
  }

  const client = new OpenAI({ apiKey });

  // --- Pass 1: AI fills missing / empty routes ---
  let withRoutes: TripPlannerAiResponseDay[];
  try {
    const { system, user } = buildFillRoutesPayload(
      request,
      itinerary,
      body.language
    );
    const text = await chatJson(
      client,
      system,
      user,
      ROUTES_MAX_TOKENS,
      "low"
    );
    const parsed = extractJsonObject(text);
    withRoutes = mergeAiRoutesIntoItinerary(itinerary, parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `OpenAI route fill failed: ${message}` },
      { status: 502 }
    );
  }

  // Deterministic free-time + saved place refs from finalized routes.
  const withFreeTime = applyFreeTimePlacesFromRoutes(request, withRoutes);

  const hasSlots = withFreeTime.some(
    (day) => Array.isArray(day.places) && day.places.length > 0
  );
  const hasNonFlightRoutes = withFreeTime.some((day) =>
    (day.routes ?? []).some((r) => r.transport !== "flight")
  );

  if (!hasSlots && !hasNonFlightRoutes) {
    return NextResponse.json({
      success: true,
      itinerary: withFreeTime,
      model: MODEL,
      stages: ["routes"],
    });
  }

  // --- Pass 2: AI fills places + non-flight fares ---
  try {
    const { system, user } = buildFillPlacesPayload(
      request,
      withFreeTime,
      body.language
    );
    const text = await chatJson(
      client,
      system,
      user,
      PLACES_MAX_TOKENS,
      "low"
    );
    const parsed = extractJsonObject(text);
    const merged = mergeAiPlacesIntoItinerary(
      withFreeTime,
      parsed,
      request.destinations
    );

    return NextResponse.json({
      success: true,
      itinerary: merged,
      model: MODEL,
      stages: ["routes", "places"],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Routes already succeeded — return them (200) so the client can inspect.
    return NextResponse.json({
      success: true,
      itinerary: withFreeTime,
      model: MODEL,
      stages: ["routes"],
      warning: `Place fill skipped: ${message}`,
    });
  }
}
