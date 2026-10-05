import type { SavedLocation } from "@/hooks/useLocations";
import type {
  ItineraryDay,
  ItineraryPlace,
  TripAccommodation,
  TripRoute,
} from "@/types/trip-planner";

export type CurrencyAmount = {
  currency: string;
  amount: number;
  count: number;
};

export type ApproximateTripCost = {
  places: CurrencyAmount[];
  transport: CurrencyAmount[];
  accommodation: CurrencyAmount[];
  total: CurrencyAmount[];
  pricedPlaceCount: number;
  pricedTransportCount: number;
  pricedAccommodationCount: number;
};

function isActiveItinerarySlot(
  slot: ItineraryPlace,
  byId: Map<string, SavedLocation>
): boolean {
  if (slot.status === "cancelled") return false;
  if (slot.type === "gap" || slot.type === "route") return true;
  return byId.get(slot.locationId)?.status !== "cancelled";
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

function mergeCurrencyAmounts(
  ...groups: CurrencyAmount[][]
): CurrencyAmount[] {
  const map = new Map<string, CurrencyAmount>();
  for (const group of groups) {
    for (const row of group) {
      const key = row.currency || "_";
      const existing = map.get(key);
      if (existing) {
        existing.amount += row.amount;
        existing.count += row.count;
      } else {
        map.set(key, { ...row });
      }
    }
  }
  return currencyAmountsFromMap(map);
}

export function formatApproxMoney(amount: number, currency?: string): string {
  if (currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      }).format(amount);
    } catch {
      return `${Math.round(amount * 100) / 100} ${currency}`;
    }
  }
  return String(Math.round(amount * 100) / 100);
}

export function formatCurrencyAmountList(rows: CurrencyAmount[]): string {
  if (rows.length === 0) return "";
  return rows
    .map((row) => formatApproxMoney(row.amount, row.currency || undefined))
    .join(" + ");
}

/** Sum numeric place + route + stay prices for an approximate trip cost. */
export function computeApproximateTripCost(
  days: ItineraryDay[],
  byId: Map<string, SavedLocation>,
  routes: Iterable<TripRoute>,
  accommodations: Iterable<TripAccommodation> = []
): ApproximateTripCost {
  const placeMap = new Map<string, CurrencyAmount>();
  const transportMap = new Map<string, CurrencyAmount>();
  const accommodationMap = new Map<string, CurrencyAmount>();
  const seenPlaces = new Set<string>();
  let pricedPlaceCount = 0;
  let pricedTransportCount = 0;
  let pricedAccommodationCount = 0;

  for (const day of days) {
    for (const slot of day.places) {
      if (slot.type === "gap" || slot.type === "route") continue;
      if (!isActiveItinerarySlot(slot, byId)) continue;
      if (seenPlaces.has(slot.locationId)) continue;
      seenPlaces.add(slot.locationId);
      const place = byId.get(slot.locationId);
      const amount = place?.price?.amount;
      if (amount == null || !Number.isFinite(amount)) continue;
      addCurrencyAmount(placeMap, amount, place?.price?.currency);
      pricedPlaceCount += 1;
    }
  }

  for (const route of routes) {
    const amount = route.priceAmount;
    if (amount == null || !Number.isFinite(amount)) continue;
    addCurrencyAmount(transportMap, amount, route.priceCurrency);
    pricedTransportCount += 1;
  }

  for (const stay of accommodations) {
    const amount = stay.priceAmount;
    if (amount == null || !Number.isFinite(amount)) continue;
    addCurrencyAmount(accommodationMap, amount, stay.priceCurrency);
    pricedAccommodationCount += 1;
  }

  const places = currencyAmountsFromMap(placeMap);
  const transport = currencyAmountsFromMap(transportMap);
  const accommodation = currencyAmountsFromMap(accommodationMap);
  return {
    places,
    transport,
    accommodation,
    total: mergeCurrencyAmounts(places, transport, accommodation),
    pricedPlaceCount,
    pricedTransportCount,
    pricedAccommodationCount,
  };
}

export function hasApproximateTripCost(cost: ApproximateTripCost): boolean {
  return (
    cost.places.length > 0 ||
    cost.transport.length > 0 ||
    cost.accommodation.length > 0
  );
}
