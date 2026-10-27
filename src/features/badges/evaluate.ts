import type {
  BadgeActivityStats,
  BadgeId,
  EarnedBadgesMap,
} from "@/types/badge";
import { BADGE_CATALOG, type BadgeDefinition } from "@/features/badges/catalog";

export type BadgeProgress = {
  definition: BadgeDefinition;
  current: number;
  target: number;
  /** 0–1 clamped progress toward unlock. */
  ratio: number;
  earned: boolean;
  /** Epoch millis when first unlocked (persisted), if known. */
  earnedAt?: number;
};

export function evaluateBadges(
  stats: BadgeActivityStats,
  earnedBadges?: EarnedBadgesMap | null
): BadgeProgress[] {
  return BADGE_CATALOG.map((definition) => {
    const current = stats[definition.metric] ?? 0;
    const target = definition.target;
    const earned = current >= target;
    const earnedAt = earnedBadges?.[definition.id];
    return {
      definition,
      current: Math.min(current, target),
      target,
      ratio: target <= 0 ? 1 : Math.min(1, current / target),
      earned,
      earnedAt: typeof earnedAt === "number" ? earnedAt : undefined,
    };
  });
}

/** Badge ids that are earned now but missing from the persisted map. */
export function findNewlyEarnedBadgeIds(
  progress: BadgeProgress[],
  earnedBadges?: EarnedBadgesMap | null
): BadgeId[] {
  return progress
    .filter((p) => p.earned && earnedBadges?.[p.definition.id] == null)
    .map((p) => p.definition.id);
}

export function mergeEarnedBadges(
  existing: EarnedBadgesMap | null | undefined,
  newlyEarned: BadgeId[],
  now = Date.now()
): EarnedBadgesMap {
  const next: EarnedBadgesMap = { ...(existing ?? {}) };
  for (const id of newlyEarned) {
    if (next[id] == null) next[id] = now;
  }
  return next;
}

export function countEarned(progress: BadgeProgress[]): number {
  return progress.filter((p) => p.earned).length;
}
