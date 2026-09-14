import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import {
  DEFAULT_FUNCTIONS_REGION,
  paddleSecrets,
} from "../shared/config";
import { initAdmin } from "../shared/admin";
import { unmarshalPaddleWebhook } from "./paddleClient";
import { processPaddleEvent } from "./processEvent";

type RequestWithRawBody = {
  method?: string;
  rawBody?: Buffer;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  get(name: string): string | undefined;
};

function readHeader(req: RequestWithRawBody, name: string): string {
  const fromGet = req.get(name);
  if (fromGet?.trim()) return fromGet.trim();
  const raw = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  if (Array.isArray(raw)) return (raw[0] ?? "").trim();
  if (typeof raw === "string") return raw.trim();
  return "";
}

/**
 * Exact bytes Paddle signed. Prefer Firebase `rawBody` Buffer.
 * Never JSON.stringify a parsed object — that breaks HMAC.
 */
function readRawBody(req: RequestWithRawBody): string {
  if (Buffer.isBuffer(req.rawBody)) {
    return req.rawBody.toString("utf8");
  }
  if (typeof req.body === "string") {
    return req.body;
  }
  if (Buffer.isBuffer(req.body)) {
    return req.body.toString("utf8");
  }
  return "";
}

/**
 * HTTP webhook for Paddle Billing notifications (sandbox + live).
 *
 * URL (after deploy):
 *   https://us-central1-<project>.cloudfunctions.net/paddleWebhook
 *
 * Point both sandbox and live notification destinations at this URL.
 * Signature is verified against both destination secrets (pdl_ntfset_…).
 */
export const paddleWebhook = onRequest(
  {
    region: DEFAULT_FUNCTIONS_REGION,
    secrets: [...paddleSecrets],
    invoker: "public",
    cors: false,
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async (request, response) => {
    initAdmin();

    const req = request as unknown as RequestWithRawBody;

    if (req.method !== "POST") {
      response.status(405).send("Method Not Allowed");
      return;
    }

    const signature = readHeader(req, "paddle-signature");
    const rawBody = readRawBody(req);

    if (!signature || !rawBody) {
      logger.error("paddleWebhook missing signature or raw body", {
        hasSignature: Boolean(signature),
        bodyType: Buffer.isBuffer(req.rawBody)
          ? "rawBody-buffer"
          : typeof req.body,
        bodyLength: rawBody.length,
      });
      response.status(400).json({ error: "Missing signature or body" });
      return;
    }

    try {
      const { event, environment } = await unmarshalPaddleWebhook({
        rawBody,
        signature,
      });

      await processPaddleEvent(event, environment);

      response.status(200).json({ received: true, environment });
    } catch (err) {
      logger.error("paddleWebhook failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      // Non-2xx → Paddle retries (rotated secret, transient failure, etc.).
      response.status(500).json({ error: "Internal error" });
    }
  }
);
