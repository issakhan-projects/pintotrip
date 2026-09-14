/**
 * Centralized scoring for Travel Intelligence.
 * Keep formulas here — do not scatter across aggregators.
 */

export interface PopularityInputs {
  savedCount: number;
  visitedCount: number;
  plannedCount: number;
  cancelledCount?: number;
  favoriteCount?: number;
}

export interface TrendingInputs extends PopularityInputs {
  /** Saves / activity in the recent window (e.g. last 7 days). */
  recentSaves: number;
  /** Growth vs prior window (can be negative). */
  recentGrowth: number;
}

/** Tunable weights for popularity. */
export const POPULARITY_WEIGHTS = {
  saved: 1,
  visited: 2.5,
  planned: 0.6,
  cancelled: -0.2,
  favorite: 1.5,
} as const;

/** Tunable weights for trending. */
export const TRENDING_WEIGHTS = {
  recentGrowth: 4,
  recentSaves: 3,
  visitRate: 2,
  popularity: 0.1,
} as const;

export function calculatePopularityScore(input: PopularityInputs): number {
  const cancelled = input.cancelledCount ?? 0;
  const favorite = input.favoriteCount ?? 0;
  const raw =
    input.savedCount * POPULARITY_WEIGHTS.saved +
    input.visitedCount * POPULARITY_WEIGHTS.visited +
    input.plannedCount * POPULARITY_WEIGHTS.planned +
    cancelled * POPULARITY_WEIGHTS.cancelled +
    favorite * POPULARITY_WEIGHTS.favorite;
  return roundScore(Math.max(0, raw));
}

/**
 * Trending favors recent growth over raw historical popularity.
 * A place with 10k old saves should not beat one with a sudden 100 saves.
 */
export function calculateTrendingScore(input: TrendingInputs): number {
  const denominator = Math.max(input.savedCount, 1);
  const visitRate = input.visitedCount / denominator;
  const popularity = calculatePopularityScore(input);

  const raw =
    Math.max(0, input.recentGrowth) * TRENDING_WEIGHTS.recentGrowth +
    Math.max(0, input.recentSaves) * TRENDING_WEIGHTS.recentSaves +
    visitRate * 100 * TRENDING_WEIGHTS.visitRate +
    popularity * TRENDING_WEIGHTS.popularity;

  return roundScore(Math.max(0, raw));
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}
