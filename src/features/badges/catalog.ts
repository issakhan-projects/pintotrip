import type { BadgeId, BadgeMetric, BadgeTier } from "@/types/badge";

export type BadgeDefinition = {
  id: BadgeId;
  /** Lucide icon name key resolved in the UI. */
  icon: BadgeIconName;
  tier: BadgeTier;
  metric: BadgeMetric;
  target: number;
};

export type BadgeIconName =
  | "map-pin"
  | "bookmark"
  | "library"
  | "footprints"
  | "compass"
  | "backpack"
  | "flag"
  | "globe"
  | "building"
  | "route"
  | "trophy"
  | "utensils"
  | "sparkles"
  | "heart";

/**
 * Static catalog — 14 travel badges.
 * Titles/descriptions live in i18n (`badges.items.{id}`).
 */
export const BADGE_CATALOG: readonly BadgeDefinition[] = [
  {
    id: "first-pin",
    icon: "map-pin",
    tier: "bronze",
    metric: "places",
    target: 1,
  },
  {
    id: "collector",
    icon: "bookmark",
    tier: "silver",
    metric: "places",
    target: 10,
  },
  {
    id: "place-hunter",
    icon: "library",
    tier: "gold",
    metric: "places",
    target: 25,
  },
  {
    id: "first-visit",
    icon: "footprints",
    tier: "bronze",
    metric: "visited",
    target: 1,
  },
  {
    id: "explorer",
    icon: "compass",
    tier: "silver",
    metric: "visited",
    target: 5,
  },
  {
    id: "trailblazer",
    icon: "backpack",
    tier: "gold",
    metric: "visited",
    target: 15,
  },
  {
    id: "border-crosser",
    icon: "flag",
    tier: "silver",
    metric: "countries",
    target: 3,
  },
  {
    id: "globe-trotter",
    icon: "globe",
    tier: "gold",
    metric: "countries",
    target: 5,
  },
  {
    id: "city-hopper",
    icon: "building",
    tier: "silver",
    metric: "cities",
    target: 5,
  },
  {
    id: "trip-architect",
    icon: "route",
    tier: "bronze",
    metric: "trips",
    target: 1,
  },
  {
    id: "journey-complete",
    icon: "trophy",
    tier: "gold",
    metric: "completedTrips",
    target: 1,
  },
  {
    id: "foodie",
    icon: "utensils",
    tier: "silver",
    metric: "foodPlaces",
    target: 3,
  },
  {
    id: "taste-maker",
    icon: "sparkles",
    tier: "bronze",
    metric: "travelProfile",
    target: 1,
  },
  {
    id: "city-crush",
    icon: "heart",
    tier: "silver",
    metric: "favoriteCities",
    target: 3,
  },
] as const;

export function getBadgeDefinition(id: BadgeId): BadgeDefinition | undefined {
  return BADGE_CATALOG.find((b) => b.id === id);
}
