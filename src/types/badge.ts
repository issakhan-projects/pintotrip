/**
 * Travel achievement badges earned from in-app activity.
 * Machine ids are English/ASCII lowercase slugs.
 */

export const BADGE_IDS = [
  "first-pin",
  "collector",
  "place-hunter",
  "first-visit",
  "explorer",
  "trailblazer",
  "border-crosser",
  "globe-trotter",
  "city-hopper",
  "trip-architect",
  "journey-complete",
  "foodie",
  "taste-maker",
  "city-crush",
] as const;

export type BadgeId = (typeof BADGE_IDS)[number];

export type BadgeMetric =
  | "places"
  | "visited"
  | "countries"
  | "cities"
  | "trips"
  | "completedTrips"
  | "foodPlaces"
  | "favoriteCities"
  | "travelProfile";

export type BadgeTier = "bronze" | "silver" | "gold";

/**
 * Snapshot of activity used to evaluate badges.
 * Built client-side from locations, trips, profile, and favorites.
 */
export interface BadgeActivityStats {
  places: number;
  visited: number;
  countries: number;
  cities: number;
  trips: number;
  completedTrips: number;
  foodPlaces: number;
  favoriteCities: number;
  /** 1 when travel preferences have been filled in. */
  travelProfile: number;
}

/**
 * Mirrored on users/{userId}.earnedBadges
 * Map of badgeId → epoch millis when first unlocked.
 */
export type EarnedBadgesMap = Partial<Record<BadgeId, number>>;
