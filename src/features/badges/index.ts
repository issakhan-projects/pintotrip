export { BADGE_CATALOG, getBadgeDefinition } from "./catalog";
export type { BadgeDefinition, BadgeIconName } from "./catalog";
export { buildBadgeActivityStats } from "./stats";
export {
  evaluateBadges,
  findNewlyEarnedBadgeIds,
  mergeEarnedBadges,
  countEarned,
} from "./evaluate";
export type { BadgeProgress } from "./evaluate";
export { syncEarnedBadges } from "./syncEarnedBadges";
export { BadgesView } from "./BadgesView";
export { BadgesPreview } from "./BadgesPreview";
export { BadgeIcon } from "./badgeIcons";
