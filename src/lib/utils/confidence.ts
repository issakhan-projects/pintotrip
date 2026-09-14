/**
 * Confidence helpers shared by services (not UI styling).
 */

export function clampConfidence(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function isHighConfidence(confidence: number): boolean {
  return confidence >= 0.85;
}

export function isMediumConfidence(confidence: number): boolean {
  return confidence >= 0.7 && confidence < 0.85;
}

export function isLowConfidence(confidence: number): boolean {
  return confidence < 0.7;
}
