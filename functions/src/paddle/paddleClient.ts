import {
  Environment,
  LogLevel,
  Paddle,
  type EventEntity,
  type PaddleOptions,
} from "@paddle/paddle-node-sdk";
import { logger } from "firebase-functions";
import {
  paddleApiKeyLive,
  paddleApiKeySandbox,
  paddleWebhookSecretLive,
  paddleWebhookSecretSandbox,
} from "../shared/config";

export type PaddleBillingEnvironment = "sandbox" | "production";

/** Strip quotes/newlines that Secret Manager pastes sometimes include. */
function normalizeSecret(value: string | undefined | null): string {
  return (value ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\r?\n/g, "");
}

function apiKeyFor(environment: PaddleBillingEnvironment): string {
  const key = normalizeSecret(
    environment === "production"
      ? paddleApiKeyLive.value()
      : paddleApiKeySandbox.value()
  );
  if (!key) {
    throw new Error(
      environment === "production"
        ? "PADDLE_API_KEY_LIVE is not set"
        : "PADDLE_API_KEY_SANDBOX is not set"
    );
  }
  return key;
}

function webhookSecretFor(environment: PaddleBillingEnvironment): string {
  return normalizeSecret(
    environment === "production"
      ? paddleWebhookSecretLive.value()
      : paddleWebhookSecretSandbox.value()
  );
}

function describeSecret(secret: string): string {
  if (!secret) return "missing";
  const prefix = secret.slice(0, 12);
  return `len=${secret.length} prefix=${prefix}… looksLikeEndpointSecret=${secret.startsWith("pdl_ntfset_")}`;
}

/**
 * Server-only Paddle Billing client for a specific account environment.
 */
export function getPaddleServer(environment: PaddleBillingEnvironment): Paddle {
  const options: PaddleOptions = {
    environment:
      environment === "production"
        ? Environment.production
        : Environment.sandbox,
    logLevel: LogLevel.error,
  };
  return new Paddle(apiKeyFor(environment), options);
}

export type UnmarshaledPaddleEvent = {
  event: EventEntity;
  environment: PaddleBillingEnvironment;
};

/**
 * Verify webhook signature against live + sandbox secrets in parallel.
 * Uses the matching API key / environment for the destination that signed it.
 */
export async function unmarshalPaddleWebhook(input: {
  rawBody: string;
  signature: string;
}): Promise<UnmarshaledPaddleEvent> {
  // Prefer production first — most traffic is live; sandbox still tried in parallel.
  const attempts: PaddleBillingEnvironment[] = ["production", "sandbox"];

  logger.info("paddle webhook verify attempt", {
    bodyBytes: Buffer.byteLength(input.rawBody, "utf8"),
    signaturePresent: Boolean(input.signature),
    signaturePreview: input.signature.slice(0, 24),
    sandboxSecret: describeSecret(webhookSecretFor("sandbox")),
    liveSecret: describeSecret(webhookSecretFor("production")),
  });

  const results = await Promise.all(
    attempts.map(async (environment) => {
      const secret = webhookSecretFor(environment);
      if (!secret) {
        return {
          environment,
          error: `${environment}: secret not configured`,
        } as const;
      }
      if (!secret.startsWith("pdl_ntfset_")) {
        return {
          environment,
          error: `${environment}: secret must be the notification endpoint secret (pdl_ntfset_…), not the API key`,
        } as const;
      }
      try {
        const paddle = getPaddleServer(environment);
        const event = await paddle.webhooks.unmarshal(
          input.rawBody,
          secret,
          input.signature
        );
        if (event) {
          return { environment, event } as const;
        }
        return {
          environment,
          error: `${environment}: unmarshal returned empty`,
        } as const;
      } catch (err) {
        return {
          environment,
          error: `${environment}: ${err instanceof Error ? err.message : String(err)}`,
        } as const;
      }
    })
  );

  for (const environment of attempts) {
    const hit = results.find(
      (r) => r.environment === environment && "event" in r && r.event
    );
    if (hit && "event" in hit && hit.event) {
      return { event: hit.event, environment: hit.environment };
    }
  }

  const errors = results.map((r) =>
    "error" in r ? r.error : `${r.environment}: unknown`
  );
  throw new Error(
    `Paddle webhook signature verification failed (${errors.join("; ")})`
  );
}
