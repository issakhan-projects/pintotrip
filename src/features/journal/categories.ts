import type { LucideIcon } from "lucide-react";
import {
  Anchor,
  BookOpen,
  Building2,
  Camera,
  Castle,
  Church,
  Compass,
  Droplets,
  Flame,
  Flower2,
  Footprints,
  Gem,
  Heart,
  History,
  Landmark,
  Leaf,
  Library,
  MapPin,
  Moon,
  Mountain,
  MountainSnow,
  Palmtree,
  Sailboat,
  Snowflake,
  Sparkles,
  Sun,
  Sunrise,
  Tent,
  TrainFront,
  Trees,
  User,
  UtensilsCrossed,
  Wallet,
  Waves,
} from "lucide-react";

/** Canonical journal category slugs (machine IDs — English/ASCII). */
export const JOURNAL_CATEGORIES = [
  "adventure",
  "beaches",
  "surfing",
  "diving",
  "hiking",
  "nature",
  "mountains",
  "lakes",
  "waterfalls",
  "islands",
  "ocean",

  "cities",
  "architecture",
  "culture",
  "history",
  "museums",
  "libraries",
  "mosques",
  "temples",
  "churches",
  "castles",

  "food",
  "road_trips",
  "train_trips",
  "weekend_trips",
  "solo_travel",
  "slow_travel",

  "hidden_gems",
  "bucket_list",
  "photogenic",
  "viewpoints",
  "sunsets",

  "winter",
  "summer",
  "spring",
  "autumn",

  "family",
  "romantic",
  "luxury",
  "budget",
  "wellness",
] as const;

export type JournalCategory = (typeof JOURNAL_CATEGORIES)[number];

const CATEGORY_SET = new Set<string>(JOURNAL_CATEGORIES);

export function isJournalCategory(value: string): value is JournalCategory {
  return CATEGORY_SET.has(value);
}

/** Human-readable label for a category slug. */
export function formatJournalCategory(category: string): string {
  return category
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Lucide icon for each journal category. */
export const JOURNAL_CATEGORY_ICONS: Record<JournalCategory, LucideIcon> = {
  adventure: Compass,
  beaches: Palmtree,
  surfing: Waves,
  diving: Anchor,
  hiking: Footprints,
  nature: Trees,
  mountains: Mountain,
  lakes: Droplets,
  waterfalls: Droplets,
  islands: Sailboat,
  ocean: Waves,

  cities: Building2,
  architecture: Landmark,
  culture: Sparkles,
  history: History,
  museums: Landmark,
  libraries: Library,
  mosques: Moon,
  temples: Flower2,
  churches: Church,
  castles: Castle,

  food: UtensilsCrossed,
  road_trips: MapPin,
  train_trips: TrainFront,
  weekend_trips: Tent,
  solo_travel: User,
  slow_travel: Leaf,

  hidden_gems: Gem,
  bucket_list: Flame,
  photogenic: Camera,
  viewpoints: MountainSnow,
  sunsets: Sunrise,

  winter: Snowflake,
  summer: Sun,
  spring: Flower2,
  autumn: Leaf,

  family: Heart,
  romantic: Heart,
  luxury: Sparkles,
  budget: Wallet,
  wellness: Leaf,
};

export function getJournalCategoryIcon(category: string): LucideIcon {
  if (isJournalCategory(category)) return JOURNAL_CATEGORY_ICONS[category];
  return BookOpen;
}
