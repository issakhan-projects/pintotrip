import type { Environments } from "@paddle/paddle-js";

/**
 * Public Paddle Billing config (NEXT_PUBLIC_* only).
 * Keep both sandbox + live client tokens; pick by hostname.
 *
 * - localhost / 127.0.0.1 / *.vercel.app → sandbox
 * - pintototrip.app / pintotrip.com → live (production)
 *
 * Optional override: NEXT_PUBLIC_PADDLE_FORCE_ENVIRONMENT=sandbox|production
 *
 * IMPORTANT: Next.js only inlines NEXT_PUBLIC_* when accessed as static literals.
 */

export type PaddlePublicEnv = {
  environment: Environments;
  clientToken: string;
};

function missingEnv(name: string): never {
  throw new Error(
    `Missing required public environment variable: ${name}. See .env.example.`
  );
}

function invalidEnv(name: string, detail: string): never {
  throw new Error(`Invalid ${name}: ${detail}. See .env.example.`);
}

const PRODUCTION_HOSTS = new Set([
  "pintototrip.app",
  "www.pintototrip.app",
  "pintotrip.com",
  "www.pintotrip.com",
]);

/**
 * Resolve Paddle Billing environment from the browser hostname.
 * Defaults unknown hosts to sandbox to avoid accidental live charges.
 */
export function resolvePaddleEnvironmentFromHost(
  hostname?: string | null
): Environments {
  const force = process.env.NEXT_PUBLIC_PADDLE_FORCE_ENVIRONMENT?.trim().toLowerCase();
  if (force === "sandbox" || force === "production") {
    return force;
  }

  const host = (hostname ?? "").trim().toLowerCase();
  if (
    !host ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".localhost") ||
    host.endsWith(".vercel.app")
  ) {
    return "sandbox";
  }

  if (PRODUCTION_HOSTS.has(host)) {
    return "production";
  }

  return "sandbox";
}

function readClientToken(environment: Environments): string {
  if (environment === "production") {
    const live = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN_LIVE?.trim();
    if (live) return live;
    // Backward-compatible single-token fallback
    const legacy = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN?.trim();
    if (legacy?.startsWith("live_")) return legacy;
    missingEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN_LIVE");
  }

  const sandbox = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN_SANDBOX?.trim();
  if (sandbox) return sandbox;
  const legacy = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN?.trim();
  if (legacy?.startsWith("test_")) return legacy;
  missingEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN_SANDBOX");
}

/**
 * Validates and returns client-safe Paddle configuration for this page load.
 */
export function getPaddlePublicEnv(
  hostname?: string | null
): PaddlePublicEnv {
  const host =
    hostname ??
    (typeof window !== "undefined" ? window.location.hostname : "");
  const environment = resolvePaddleEnvironmentFromHost(host);
  const clientToken = readClientToken(environment);

  if (environment === "production" && !clientToken.startsWith("live_")) {
    invalidEnv(
      "NEXT_PUBLIC_PADDLE_CLIENT_TOKEN_LIVE",
      'production requires a live client token (prefix "live_")'
    );
  }
  if (environment === "sandbox" && !clientToken.startsWith("test_")) {
    invalidEnv(
      "NEXT_PUBLIC_PADDLE_CLIENT_TOKEN_SANDBOX",
      'sandbox requires a test client token (prefix "test_")'
    );
  }

  return { environment, clientToken };
}

export function hasPaddlePublicEnvConfigured(
  hostname?: string | null
): boolean {
  try {
    getPaddlePublicEnv(hostname);
    return true;
  } catch {
    return false;
  }
}
