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
 * Verify webhook signature against sandbox then live secrets.
 * Uses the matching API key / environment for the destination that signed it.
 */
export async function unmarshalPaddleWebhook(input: {
  rawBody: string;
  signature: string;
}): Promise<UnmarshaledPaddleEvent> {
  const attempts: PaddleBillingEnvironment[] = ["sandbox", "production"];
  const errors: string[] = [];

  logger.info("paddle webhook verify attempt", {
    bodyBytes: Buffer.byteLength(input.rawBody, "utf8"),
    signaturePresent: Boolean(input.signature),
    signaturePreview: input.signature.slice(0, 24),
    sandboxSecret: describeSecret(webhookSecretFor("sandbox")),
    liveSecret: describeSecret(webhookSecretFor("production")),
  });

  for (const environment of attempts) {
    const secret = webhookSecretFor(environment);
    if (!secret) {
      errors.push(`${environment}: secret not configured`);
      continue;
    }
    if (!secret.startsWith("pdl_ntfset_")) {
      errors.push(
        `${environment}: secret must be the notification endpoint secret (pdl_ntfset_…), not the API key`
      );
      continue;
    }
    try {
      const paddle = getPaddleServer(environment);
      const event = await paddle.webhooks.unmarshal(
        input.rawBody,
        secret,
        input.signature
      );
      if (event) {
        return { event, environment };
      }
    } catch (err) {
      errors.push(
        `${environment}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  throw new Error(
    `Paddle webhook signature verification failed (${errors.join("; ")})`
  );
}
