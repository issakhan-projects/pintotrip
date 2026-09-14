import type { LocationStatus } from "@/types/location";

/**
 * Stable ASCII machine id from a place/city/country name.
 * Display names may be localized; ids must stay English/ASCII.
 */
export function slugifyId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "unknown";
}

/** True when value is already a usable ASCII slug (or ISO alpha-2). */
export function isAsciiId(value: string | undefined | null): boolean {
  const trimmed = value?.trim().toLowerCase() ?? "";
  // slugifyId uses "unknown" when the name has no Latin characters.
  if (!trimmed || trimmed === "unknown") return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed);
}

/** Prefer ISO alpha-2 (lowercase); fall back to ASCII slug of country name. */
export function countryIdFromParts(
  countryName: string,
  countryCode?: string | null
): string {
  const code = countryCode?.trim().toUpperCase();
  if (code && /^[A-Z]{2}$/.test(code)) return code.toLowerCase();
  return slugifyId(countryName);
}

/**
 * Prefer an existing ASCII id; otherwise slugify the English/fallback name.
 */
export function resolveAsciiId(
  preferredId: string | undefined | null,
  fallbackName: string
): string {
  const preferred = preferredId?.trim().toLowerCase() ?? "";
  if (isAsciiId(preferred)) return preferred;
  return slugifyId(fallbackName);
}

export function statusLabel(status: LocationStatus): string {
  switch (status) {
    case "planned":
      return "Planned";
    case "visited":
      return "Visited";
    case "cancelled":
      return "Cancelled";
  }
}

export function statusColorVar(status: LocationStatus): string {
  switch (status) {
    case "planned":
      return "var(--color-planned)";
    case "visited":
      return "var(--color-visited)";
    case "cancelled":
      return "var(--color-cancelled)";
  }
}

export function confidencePercent(confidence: number): number {
  return Math.round(Math.min(1, Math.max(0, confidence)) * 100);
}

export function formatConfidenceCopy(confidence: number): {
  label: string;
  detail?: string;
} {
  // High-confidence IDs: avoid surfacing a confidence % unless useful.
  if (confidence >= 0.85) {
    return { label: "Found it" };
  }
  if (confidence >= 0.7) {
    return {
      label: "Likely location",
      detail: `${confidencePercent(confidence)}% confidence`,
    };
  }
  return {
    label: "Uncertain match",
    detail: "Exact location could not be confirmed.",
  };
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
