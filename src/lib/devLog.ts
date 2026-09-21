/**
 * Client console helpers that only emit on localhost / local development.
 * Production builds must not dump DDS, AI payloads, or other confidential data.
 */

function isLocalHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".localhost")
  );
}

/** True when logs are allowed (local hostname or Next.js development). */
export function isDevLoggingEnabled(): boolean {
  if (
    typeof process !== "undefined" &&
    process.env.NODE_ENV === "development"
  ) {
    return true;
  }
  if (typeof window !== "undefined") {
    return isLocalHost(window.location.hostname);
  }
  return false;
}

type LogFn = (...args: unknown[]) => void;

function createDevLog(method: "log" | "info" | "warn" | "error" | "debug"): LogFn {
  return (...args: unknown[]) => {
    if (!isDevLoggingEnabled()) return;
    // eslint-disable-next-line no-console -- intentional localhost-only logging
    console[method](...args);
  };
}

export const devLog = {
  log: createDevLog("log"),
  info: createDevLog("info"),
  warn: createDevLog("warn"),
  error: createDevLog("error"),
  debug: createDevLog("debug"),
} as const;
