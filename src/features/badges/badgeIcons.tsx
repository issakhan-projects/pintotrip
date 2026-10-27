import type { ReactNode } from "react";
import {
  Backpack,
  Bookmark,
  Building2,
  Compass,
  Flag,
  Footprints,
  Globe2,
  Heart,
  Library,
  MapPin,
  Route,
  Sparkles,
  Trophy,
  Utensils,
} from "lucide-react";
import type { BadgeIconName } from "@/features/badges/catalog";

const ICON_MAP: Record<
  BadgeIconName,
  (props: { className?: string; strokeWidth?: number }) => ReactNode
> = {
  "map-pin": (p) => <MapPin {...p} />,
  bookmark: (p) => <Bookmark {...p} />,
  library: (p) => <Library {...p} />,
  footprints: (p) => <Footprints {...p} />,
  compass: (p) => <Compass {...p} />,
  backpack: (p) => <Backpack {...p} />,
  flag: (p) => <Flag {...p} />,
  globe: (p) => <Globe2 {...p} />,
  building: (p) => <Building2 {...p} />,
  route: (p) => <Route {...p} />,
  trophy: (p) => <Trophy {...p} />,
  utensils: (p) => <Utensils {...p} />,
  sparkles: (p) => <Sparkles {...p} />,
  heart: (p) => <Heart {...p} />,
};

export function BadgeIcon({
  name,
  className,
  strokeWidth = 2,
}: {
  name: BadgeIconName;
  className?: string;
  strokeWidth?: number;
}) {
  const render = ICON_MAP[name];
  return <>{render({ className, strokeWidth })}</>;
}
