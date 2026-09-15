import type { PreparationCategory } from "@/types/trip-planner";

/**
 * Canonical Umrah preparation items for Before You Go.
 * Visa, insurance, and general documents live in the shared trip checklist
 * (stable IDs) so they are not duplicated here.
 */
export const UMRAH_PREPARATION_ITEMS: Array<{
  id: string;
  title: string;
  description?: string;
  category: PreparationCategory;
}> = [
  {
    id: "umrah-ihram",
    title: "Prepare Ihram",
    description: "Get Ihram before the trip.",
    category: "packing",
  },
  {
    id: "umrah-ihram-clothing",
    title: "Pack Ihram clothing",
    description: "Set aside Ihram garments for travel and rites.",
    category: "packing",
  },
  {
    id: "umrah-walking-shoes",
    title: "Pack comfortable walking shoes",
    description: "You will walk a lot between rites and ziyarat.",
    category: "packing",
  },
];

/** Leisure ids that activate Umrah prep. Prefer `umrah` (existing option id). */
export function isUmrahLeisure(leisureType: string | undefined | null): boolean {
  const id = leisureType?.trim().toLowerCase();
  return id === "umrah" || id === "umrah_planner";
}
