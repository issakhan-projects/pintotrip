import {
  findNewlyEarnedBadgeIds,
  mergeEarnedBadges,
  type BadgeProgress,
} from "@/features/badges/evaluate";
import { updateUserProfile } from "@/services/users";
import type { EarnedBadgesMap } from "@/types/badge";

/**
 * Persist newly unlocked badges onto the user profile.
 * Safe to call often — no-ops when nothing new.
 */
export async function syncEarnedBadges(params: {
  userId: string;
  progress: BadgeProgress[];
  earnedBadges?: EarnedBadgesMap | null;
}): Promise<EarnedBadgesMap | null> {
  const newly = findNewlyEarnedBadgeIds(params.progress, params.earnedBadges);
  if (newly.length === 0) return params.earnedBadges ?? null;

  const next = mergeEarnedBadges(params.earnedBadges, newly);
  await updateUserProfile(params.userId, { earnedBadges: next });
  return next;
}
