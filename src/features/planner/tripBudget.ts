import type { SavedLocation } from "@/hooks/useLocations";
import type {
  BudgetCategory,
  ItineraryDay,
  ItineraryPlace,
  TripAccommodation,
  TripBudgetItem,
  TripRoute,
} from "@/types/trip-planner";
import {
  type CurrencyAmount,
  formatApproxMoney,
  formatCurrencyAmountList,
} from "./approximateTripCost";

export type BudgetLineKind = "estimated" | "custom";

export type BudgetLineItem = {
  id: string;
  title: string;
  amount: number;
  currency: string;
  category: BudgetCategory;
  kind: BudgetLineKind;
  /** Optional subtitle (route cities, stay city, etc.). */
  subtitle?: string;
};

function isActiveItinerarySlot(
  slot: ItineraryPlace,
  byId: Map<string, SavedLocation>
): boolean {
  if (slot.status === "cancelled") return false;
  if (slot.type === "gap" || slot.type === "route") return true;
  return byId.get(slot.locationId)?.status !== "cancelled";
}

function placeBudgetCategory(
  place: SavedLocation | undefined
): BudgetCategory {
  const category = place?.category;
  if (category === "food" || category === "cafe" || category === "market") {
    return "food";
  }
  if (category === "shopping") return "shopping";
  if (category === "transport") return "transport";
  return "activities";
}

function routeLabel(route: TripRoute): string {
  const from =
    route.from.city?.trim() ||
    route.from.name?.trim() ||
    route.from.code?.trim() ||
    "From";
  const to =
    route.to.city?.trim() ||
    route.to.name?.trim() ||
    route.to.code?.trim() ||
    "To";
  return `${from} → ${to}`;
}

function addCurrencyAmount(
  map: Map<string, CurrencyAmount>,
  amount: number,
  currency?: string | null
) {
  if (!Number.isFinite(amount) || amount < 0) return;
  const code = currency?.trim().toUpperCase() || "";
  const key = code || "_";
  const existing = map.get(key);
  if (existing) {
    existing.amount += amount;
    existing.count += 1;
    return;
  }
  map.set(key, { currency: code, amount, count: 1 });
}

function currencyAmountsFromMap(
  map: Map<string, CurrencyAmount>
): CurrencyAmount[] {
  return [...map.values()].sort((a, b) => {
    if (a.currency && !b.currency) return -1;
    if (!a.currency && b.currency) return 1;
    return a.currency.localeCompare(b.currency);
  });
}

/** Estimated line items from itinerary places, routes, and stays. */
export function listEstimatedBudgetLines(
  days: ItineraryDay[],
  byId: Map<string, SavedLocation>,
  routes: Iterable<TripRoute>,
  accommodations: Iterable<TripAccommodation>
): BudgetLineItem[] {
  const lines: BudgetLineItem[] = [];
  const seenPlaces = new Set<string>();

  for (const day of days) {
    for (const slot of day.places) {
      if (slot.type === "gap" || slot.type === "route") continue;
      if (!isActiveItinerarySlot(slot, byId)) continue;
      if (seenPlaces.has(slot.locationId)) continue;
      seenPlaces.add(slot.locationId);
      const place = byId.get(slot.locationId);
      const amount = place?.price?.amount;
      if (amount == null || !Number.isFinite(amount)) continue;
      lines.push({
        id: `est-place:${slot.locationId}`,
        title: place?.title?.trim() || "Place",
        amount,
        currency: place?.price?.currency?.trim().toUpperCase() || "",
        category: placeBudgetCategory(place),
        kind: "estimated",
        subtitle: place?.city?.name,
      });
    }
  }

  for (const route of routes) {
    const amount = route.priceAmount;
    if (amount == null || !Number.isFinite(amount)) continue;
    lines.push({
      id: `est-route:${route.id}`,
      title: routeLabel(route),
      amount,
      currency: route.priceCurrency?.trim().toUpperCase() || "",
      category: "transport",
      kind: "estimated",
      subtitle: route.transport,
    });
  }

  for (const stay of accommodations) {
    const amount = stay.priceAmount;
    if (amount == null || !Number.isFinite(amount)) continue;
    const stayId = stay.id?.trim() || stay.placeId || stay.name || "stay";
    lines.push({
      id: `est-stay:${stayId}`,
      title: stay.name?.trim() || "Stay",
      amount,
      currency: stay.priceCurrency?.trim().toUpperCase() || "",
      category: "accommodation",
      kind: "estimated",
      subtitle: stay.cityName,
    });
  }

  return lines;
}

export function customBudgetLines(
  items: TripBudgetItem[]
): BudgetLineItem[] {
  return [...items]
    .sort((a, b) => a.order - b.order)
    .map((item) => ({
      id: item.id,
      title: item.title,
      amount: item.amount,
      currency: item.currency?.trim().toUpperCase() || "",
      category: item.category,
      kind: "custom" as const,
      subtitle: item.note,
    }));
}

export function sumBudgetLines(lines: BudgetLineItem[]): CurrencyAmount[] {
  const map = new Map<string, CurrencyAmount>();
  for (const line of lines) {
    addCurrencyAmount(map, line.amount, line.currency);
  }
  return currencyAmountsFromMap(map);
}

export function sumBudgetByCategory(
  lines: BudgetLineItem[]
): Array<{ category: BudgetCategory; totals: CurrencyAmount[] }> {
  const byCategory = new Map<BudgetCategory, BudgetLineItem[]>();
  for (const line of lines) {
    const list = byCategory.get(line.category) ?? [];
    list.push(line);
    byCategory.set(line.category, list);
  }
  return [...byCategory.entries()]
    .map(([category, categoryLines]) => ({
      category,
      totals: sumBudgetLines(categoryLines),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

export function newCustomBudgetItemId(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `budget_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  return `custom:${uuid}`;
}

export function parseBudgetAmount(raw: string): number | null {
  const cleaned = raw.trim().replace(",", ".");
  if (!cleaned) return null;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

/**
 * Rate lookup: `getRate(from, to)` returns how many `to` equal 1 `from`.
 * Returns null when the pair is unknown.
 */
export type BudgetRateLookup = (
  from: string,
  to: string
) => number | null;

export function convertBudgetAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  getRate: BudgetRateLookup
): number | null {
  if (!Number.isFinite(amount)) return null;
  const from = fromCurrency.trim().toUpperCase();
  const to = toCurrency.trim().toUpperCase();
  if (!to) return null;
  if (!from || from === to) return amount;
  const direct = getRate(from, to);
  if (direct != null && direct > 0) return amount * direct;
  const inverse = getRate(to, from);
  if (inverse != null && inverse > 0) return amount / inverse;
  return null;
}

/** Sum line items converted into a single target currency. */
export function sumBudgetInCurrency(
  lines: BudgetLineItem[],
  targetCurrency: string,
  getRate: BudgetRateLookup
): number | null {
  const target = targetCurrency.trim().toUpperCase();
  if (!target || lines.length === 0) return null;
  let total = 0;
  for (const line of lines) {
    const from = line.currency.trim().toUpperCase() || target;
    const converted = convertBudgetAmount(
      line.amount,
      from,
      target,
      getRate
    );
    if (converted == null) return null;
    total += converted;
  }
  return total;
}

export function formatDualBudgetMoney(
  amount: number,
  currency: string,
  altAmount: number | null | undefined,
  altCurrency: string | null | undefined,
  opts?: { approximate?: boolean }
): { primary: string; secondary: string | null } {
  const prefix = opts?.approximate ? "≈ " : "";
  const primary = `${prefix}${formatApproxMoney(amount, currency || undefined)}`;
  const alt = altCurrency?.trim().toUpperCase() || "";
  const code = currency.trim().toUpperCase();
  if (
    altAmount == null ||
    !Number.isFinite(altAmount) ||
    !alt ||
    alt === code
  ) {
    return { primary, secondary: null };
  }
  return {
    primary,
    secondary: `≈ ${formatApproxMoney(altAmount, alt)}`,
  };
}

export { formatApproxMoney, formatCurrencyAmountList };
