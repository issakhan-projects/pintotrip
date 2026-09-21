"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Timestamp } from "firebase/firestore";
import {
  Binoculars,
  Building2,
  CalendarDays,
  Coins,
  Coffee,
  FerrisWheel,
  Landmark,
  Loader2,
  MapPin,
  Moon,
  Mountain,
  RefreshCw,
  Route,
  ShoppingBag,
  Sparkles,
  Store,
  Trees,
  TrainFront,
  ExternalLink,
  UtensilsCrossed,
  Waves,
  X,
  Save,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { devLog, isDevLoggingEnabled } from "@/lib/devLog";
import { planTrip } from "@/services/functions";
import { getUserProfile } from "@/services/users";
import { createUserLocation, updateUserLocation } from "@/services/locations";
import {
  createTripRoute,
  listTripRoutes,
} from "@/services/trip-routes";
import {
  addUtcDays,
  startOfUtcDay,
  tripDayCount,
} from "@/services/trip-planner";
import { fetchSuggestedPlacePhoto } from "@/features/add-place/placeSearch";
import { resolveCountryCode } from "@/lib/countries";
import { countryIdFromParts, isAsciiId, slugifyId } from "@/lib/utils";
import {
  planTripCost,
  planTripRegenerateCost,
  formatInsufficientCreditsMessage,
  isInsufficientAICreditsError,
} from "@/types/credits";
import type {
  PlanTripAiResult,
  TripPlannerAiResponseDay,
  TripPlannerAiResponseLocationPlace,
  TripPlannerAiResponseNestedPlace,
  TripPlannerAiResponseRoute,
} from "@/types/trip-planner-ai-request";
import type { SavedLocation } from "@/hooks/useLocations";
import type { UserLocationCreateInput } from "@/types/location";
import type {
  ItineraryDay,
  ItineraryDayWeather,
  ItineraryPlace,
  TripItinerary,
  TripPlannerDoc,
  TripRoute,
} from "@/types/trip-planner";
import {
  LEISURE_TYPES,
  LEISURE_TYPE_OPTIONS,
  PLACE_CATEGORY_LABELS,
  type LeisureType,
  type PlaceCategory,
  type PlanTripExistingDay,
  type PlanTripResult,
  type PlannedDaySuggestion,
  type PlannedPlaceSuggestion,
  type PlannedRouteSuggestion,
} from "@/types/trip-plan";
import { distanceKm } from "./clusterPlaces";
import {
  matchLocationsToDestinations,
  sortLocationsForDestination,
} from "./matchTripPlaces";
import {
  listTripDestinations,
  owningDestinationForDate,
  primaryTripDestination,
  toIsoDate,
} from "./tripDestinations";
// CLOSED — reopen when wiring AI planning save/weather merge again:
// import { weatherForTrip } from "./tripWeather";
import {
  formatRouteDuration,
  nextRouteOrder,
} from "./routeHelpers";
import {
  ROUTE_TRANSPORT_ICON,
  ROUTE_TRANSPORT_LABEL,
} from "./RouteLegCard";
import { getFlagEmoji } from "country-flag-select";

function leisureTypeFromTrip(trip: TripPlannerDoc): LeisureType {
  const value = trip.leisureType;
  if (value && (LEISURE_TYPES as readonly string[]).includes(value)) {
    return value;
  }
  return "mixed";
}

const PLACE_CATEGORY_ICONS: Record<PlaceCategory, LucideIcon> = {
  attraction: FerrisWheel,
  beach: Waves,
  museum: Building2,
  landmark: Landmark,
  food: UtensilsCrossed,
  cafe: Coffee,
  park: Trees,
  viewpoint: Binoculars,
  nightlife: Moon,
  shopping: ShoppingBag,
  market: Store,
  nature: Trees,
  adventure: Mountain,
  wellness: Waves,
  neighborhood: MapPin,
  transport: TrainFront,
  other: MapPin,
};

type Phase = "setup" | "loading" | "results";

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
}

function placeKey(day: number, place: PlannedPlaceSuggestion): string {
  return `${day}:${place.title}:${place.lat}:${place.lon}`;
}

function routeKey(route: PlannedRouteSuggestion, index: number): string {
  return `${route.day}:${route.from.name}:${route.to.name}:${route.transport}:${index}`;
}

function transferTitle(route: PlannedRouteSuggestion): string {
  return `${route.from.name} → ${route.to.name}`;
}

type DayTimelineItem =
  | { kind: "place"; place: PlannedPlaceSuggestion; placeIndex: number }
  | { kind: "route"; route: PlannedRouteSuggestion; routeIndex: number };

/** Interleave AI places with transfer routes by insertAt for chronological preview. */
function buildDayTimeline(
  day: PlannedDaySuggestion,
  routes: PlannedRouteSuggestion[]
): DayTimelineItem[] {
  const dayRoutes = routes
    .map((route, routeIndex) => ({ route, routeIndex }))
    .filter(({ route }) => route.day === day.day)
    .sort((a, b) => a.route.insertAt - b.route.insertAt);

  const items: DayTimelineItem[] = [];
  let routeCursor = 0;

  for (let placeIndex = 0; placeIndex <= day.places.length; placeIndex += 1) {
    while (
      routeCursor < dayRoutes.length &&
      dayRoutes[routeCursor]!.route.insertAt <= placeIndex
    ) {
      const entry = dayRoutes[routeCursor]!;
      items.push({
        kind: "route",
        route: entry.route,
        routeIndex: entry.routeIndex,
      });
      routeCursor += 1;
    }
    if (placeIndex < day.places.length) {
      items.push({
        kind: "place",
        place: day.places[placeIndex]!,
        placeIndex,
      });
    }
  }

  return items;
}

/** Resolve Pexels photos for AI suggestions (null when missing). */
async function enrichPlanWithPlacePhotos(
  result: PlanTripResult,
  onPlacePhoto?: (
    day: number,
    place: PlannedPlaceSuggestion,
    imageUrl: string | null
  ) => void
): Promise<PlanTripResult> {
  // Assign sequentially so each Pexels query id is used at most once per plan.
  const usedPlaceIds = new Set<string>();
  const enrichedDays: PlannedDaySuggestion[] = [];

  for (const day of result.days) {
    const places: PlannedPlaceSuggestion[] = [];
    for (const place of day.places) {
      if (place.imageUrl?.trim()) {
        onPlacePhoto?.(day.day, place, place.imageUrl);
        places.push(place);
        continue;
      }

      let imageUrl: string | null = null;
      try {
        const photo = await fetchSuggestedPlacePhoto({
          title: place.title,
          cityName: place.cityName,
          countryName: place.countryName,
          lat: place.lat,
          lon: place.lon,
          excludePlaceIds: usedPlaceIds,
        });
        if (photo) {
          imageUrl = photo.photoUrl;
          usedPlaceIds.add(photo.placeId);
        }
      } catch {
        imageUrl = null;
      }
      onPlacePhoto?.(day.day, place, imageUrl);
      places.push({ ...place, imageUrl });
    }
    enrichedDays.push({ ...day, places });
  }

  return { ...result, days: enrichedDays };
}

/** Build day skeleton for the full trip range, marking occupied places. */
export function buildPlanTripExistingDays(
  trip: TripPlannerDoc,
  byId: Map<string, SavedLocation>
): PlanTripExistingDay[] {
  const dayCount = tripDayCount(trip.startDate, trip.endDate);
  const start = startOfUtcDay(trip.startDate.toDate());
  const byDayNumber = new Map(
    trip.itinerary.days.map((day) => [day.day, day])
  );

  const destinations = listTripDestinations(trip);
  const days: PlanTripExistingDay[] = [];
  for (let i = 0; i < dayCount; i += 1) {
    const dayNumber = i + 1;
    const dateObj = addUtcDays(start, i);
    const date = toIsoDate(dateObj);
    const existing = byDayNumber.get(dayNumber);
    const owner = owningDestinationForDate(destinations, dateObj);
    const placeTitles =
      existing?.places
        .filter((p) => byId.get(p.locationId)?.status !== "cancelled")
        .map((p) => byId.get(p.locationId)?.title)
        .filter((t): t is string => Boolean(t)) ?? [];

    days.push({
      day: dayNumber,
      date,
      title: existing?.title || owner?.cityName,
      placeTitles,
    });
  }
  return days;
}

function matchSuggestionToSaved(
  suggestion: PlannedPlaceSuggestion,
  pool: SavedLocation[],
  used: Set<string>
): SavedLocation | null {
  if (suggestion.locationId && !used.has(suggestion.locationId)) {
    const hit = pool.find((place) => place.id === suggestion.locationId);
    if (hit && hit.status !== "cancelled") return hit;
  }

  const title = suggestion.title.trim().toLowerCase();
  let best: SavedLocation | null = null;
  let bestDist = 3;

  for (const place of pool) {
    if (used.has(place.id) || place.status === "cancelled") continue;
    const dist = distanceKm(
      { lat: place.lat, lon: place.lon },
      { lat: suggestion.lat, lon: suggestion.lon }
    );
    const titleMatch = place.title.trim().toLowerCase() === title;
    if (titleMatch && dist <= 5) return place;
    if (dist < bestDist) {
      bestDist = dist;
      best = place;
    }
  }

  return best;
}

function resolveSuggestionCityCountry(
  suggestion: PlannedPlaceSuggestion,
  trip: TripPlannerDoc
): { city: { id: string; name: string }; country: { id: string; name: string } } | null {
  const primary = primaryTripDestination(trip);
  const cityName =
    suggestion.cityName?.trim() || primary.cityName.trim();
  const countryName =
    suggestion.countryName?.trim() || primary.countryName.trim();
  if (!cityName || !countryName) return null;

  const countryCode =
    (suggestion.countryCode?.trim().toUpperCase() ||
      resolveCountryCode(countryName) ||
      primary.countryId?.trim().toUpperCase() ||
      "") || undefined;

  const countryId = isAsciiId(suggestion.countryId)
    ? suggestion.countryId!.trim().toLowerCase()
    : countryIdFromParts(countryName, countryCode);

  const cityId = isAsciiId(suggestion.cityId)
    ? suggestion.cityId!.trim().toLowerCase()
    : isAsciiId(primary.cityId)
      ? primary.cityId!.trim().toLowerCase()
      : isAsciiId(slugifyId(cityName))
        ? slugifyId(cityName)
        : null;

  if (!isAsciiId(countryId) || !cityId || !isAsciiId(cityId)) return null;

  return {
    country: { id: countryId, name: countryName },
    city: { id: cityId, name: cityName },
  };
}

function suggestionImageUrl(
  suggestion: PlannedPlaceSuggestion
): string | null {
  const url = suggestion.imageUrl?.trim();
  return url || null;
}

/**
 * Reused matches skip create — sync AI preview fields onto the saved place so
 * PlacesStep / PlaceDetail show the same title, description, price, image, etc.
 */
async function syncLocationFromSuggestion(
  userId: string,
  location: SavedLocation,
  suggestion: PlannedPlaceSuggestion
): Promise<void> {
  const description =
    suggestion.description?.trim() ||
    suggestion.why?.trim() ||
    location.description;
  const imageUrl = suggestionImageUrl(suggestion);
  const hasUserImage = location.images.some(
    (img) => img.source === "user" && Boolean(img.url?.trim())
  );
  const patch: Parameters<typeof updateUserLocation>[2] = {
    title: suggestion.title.trim() || location.title,
    description,
    ...(suggestion.category ? { category: suggestion.category } : {}),
    ...(suggestion.priceAmount != null ||
    suggestion.priceCurrency ||
    suggestion.priceLabel
      ? {
          price: {
            ...(suggestion.priceAmount != null
              ? { amount: suggestion.priceAmount }
              : {}),
            ...(suggestion.priceCurrency
              ? { currency: suggestion.priceCurrency }
              : {}),
            ...(suggestion.priceLabel?.trim()
              ? { label: suggestion.priceLabel.trim() }
              : {}),
          },
        }
      : {}),
    ...(suggestion.link?.trim()
      ? {
          links: [
            {
              url: suggestion.link.trim(),
              label:
                suggestion.category === "transport"
                  ? "Buy tickets"
                  : "Tickets / info",
            },
          ],
        }
      : {}),
    ai: {
      why: suggestion.why?.trim() || location.ai?.why || description,
      model: "planTrip",
      processedAt: Timestamp.now(),
    },
  };

  // Always apply the plan preview image so PlacesStep matches PlanTripSheet.
  // Keep user-uploaded photos as extras after the plan thumb.
  if (imageUrl) {
    const userImages = hasUserImage
      ? location.images.filter(
          (img) => img.source === "user" && Boolean(img.url?.trim())
        )
      : [];
    patch.images = [
      { url: imageUrl, source: "external" as const },
      ...userImages.filter((img) => img.url.trim() !== imageUrl),
    ];
  }

  await updateUserLocation(userId, location.id, patch);
}

async function createLocationFromSuggestion(
  userId: string,
  suggestion: PlannedPlaceSuggestion,
  trip: TripPlannerDoc
): Promise<string | null> {
  const locality = resolveSuggestionCityCountry(suggestion, trip);
  if (!locality) return null;

  const imageUrl = suggestionImageUrl(suggestion);
  const input: UserLocationCreateInput = {
    title: suggestion.title.trim(),
    description: suggestion.description?.trim() || suggestion.why?.trim() || "",
    lat: suggestion.lat,
    lon: suggestion.lon,
    country: locality.country,
    city: locality.city,
    status: "planned",
    ...(suggestion.category ? { category: suggestion.category } : {}),
    ...(suggestion.priceAmount != null ||
    suggestion.priceCurrency ||
    suggestion.priceLabel
      ? {
          price: {
            ...(suggestion.priceAmount != null
              ? { amount: suggestion.priceAmount }
              : {}),
            ...(suggestion.priceCurrency
              ? { currency: suggestion.priceCurrency }
              : {}),
            ...(suggestion.priceLabel?.trim()
              ? { label: suggestion.priceLabel.trim() }
              : {}),
          },
        }
      : {}),
    ...(suggestion.link?.trim()
      ? {
          links: [
            {
              url: suggestion.link.trim(),
              label:
                suggestion.category === "transport"
                  ? "Buy tickets"
                  : "Tickets / info",
            },
          ],
        }
      : {}),
    images: imageUrl
      ? [{ url: imageUrl, source: "external" as const }]
      : [],
    confidence: 0.7,
    ai: {
      why: suggestion.why?.trim() || "Suggested by trip planner.",
      model: "planTrip",
      processedAt: Timestamp.now(),
    },
    source: { type: "manual" },
  };

  return createUserLocation(userId, input);
}

function isAiLocationPlace(
  place: TripPlannerAiResponseNestedPlace
): place is TripPlannerAiResponseLocationPlace {
  return Boolean(place && typeof place === "object" && "title" in place && "location" in place);
}

async function createLocationFromAiPlace(
  userId: string,
  place: TripPlannerAiResponseLocationPlace
): Promise<string | null> {
  const title = place.title?.trim();
  const lat = place.location?.lat;
  const lon = place.location?.lon;
  const cityId = place.city?.id?.trim().toLowerCase() || place.cityId?.trim().toLowerCase();
  const cityName = place.city?.name?.trim();
  const countryId = place.country?.id?.trim().toLowerCase();
  const countryName = place.country?.name?.trim();
  if (
    !title ||
    typeof lat !== "number" ||
    typeof lon !== "number" ||
    !cityId ||
    !cityName ||
    !countryId ||
    !countryName
  ) {
    return null;
  }

  const imageUrl = place.images?.find((img) => img.url?.trim())?.url?.trim();
  const input: UserLocationCreateInput = {
    title,
    description: place.description?.trim() || "",
    lat,
    lon,
    country: { id: countryId, name: countryName },
    city: { id: cityId, name: cityName },
    status: place.status === "visited" ? "visited" : "planned",
    ...(place.category ? { category: place.category } : {}),
    ...(place.note?.trim() ? { note: place.note.trim() } : {}),
    ...(place.price
      ? {
          price: {
            ...(place.price.amount != null ? { amount: place.price.amount } : {}),
            ...(place.price.currency ? { currency: place.price.currency } : {}),
            ...(place.price.label?.trim()
              ? { label: place.price.label.trim() }
              : {}),
          },
        }
      : {}),
    ...(place.links?.length
      ? {
          links: place.links
            .filter((l) => l.url?.trim())
            .map((l) => ({
              url: l.url.trim(),
              ...(l.label?.trim() ? { label: l.label.trim() } : {}),
            })),
        }
      : {}),
    ...(imageUrl
      ? { images: [{ url: imageUrl, source: "external" as const }] }
      : { images: [] }),
    ...(typeof place.confidence === "number"
      ? { confidence: place.confidence }
      : { confidence: 0.7 }),
    source: { type: "manual" },
    ai: {
      why: place.ai?.why?.trim() || place.description?.trim() || title,
      model: place.ai?.model?.trim() || "planTrip",
      processedAt: Timestamp.now(),
    },
  };

  return createUserLocation(userId, input);
}

function routePointsLikelySame(
  a: { name?: string; city?: string; code?: string; placeId?: string; location?: { lat: number; lon: number } },
  b: { name?: string; city?: string; code?: string; placeId?: string; location?: { lat: number; lon: number } }
): boolean {
  const aCode = a.code?.trim().toUpperCase();
  const bCode = b.code?.trim().toUpperCase();
  if (aCode && bCode && aCode === bCode) return true;
  const aPlace = a.placeId?.trim();
  const bPlace = b.placeId?.trim();
  if (aPlace && bPlace && aPlace === bPlace) return true;
  const aName = a.name?.trim().toLowerCase();
  const bName = b.name?.trim().toLowerCase();
  const aCity = a.city?.trim().toLowerCase();
  const bCity = b.city?.trim().toLowerCase();
  if (aName && bName && aName === bName && aCity && bCity && aCity === bCity) {
    return true;
  }
  if (
    typeof a.location?.lat === "number" &&
    typeof a.location?.lon === "number" &&
    typeof b.location?.lat === "number" &&
    typeof b.location?.lon === "number"
  ) {
    return (
      distanceKm(
        { lat: a.location.lat, lon: a.location.lon },
        { lat: b.location.lat, lon: b.location.lon }
      ) < 2
    );
  }
  return false;
}

function findExistingRouteId(
  route: TripPlannerAiResponseRoute,
  existing: TripRoute[],
  used: Set<string>
): string | null {
  for (const candidate of existing) {
    if (used.has(candidate.id)) continue;
    if (candidate.transport !== route.transport) continue;
    if (
      routePointsLikelySame(candidate.from, route.from) &&
      routePointsLikelySame(candidate.to, route.to)
    ) {
      return candidate.id;
    }
  }
  return null;
}

interface PlanTripSheetProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  trip: TripPlannerDoc;
  locations: SavedLocation[];
  aiCreditsBalance: number;
  language?: string;
  /** generate = fill empty days (free). regenerate = recreate full plan (credits). */
  intent?: "generate" | "regenerate";
  onSaved: (payload: {
    savedPlaceIds: string[];
    itinerary: TripItinerary;
  }) => Promise<void>;
}

export function PlanTripSheet({
  open,
  onClose,
  userId,
  trip,
  locations,
  aiCreditsBalance,
  language,
  intent = "generate",
  onSaved,
}: PlanTripSheetProps) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [result, setResult] = useState<PlanTripResult | null>(null);
  const [aiResult, setAiResult] = useState<PlanTripAiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Bumps on close / new plan so in-flight photo fetches cannot overwrite state. */
  const photoEnrichGen = useRef(0);
  /** Latest plan including photos applied via setState (save must not use a stale closure). */
  const resultRef = useRef<PlanTripResult | null>(null);
  /** Resolves to the fully photo-enriched plan for the current generate pass. */
  const photoEnrichPromiseRef = useRef<Promise<PlanTripResult | null>>(
    Promise.resolve(null)
  );
  const weatherByIsoRef = useRef<Map<string, ItineraryDayWeather>>(new Map());

  resultRef.current = result;

  const byId = useMemo(
    () => new Map(locations.map((l) => [l.id, l])),
    [locations]
  );

  const existingDays = useMemo(
    () => buildPlanTripExistingDays(trip, byId),
    [trip, byId]
  );

  /** Regenerate treats every day as empty so the model can rebuild the full plan. */
  const planningDays = useMemo(
    () =>
      intent === "regenerate"
        ? existingDays.map((day) => ({ ...day, placeTitles: [] as string[] }))
        : existingDays,
    [existingDays, intent]
  );

  const emptyDayCount = useMemo(
    () => planningDays.filter((d) => d.placeTitles.length === 0).length,
    [planningDays]
  );

  const leisureType = leisureTypeFromTrip(trip);
  const leisureLabel =
    leisureType === "custom" && trip.leisureCustom?.trim()
      ? `Custom — ${trip.leisureCustom.trim()}`
      : LEISURE_TYPE_OPTIONS.find((o) => o.value === leisureType)?.label ??
        leisureType;

  const remainingPlaceCount = useMemo(() => {
    if (aiResult) {
      return aiResult.itinerary.reduce(
        (sum, day) =>
          sum +
          day.places.reduce((n, slot) => n + (slot.places?.length ?? 0), 0),
        0
      );
    }
    return result?.days.reduce((sum, day) => sum + day.places.length, 0) ?? 0;
  }, [aiResult, result]);

  const remainingRouteCount = useMemo(() => {
    if (!aiResult) return 0;
    return aiResult.itinerary.reduce((sum, day) => sum + day.routes.length, 0);
  }, [aiResult]);

  const recreateCost = planTripRegenerateCost(trip.createMode);
  const generateCost = planTripCost(trip.createMode);
  const actionCost = intent === "regenerate" ? recreateCost : generateCost;

  useEffect(() => {
    if (!open) {
      photoEnrichGen.current += 1;
      weatherByIsoRef.current = new Map();
      setPhase("setup");
      setResult(null);
      setAiResult(null);
      setError(null);
      setSaving(false);
      setBusy(false);
      return;
    }
  }, [open]);

  function removePlace(dayNumber: number, place: PlannedPlaceSuggestion) {
    setResult((prev) => {
      if (!prev) return prev;
      const key = placeKey(dayNumber, place);
      const prevDay = prev.days.find((d) => d.day === dayNumber);
      const removedIndex =
        prevDay?.places.findIndex((p) => placeKey(dayNumber, p) === key) ?? -1;
      const nextDays = prev.days.map((day) => {
        if (day.day !== dayNumber) return day;
        return {
          ...day,
          places: day.places.filter((p) => placeKey(day.day, p) !== key),
        };
      });
      const dayPlaces =
        nextDays.find((d) => d.day === dayNumber)?.places.length ?? 0;
      const next: PlanTripResult = {
        ...prev,
        days: nextDays,
        routes: (prev.routes ?? []).map((route) => {
          if (route.day !== dayNumber) return route;
          let insertAt = route.insertAt;
          if (removedIndex >= 0 && route.insertAt > removedIndex) {
            insertAt -= 1;
          }
          return {
            ...route,
            insertAt: Math.max(0, Math.min(dayPlaces, insertAt)),
          };
        }),
      };
      resultRef.current = next;
      return next;
    });
  }

  function removeRoute(routeIndex: number) {
    setResult((prev) => {
      if (!prev) return prev;
      const next: PlanTripResult = {
        ...prev,
        routes: (prev.routes ?? []).filter((_, i) => i !== routeIndex),
      };
      resultRef.current = next;
      return next;
    });
  }

  async function runPlan(mode: "generate" | "regenerate") {
    const planMode = intent === "regenerate" ? "regenerate" : mode;

    if (aiCreditsBalance < actionCost) {
      setError(
        `Not enough AI credits. Need ${actionCost}, you have ${aiCreditsBalance}.`
      );
      return;
    }

    setBusy(true);
    setError(null);
    setPhase("loading");

    try {
      const profile = await getUserProfile(userId).catch(() => null);
      const temperatureType =
        profile?.preferences?.temperatureUnit ?? "celsius";

      const data = await planTrip({
        tripId: trip.id,
        language,
        temperatureType,
        mode: planMode,
      });

      const jsonReplacer = (_key: string, value: unknown) => {
        if (
          value &&
          typeof value === "object" &&
          typeof (value as { toDate?: unknown }).toDate === "function"
        ) {
          try {
            return (value as { toDate: () => Date }).toDate().toISOString();
          } catch {
            return value;
          }
        }
        return value;
      };

      if (isDevLoggingEnabled()) {
        if (data.request) {
          devLog.info(
            "[TripPlannerAiRequest] JSON",
            JSON.stringify(data.request, jsonReplacer, 2)
          );
        }

        devLog.log(
          "[Trip Planner AI] Response",
          JSON.stringify(data, jsonReplacer, 2)
        );
      }

      if (data.warning) {
        devLog.warn("[Trip Planner AI]", data.warning);
        setError(data.warning);
      } else {
        setError(null);
      }

      setAiResult(data);
      setResult(null);
      setPhase("results");
    } catch (err) {
      devLog.warn("[Trip Planner AI] Response failed", err);
      setAiResult(null);
      if (isInsufficientAICreditsError(err)) {
        setError(formatInsufficientCreditsMessage(err));
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Could not generate Trip Planner AI response."
        );
      }
      setPhase("setup");
    } finally {
      setBusy(false);
    }
  }

  /*
   * CLOSED — AI planning path. Uncomment imports above + this function,
   * then replace runPlan body with this (or rename this to runPlan).
   *
  async function runPlan(mode: "generate" | "regenerate") {
    const planMode = intent === "regenerate" ? "regenerate" : mode;

    if (planMode === "generate" && emptyDayCount === 0) {
      setError("All days already have places. Clear a day first.");
      return;
    }

    if (planMode === "regenerate") {
      if (aiCreditsBalance < recreateCost) {
        setError(
          `Not enough AI credits. Need ${recreateCost}, you have ${aiCreditsBalance}.`
        );
        return;
      }
    }

    setBusy(true);
    setError(null);
    setPhase("loading");

    try {
      // Weather stays client-side for itinerary save merge; AI gets it from CF.
      const weather = await weatherForTrip(trip);
      weatherByIsoRef.current = weather.byIsoDate;

      const data = await planTrip({
        tripId: trip.id,
        mode: planMode,
        language,
      });
      // Show text results immediately, then fill Pexels photos when ready.
      // Merge per-place so removals during fetch are preserved.
      const gen = ++photoEnrichGen.current;
      const initial: PlanTripResult = { ...data, routes: data.routes ?? [] };
      resultRef.current = initial;
      setResult(initial);
      setPhase("results");
      photoEnrichPromiseRef.current = enrichPlanWithPlacePhotos(
        initial,
        (dayNumber, place, imageUrl) => {
          if (photoEnrichGen.current !== gen) return;
          const key = placeKey(dayNumber, place);
          setResult((prev) => {
            if (!prev) return prev;
            const next: PlanTripResult = {
              ...prev,
              days: prev.days.map((day) => {
                if (day.day !== dayNumber) return day;
                return {
                  ...day,
                  places: day.places.map((p) =>
                    placeKey(day.day, p) === key ? { ...p, imageUrl } : p
                  ),
                };
              }),
            };
            resultRef.current = next;
            return next;
          });
        }
      ).then((enriched) => {
        if (photoEnrichGen.current !== gen) return null;
        // Prefer live UI state (user may have removed places) but keep enriched URLs.
        const live = resultRef.current;
        if (!live) {
          resultRef.current = enriched;
          setResult(enriched);
          return enriched;
        }
        const imageByKey = new Map<string, string | null | undefined>();
        for (const day of enriched.days) {
          for (const place of day.places) {
            imageByKey.set(placeKey(day.day, place), place.imageUrl);
          }
        }
        const merged: PlanTripResult = {
          ...live,
          days: live.days.map((day) => ({
            ...day,
            places: day.places.map((place) => {
              const key = placeKey(day.day, place);
              if (!imageByKey.has(key)) return place;
              return { ...place, imageUrl: imageByKey.get(key) };
            }),
          })),
        };
        resultRef.current = merged;
        setResult(merged);
        return merged;
      });
    } catch (err) {
      if (isInsufficientAICreditsError(err)) {
        setError(formatInsufficientCreditsMessage(err));
      } else {
        setError(
          err instanceof Error ? err.message : "Could not plan your trip."
        );
      }
      setPhase(result ? "results" : "setup");
    } finally {
      setBusy(false);
    }
  }
  */

  async function handleSaveAiResult() {
    if (!aiResult || aiResult.itinerary.length === 0) return;
    setSaving(true);
    setError(null);

    try {
      const replaceAll = intent === "regenerate";
      const destinations = listTripDestinations(trip);
      const occupiedIds = new Set(
        trip.itinerary.days.flatMap((day) =>
          day.places
            .filter((slot) => slot.type !== "gap" && slot.type !== "route")
            .map((slot) => slot.locationId)
        )
      );
      const usedLocationIds = new Set(replaceAll ? [] : occupiedIds);

      const locationIdsByDay = new Map<
        number,
        Array<{
          locationId: string;
          title: string;
          description?: string;
          imageUrl?: string;
        }>
      >();

      for (const day of aiResult.itinerary) {
        const ids: Array<{
          locationId: string;
          title: string;
          description?: string;
          imageUrl?: string;
        }> = [];

        for (const slot of day.places) {
          for (const place of slot.places ?? []) {
            if ("locationId" in place && place.locationId?.trim()) {
              const locationId = place.locationId.trim();
              if (usedLocationIds.has(locationId) && !replaceAll) {
                // Already on itinerary — still allow linking on regenerate days.
              }
              usedLocationIds.add(locationId);
              const existing = byId.get(locationId);
              ids.push({
                locationId,
                title: existing?.title?.trim() || locationId,
                ...(existing?.description?.trim()
                  ? { description: existing.description.trim() }
                  : {}),
                ...(existing?.images?.[0]?.url?.trim()
                  ? { imageUrl: existing.images[0].url.trim() }
                  : {}),
              });
              continue;
            }

            if (!isAiLocationPlace(place)) continue;
            const createdId = await createLocationFromAiPlace(userId, place);
            if (!createdId) continue;
            usedLocationIds.add(createdId);
            const imageUrl = place.images?.find((img) => img.url?.trim())?.url;
            ids.push({
              locationId: createdId,
              title: place.title.trim(),
              ...(place.description?.trim()
                ? { description: place.description.trim() }
                : {}),
              ...(imageUrl?.trim() ? { imageUrl: imageUrl.trim() } : {}),
            });
          }
        }

        locationIdsByDay.set(day.day, ids);
      }

      const existingRoutes = await listTripRoutes(userId, trip.id);
      const usedRouteIds = new Set<string>();
      let nextOrder = nextRouteOrder(existingRoutes);
      const createdRouteIdsByDay = new Map<
        number,
        Array<{ routeId: string; insertAt: number; title: string }>
      >();

      for (const day of aiResult.itinerary) {
        const list: Array<{ routeId: string; insertAt: number; title: string }> =
          [];
        let insertAt = 0;
        for (const route of day.routes) {
          const title = `${route.from.name} → ${route.to.name}`;
          if (route.source === "existing") {
            const existingId = findExistingRouteId(
              route,
              existingRoutes,
              usedRouteIds
            );
            if (existingId) {
              usedRouteIds.add(existingId);
              list.push({ routeId: existingId, insertAt, title });
              insertAt += 1;
              continue;
            }
          }

          const routeId = await createTripRoute(userId, {
            tripId: trip.id,
            order: nextOrder,
            from: route.from,
            to: route.to,
            transport: route.transport,
            status: "planned",
            durationApproximate:
              route.transport !== "flight" && route.transport !== "train",
            ...(route.departure
              ? { departure: route.departure }
              : {
                  departure: {
                    datetime: `${day.date}T00:00:00Z`,
                    timezone: "",
                    timeKnown: false,
                  },
                }),
            ...(route.arrival ? { arrival: route.arrival } : {}),
            ...(route.priceAmount != null
              ? { priceAmount: route.priceAmount }
              : {}),
            ...(route.priceCurrency
              ? { priceCurrency: route.priceCurrency }
              : {}),
            ...(route.priceLabel?.trim()
              ? { priceLabel: route.priceLabel.trim() }
              : {}),
            ...(route.link?.trim() ? { link: route.link.trim() } : {}),
          });
          nextOrder += 1;
          usedRouteIds.add(routeId);
          list.push({ routeId, insertAt, title });
          insertAt += 1;
        }
        createdRouteIdsByDay.set(day.day, list);
      }

      const weatherByIso = new Map<string, ItineraryDayWeather>();
      for (const day of aiResult.request?.itinerary ?? []) {
        if (!day.weather) continue;
        weatherByIso.set(day.date, {
          available: day.weather.available,
          tempMin: day.weather.tempMin,
          tempMax: day.weather.tempMax,
          temp: day.weather.temp,
          description: day.weather.description,
          icon: day.weather.icon,
          humidity: day.weather.humidity,
          windSpeed: day.weather.windSpeed,
          precipitationChance: day.weather.precipitationChance,
          units: day.weather.units,
          fetchedAt: new Date().toISOString(),
        });
      }

      const dayCount = tripDayCount(trip.startDate, trip.endDate);
      const start = startOfUtcDay(trip.startDate.toDate());
      const existingByDay = new Map(
        trip.itinerary.days.map((d) => [d.day, d])
      );
      const aiDayByNumber = new Map(
        aiResult.itinerary.map((d) => [d.day, d] as const)
      );

      const slotFromId = (
        entry: {
          locationId: string;
          title: string;
          description?: string;
          imageUrl?: string;
        },
        order: number
      ): ItineraryPlace => {
        const loc = byId.get(entry.locationId);
        return {
          locationId: entry.locationId,
          order,
          status:
            loc?.status === "visited"
              ? ("visited" as const)
              : ("planned" as const),
          ...(entry.title.trim() ? { title: entry.title.trim() } : {}),
          ...(entry.description?.trim()
            ? { description: entry.description.trim() }
            : {}),
          ...(entry.imageUrl?.trim()
            ? { imageUrl: entry.imageUrl.trim() }
            : {}),
        };
      };

      const mergeDaySlots = (
        locationEntries: Array<{
          locationId: string;
          title: string;
          description?: string;
          imageUrl?: string;
        }>,
        routeSlots: Array<{ routeId: string; insertAt: number; title: string }>
      ): ItineraryPlace[] => {
        const sortedRoutes = [...routeSlots].sort(
          (a, b) => a.insertAt - b.insertAt
        );
        const slots: ItineraryPlace[] = [];
        // Routes first (chronological travel), then places for the day.
        for (const route of sortedRoutes) {
          slots.push({
            locationId: `route:${route.routeId}`,
            order: slots.length,
            status: "planned",
            type: "route",
            routeId: route.routeId,
            title: route.title,
          });
        }
        for (const entry of locationEntries) {
          slots.push(slotFromId(entry, slots.length));
        }
        return slots;
      };

      const mergedDays: ItineraryDay[] = [];
      for (let i = 0; i < dayCount; i += 1) {
        const dayNumber = i + 1;
        const date = Timestamp.fromDate(addUtcDays(start, i));
        const iso = toIsoDate(date.toDate());
        const weather = weatherByIso.get(iso);
        const existing = existingByDay.get(dayNumber);
        const aiDay = aiDayByNumber.get(dayNumber);
        const newIds = locationIdsByDay.get(dayNumber) ?? [];
        const dayRoutes = createdRouteIdsByDay.get(dayNumber) ?? [];
        const occupied =
          existing &&
          existing.places.some((slot) => {
            if (slot.type === "gap" || slot.type === "route") return false;
            return byId.get(slot.locationId)?.status !== "cancelled";
          });

        if (!replaceAll && occupied && existing && !aiDay) {
          mergedDays.push({
            ...existing,
            day: dayNumber,
            date,
            places: existing.places
              .filter((slot) => {
                if (slot.type === "gap" || slot.type === "route") return true;
                return byId.get(slot.locationId)?.status !== "cancelled";
              })
              .map((slot, order) => ({ ...slot, order })),
            ...(weather ? { weather } : {}),
          });
          continue;
        }

        if (aiDay) {
          const owner = owningDestinationForDate(destinations, date.toDate());
          mergedDays.push({
            day: dayNumber,
            date,
            title: owner?.cityName || `Day ${dayNumber}`,
            places: mergeDaySlots(newIds, dayRoutes),
            ...(weather ? { weather } : {}),
          });
          continue;
        }

        if (existing && !replaceAll) {
          mergedDays.push({
            ...existing,
            day: dayNumber,
            date,
            ...(weather ? { weather } : {}),
          });
        } else {
          const owner = owningDestinationForDate(destinations, date.toDate());
          mergedDays.push({
            day: dayNumber,
            date,
            title: owner?.cityName || `Day ${dayNumber}`,
            places: [],
            ...(weather ? { weather } : {}),
          });
        }
      }

      const nextIds = Array.from(
        new Set([
          ...trip.savedPlaceIds,
          ...mergedDays.flatMap((day) =>
            day.places
              .filter((slot) => slot.type !== "gap" && slot.type !== "route")
              .map((slot) => slot.locationId)
          ),
        ])
      );

      await onSaved({
        savedPlaceIds: nextIds,
        itinerary: {
          status: "generated",
          days: mergedDays,
        },
      });

      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save planned places."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (aiResult) {
      await handleSaveAiResult();
      return;
    }
    if (!result || result.days.length === 0) return;
    setSaving(true);
    setError(null);

    try {
      // Wait for Pexels photo URLs so create/backfill see the same images as the modal.
      const enrichedPlan = await photoEnrichPromiseRef.current;
      const live = resultRef.current;
      if (!live || live.days.length === 0) {
        setError("Could not save planned places.");
        return;
      }

      const imageByKey = new Map<string, string | null | undefined>();
      for (const day of enrichedPlan?.days ?? []) {
        for (const place of day.places) {
          imageByKey.set(placeKey(day.day, place), place.imageUrl);
        }
      }
      // Live list wins (user may have removed places after photos finished).
      const plan: PlanTripResult = {
        ...live,
        days: live.days.map((day) => ({
          ...day,
          places: day.places.map((place) => {
            if (suggestionImageUrl(place)) return place;
            const key = placeKey(day.day, place);
            if (!imageByKey.has(key)) return place;
            return { ...place, imageUrl: imageByKey.get(key) };
          }),
        })),
      };
      resultRef.current = plan;

      const destinations = listTripDestinations(trip);
      const replaceAll = intent === "regenerate";
      const occupiedIds = new Set(
        trip.itinerary.days.flatMap((day) =>
          day.places
            .filter((slot) => slot.type !== "gap" && slot.type !== "route")
            .map((slot) => slot.locationId)
        )
      );
      // Match against all locations first; destination pool is only a preference order.
      const destinationPool = matchLocationsToDestinations(
        locations,
        destinations
      );
      const matchPool = [
        ...destinationPool,
        ...locations.filter(
          (place) =>
            place.status !== "cancelled" &&
            !destinationPool.some((hit) => hit.id === place.id)
        ),
      ];
      // Regenerate may reuse places already on the itinerary.
      const used = new Set(replaceAll ? [] : occupiedIds);
      const suggestionByDay = new Map(
        plan.days.map((d) => [d.day, d] as const)
      );
      const locationIdsByDay = new Map<
        number,
        Array<{
          locationId: string;
          title: string;
          description?: string;
          imageUrl?: string;
        }>
      >();

      for (const day of plan.days) {
        const ids: Array<{
          locationId: string;
          title: string;
          description?: string;
          imageUrl?: string;
        }> = [];
        for (const place of day.places) {
          const placeTitle = place.title.trim();
          const placeDescription =
            place.description?.trim() || place.why?.trim() || undefined;
          const placeImageUrl = suggestionImageUrl(place) || undefined;
          const hit = matchSuggestionToSaved(place, matchPool, used);
          if (hit) {
            used.add(hit.id);
            ids.push({
              locationId: hit.id,
              title: placeTitle || hit.title,
              ...(placeDescription ? { description: placeDescription } : {}),
              ...(placeImageUrl ? { imageUrl: placeImageUrl } : {}),
            });
            await syncLocationFromSuggestion(userId, hit, place);
            continue;
          }

          const createdId = await createLocationFromSuggestion(
            userId,
            place,
            trip
          );
          if (!createdId) continue;
          used.add(createdId);
          ids.push({
            locationId: createdId,
            title: placeTitle,
            ...(placeDescription ? { description: placeDescription } : {}),
            ...(placeImageUrl ? { imageUrl: placeImageUrl } : {}),
          });
        }
        locationIdsByDay.set(day.day, ids);
      }

      // Persist AI routes into TripRoute collection.
      // User legs (existingRouteId) are only linked into the itinerary — never duplicated.
      const existingRoutes = await listTripRoutes(userId, trip.id);
      const existingRouteIds = new Set(existingRoutes.map((r) => r.id));
      let nextOrder = nextRouteOrder(existingRoutes);
      const createdRouteIdsByDay = new Map<
        number,
        Array<{ routeId: string; insertAt: number; title: string }>
      >();

      for (const suggestion of plan.routes ?? []) {
        const existingId = suggestion.existingRouteId?.trim();
        if (existingId && existingRouteIds.has(existingId)) {
          const list = createdRouteIdsByDay.get(suggestion.day) ?? [];
          list.push({
            routeId: existingId,
            insertAt: suggestion.insertAt,
            title: transferTitle(suggestion),
          });
          createdRouteIdsByDay.set(suggestion.day, list);
          continue;
        }
        if (suggestion.role === "user") {
          // Echoed user route without a resolvable id — skip create.
          continue;
        }

        const routeId = await createTripRoute(userId, {
          tripId: trip.id,
          order: nextOrder,
          from: suggestion.from,
          to: suggestion.to,
          transport: suggestion.transport,
          status: "planned",
          durationApproximate:
            suggestion.durationApproximate ??
            (suggestion.transport !== "flight" &&
              suggestion.transport !== "train"),
          ...(suggestion.departure
            ? { departure: suggestion.departure }
            : {
                departure: {
                  datetime: `${suggestion.date}T00:00:00Z`,
                  timezone: "",
                  timeKnown: false,
                },
              }),
          ...(suggestion.arrival ? { arrival: suggestion.arrival } : {}),
          ...(suggestion.durationMinutes != null
            ? { durationMinutes: suggestion.durationMinutes }
            : {}),
          ...(suggestion.note?.trim() ? { note: suggestion.note.trim() } : {}),
          ...(suggestion.priceAmount != null
            ? { priceAmount: suggestion.priceAmount }
            : {}),
          ...(suggestion.priceCurrency
            ? { priceCurrency: suggestion.priceCurrency }
            : {}),
          ...(suggestion.priceLabel?.trim()
            ? { priceLabel: suggestion.priceLabel.trim() }
            : {}),
          ...(suggestion.link?.trim() ? { link: suggestion.link.trim() } : {}),
        });
        nextOrder += 1;
        const list = createdRouteIdsByDay.get(suggestion.day) ?? [];
        list.push({
          routeId,
          insertAt: suggestion.insertAt,
          title: transferTitle(suggestion),
        });
        createdRouteIdsByDay.set(suggestion.day, list);
      }

      const weatherByIso = weatherByIsoRef.current;
      const dayCount = tripDayCount(trip.startDate, trip.endDate);
      const start = startOfUtcDay(trip.startDate.toDate());
      const existingByDay = new Map(
        trip.itinerary.days.map((d) => [d.day, d])
      );

      const slotFromId = (
        entry: {
          locationId: string;
          title: string;
          description?: string;
          imageUrl?: string;
        },
        order: number
      ): ItineraryPlace => {
        const loc = byId.get(entry.locationId);
        return {
          locationId: entry.locationId,
          order,
          status:
            loc?.status === "visited"
              ? ("visited" as const)
              : ("planned" as const),
          ...(entry.title.trim() ? { title: entry.title.trim() } : {}),
          ...(entry.description?.trim()
            ? { description: entry.description.trim() }
            : {}),
          ...(entry.imageUrl?.trim()
            ? { imageUrl: entry.imageUrl.trim() }
            : {}),
        };
      };

      const weatherForDate = (date: Timestamp): ItineraryDayWeather | undefined =>
        weatherByIso.get(toIsoDate(date.toDate()));

      const mergeDaySlots = (
        locationEntries: Array<{
          locationId: string;
          title: string;
          description?: string;
          imageUrl?: string;
        }>,
        routeSlots: Array<{ routeId: string; insertAt: number; title: string }>
      ): ItineraryPlace[] => {
        const sortedRoutes = [...routeSlots].sort(
          (a, b) => a.insertAt - b.insertAt
        );
        const slots: ItineraryPlace[] = [];
        let routeCursor = 0;
        for (let i = 0; i <= locationEntries.length; i += 1) {
          while (
            routeCursor < sortedRoutes.length &&
            sortedRoutes[routeCursor]!.insertAt <= i
          ) {
            const route = sortedRoutes[routeCursor]!;
            slots.push({
              locationId: `route:${route.routeId}`,
              order: slots.length,
              status: "planned",
              type: "route",
              routeId: route.routeId,
              title: route.title,
            });
            routeCursor += 1;
          }
          if (i < locationEntries.length) {
            slots.push(slotFromId(locationEntries[i]!, slots.length));
          }
        }
        return slots;
      };

      const mergedDays: ItineraryDay[] = [];
      for (let i = 0; i < dayCount; i += 1) {
        const dayNumber = i + 1;
        const date = Timestamp.fromDate(addUtcDays(start, i));
        const weather = weatherForDate(date);
        const existing = existingByDay.get(dayNumber);
        const suggestion = suggestionByDay.get(dayNumber);
        const newIds = locationIdsByDay.get(dayNumber) ?? [];
        const dayRoutes = createdRouteIdsByDay.get(dayNumber) ?? [];
        const occupied =
          existing &&
          existing.places.some((slot) => {
            if (slot.type === "gap" || slot.type === "route") return false;
            return byId.get(slot.locationId)?.status !== "cancelled";
          });

        if (!replaceAll && occupied && existing) {
          mergedDays.push({
            ...existing,
            day: dayNumber,
            date,
            places: existing.places
              .filter((slot) => {
                if (slot.type === "gap" || slot.type === "route") return true;
                return byId.get(slot.locationId)?.status !== "cancelled";
              })
              .map((slot, order) => ({ ...slot, order })),
            ...(weather ? { weather } : {}),
          });
          continue;
        }

        if (suggestion) {
          mergedDays.push({
            day: dayNumber,
            date,
            title: suggestion.title,
            description: suggestion.description,
            places: mergeDaySlots(newIds, dayRoutes),
            ...(weather ? { weather } : {}),
          });
          continue;
        }

        if (existing && !replaceAll) {
          mergedDays.push({
            ...existing,
            day: dayNumber,
            date,
            places: [],
            ...(weather ? { weather } : {}),
          });
        } else {
          const owner = owningDestinationForDate(destinations, date.toDate());
          mergedDays.push({
            day: dayNumber,
            date,
            title: owner?.cityName || `Day ${dayNumber}`,
            places: [],
            ...(weather ? { weather } : {}),
          });
        }
      }

      const nextIds = Array.from(
        new Set([
          ...trip.savedPlaceIds,
          ...mergedDays.flatMap((day) =>
            day.places
              .filter((slot) => slot.type !== "gap" && slot.type !== "route")
              .map((slot) => slot.locationId)
          ),
        ])
      );

      await onSaved({
        savedPlaceIds: nextIds,
        itinerary: {
          status: replaceAll ? "generated" : "generated",
          days: mergedDays,
        },
      });

      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save planned places."
      );
    } finally {
      setSaving(false);
    }
  }

  const sheetTitle =
    phase === "results"
      ? intent === "regenerate"
        ? "Regenerated itinerary"
        : "Your AI itinerary"
      : phase === "loading"
        ? intent === "regenerate"
          ? "Regenerating your trip"
          : "Planning your trip"
        : intent === "regenerate"
          ? "Regenerate itinerary"
          : "Plan my trip";

  const primaryDest = primaryTripDestination(trip);
  const destinations = listTripDestinations(trip);
  const coverPhoto =
    trip.photoUrl?.trim() ||
    primaryDest.photos?.find(Boolean) ||
    destinations.map((d) => d.photos?.find(Boolean)).find(Boolean) ||
    null;
  const destCountryCode = resolveCountryCode(primaryDest.countryName) || "";
  const destFlag = destCountryCode ? getFlagEmoji(destCountryCode) : "";
  const tripDayTotal = tripDayCount(trip.startDate, trip.endDate);
  const setupBlurb =
    intent === "regenerate" ? (
      <>
        Rebuild the full itinerary for{" "}
        <span className="font-medium text-text">{primaryDest.cityName}</span>{" "}
        around {leisureLabel.toLowerCase()}. This replaces your current plan.
      </>
    ) : leisureType === "umrah" ? (
      <>
        We&apos;ll plan {emptyDayCount} empty{" "}
        {emptyDayCount === 1 ? "day" : "days"} around worship and rest in Makkah
        and Madinah. Sightseeing is optional — unused time is fine.
      </>
    ) : leisureType === "custom" ? (
      <>
        We&apos;ll plan {emptyDayCount} empty{" "}
        {emptyDayCount === 1 ? "day" : "days"} in{" "}
        <span className="font-medium text-text">{primaryDest.cityName}</span>{" "}
        prioritizing{" "}
        <span className="font-medium text-text">
          {trip.leisureCustom?.trim() || "your custom activities"}
        </span>
        .
      </>
    ) : leisureType === "relaxation" ? (
      <>
        We&apos;ll plan {emptyDayCount} empty{" "}
        {emptyDayCount === 1 ? "day" : "days"} for relaxation in{" "}
        <span className="font-medium text-text">{primaryDest.cityName}</span>.
        Expect free time, not a packed attraction list.
      </>
    ) : (
      <>
        We&apos;ll plan {emptyDayCount} empty{" "}
        {emptyDayCount === 1 ? "day" : "days"} in{" "}
        <span className="font-medium text-text">{primaryDest.cityName}</span> around{" "}
        {leisureLabel.toLowerCase()}. The goal is your trip purpose, not filling
        every hour.
      </>
    );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      showClose={false}
      size="lg"
      className="md:max-w-xl"
      bodyClassName="!px-0 !py-0"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="relative shrink-0 overflow-hidden border-b border-divider px-5 pb-4 pt-5">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--color-primary-tint)_0%,_transparent_55%)]"
            aria-hidden
          />
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute right-4 top-4 z-10 rounded-full p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="relative">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-primary-tint px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
              <Sparkles className="h-3 w-3" aria-hidden />
              {phase === "results"
                ? "AI itinerary"
                : phase === "loading"
                  ? "Planning"
                  : intent === "regenerate"
                    ? "Regenerate"
                    : "Plan trip"}
            </div>
            <h2 className="mt-3 pr-10 font-[family-name:var(--font-lobster)] text-3xl tracking-tight text-text">
              {sheetTitle}
            </h2>
            {phase === "setup" ? (
              <p className="mt-1.5 max-w-md text-sm leading-relaxed text-text-secondary">
                {setupBlurb}
              </p>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {phase === "setup" ? (
            <div className="flex flex-col gap-5">
              <div className="overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-sm">
                <div className="relative aspect-[2.2/1] bg-surface">
                  {coverPhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={coverPhoto}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary-tint to-surface">
                      <MapPin className="h-8 w-8 text-primary/50" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-3.5">
                    <p className="truncate text-lg font-semibold text-white drop-shadow-sm">
                      {destFlag ? `${destFlag} ` : ""}
                      {primaryDest.cityName}
                    </p>
                    <p className="truncate text-sm text-white/85">
                      {primaryDest.countryName}
                      {destinations.length > 1
                        ? ` · ${destinations.length} cities`
                        : ""}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 divide-x divide-divider border-t border-divider">
                  <div className="px-3 py-3 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                      Days
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-text">
                      {intent === "regenerate" ? tripDayTotal : emptyDayCount}
                      {intent === "regenerate" ? "" : " empty"}
                    </p>
                  </div>
                  <div className="px-3 py-3 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                      Style
                    </p>
                    <p className="mt-0.5 truncate text-sm font-semibold text-text">
                      {leisureLabel}
                    </p>
                  </div>
                  <div className="px-3 py-3 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                      Credits
                    </p>
                    <p className="mt-0.5 inline-flex items-center justify-center gap-1 text-sm font-semibold text-text">
                      <Coins className="h-3.5 w-3.5 text-warning" aria-hidden />
                      {actionCost}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-surface/50 px-4 py-3.5">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-tint text-primary">
                    <CalendarDays className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text">
                      {intent === "regenerate"
                        ? "Full rebuild"
                        : "Purpose-first plan"}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
                      {intent === "regenerate"
                        ? `This rebuild costs ${recreateCost} AI credits (balance ${aiCreditsBalance}).`
                        : `Uses ${generateCost} AI credits (balance ${aiCreditsBalance}). Free time is allowed — we won't pack every hour.`}
                    </p>
                  </div>
                </div>
              </div>

              {error ? (
                <p className="rounded-xl border border-error/20 bg-error-background px-3 py-2.5 text-sm text-error">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}

          {phase === "loading" ? (
            <div className="flex flex-col items-center justify-center gap-4 py-14 text-center">
              <div className="relative flex h-16 w-16 items-center justify-center">
                <span className="absolute inset-0 animate-ping rounded-full bg-primary/15" />
                <span className="absolute inset-2 rounded-full bg-primary-tint" />
                <Loader2 className="relative h-7 w-7 animate-spin text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-text">
                  Planning days around your trip purpose…
                </p>
                <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-text-secondary">
                  {leisureType === "umrah"
                    ? "Building a worship-first Umrah itinerary with rest — extra ziyarat only if they fit."
                    : `Shaping ${leisureLabel.toLowerCase()} in ${primaryDest.cityName} — free time is allowed.`}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-medium text-text-secondary ring-1 ring-border/70">
                  {primaryDest.cityName}
                </span>
                <span className="rounded-full bg-primary-tint px-2.5 py-1 text-[11px] font-medium text-primary">
                  {leisureLabel}
                </span>
              </div>
            </div>
          ) : null}

          {phase === "results" && aiResult ? (
            <div className="flex flex-col gap-5">
              <div className="rounded-2xl border border-border bg-surface/50 px-4 py-3.5">
                <p className="text-sm text-text-secondary">
                  AI plan for{" "}
                  <span className="font-medium text-text">
                    {leisureLabel.toLowerCase()}
                  </span>
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-elevated px-2.5 py-1 text-[11px] font-medium text-text-secondary ring-1 ring-border/70">
                    <Route className="h-3 w-3 text-primary" aria-hidden />
                    {remainingRouteCount} route
                    {remainingRouteCount === 1 ? "" : "s"}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-elevated px-2.5 py-1 text-[11px] font-medium text-text-secondary ring-1 ring-border/70">
                    <MapPin className="h-3 w-3 text-primary" aria-hidden />
                    {remainingPlaceCount} place
                    {remainingPlaceCount === 1 ? "" : "s"}
                  </span>
                  {(aiResult.stages?.length ?? 0) > 0 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-tint px-2.5 py-1 text-[11px] font-medium text-primary">
                      <Sparkles className="h-3 w-3" aria-hidden />
                      {aiResult.stages!.join(" + ")}
                    </span>
                  ) : null}
                </div>
              </div>

              {aiResult.itinerary.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border bg-surface px-4 py-8 text-center text-sm text-text-secondary">
                  No itinerary days returned. Try generating again.
                </p>
              ) : (
                <div className="space-y-3">
                  {aiResult.itinerary.map((day) => (
                    <AiResultDayCard
                      key={`ai-day-${day.day}-${day.date}`}
                      day={day}
                      locationTitleById={byId}
                    />
                  ))}
                </div>
              )}

              {error ? (
                <p className="rounded-xl border border-error/20 bg-error-background px-3 py-2.5 text-sm text-error">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}

          {phase === "results" && result && !aiResult ? (
            <div className="flex flex-col gap-5">
              <div className="rounded-2xl border border-border bg-surface/50 px-4 py-3.5">
                <p className="text-sm leading-relaxed text-text-secondary">
                  Preview for{" "}
                  <span className="font-medium text-text">
                    {LEISURE_TYPE_OPTIONS.find(
                      (o) => o.value === result.leisureType
                    )?.label ?? result.leisureType}
                  </span>
                  . Transfers appear with places in order. Remove anything you
                  don&apos;t want, then save — or recreate for {recreateCost} more
                  AI credits.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-elevated px-2.5 py-1 text-[11px] font-medium text-text-secondary ring-1 ring-border/70">
                    <CalendarDays className="h-3 w-3 text-primary" aria-hidden />
                    {result.days.length} day
                    {result.days.length === 1 ? "" : "s"}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-elevated px-2.5 py-1 text-[11px] font-medium text-text-secondary ring-1 ring-border/70">
                    <MapPin className="h-3 w-3 text-primary" aria-hidden />
                    {remainingPlaceCount} place
                    {remainingPlaceCount === 1 ? "" : "s"}
                  </span>
                </div>
              </div>

              {result.days.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border bg-surface px-4 py-8 text-center text-sm text-text-secondary">
                  No days left in this plan. Recreate to get a new one.
                </p>
              ) : (
                <div className="space-y-3">
                  {result.days.map((day) => (
                    <ResultDayCard
                      key={`plan-day-${day.day}`}
                      day={day}
                      routes={result.routes ?? []}
                      onRemovePlace={(place) => removePlace(day.day, place)}
                      onRemoveRoute={removeRoute}
                    />
                  ))}
                </div>
              )}

              {error ? (
                <p className="rounded-xl border border-error/20 bg-error-background px-3 py-2.5 text-sm text-error">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {phase === "setup" ? (
          <div className="shrink-0 border-t border-divider bg-surface-elevated/95 px-5 py-4 backdrop-blur-sm">
            <div className="mb-3 flex items-center justify-between gap-3 text-xs text-text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Coins className="h-3.5 w-3.5 text-warning" aria-hidden />
                Uses {actionCost} AI credits
              </span>
              <span>
                Balance:{" "}
                <span className="font-medium text-text-secondary">
                  {aiCreditsBalance}
                </span>
              </span>
            </div>
            {intent === "regenerate" ? (
              <Button
                icon={RefreshCw}
                loading={busy}
                onClick={() => void runPlan("regenerate")}
                className="w-full !h-11 !border-primary !bg-primary !text-white hover:!bg-primary-hover"
              >
                <span className="inline-flex items-center gap-2">
                  Regenerate itinerary
                  <AiCreditCostBadge credits={recreateCost} onPrimary />
                </span>
              </Button>
            ) : (
              <Button
                icon={Sparkles}
                loading={busy}
                onClick={() => void runPlan("generate")}
                className="w-full !h-11 !border-primary !bg-primary !text-white hover:!bg-primary-hover"
              >
                <span className="inline-flex items-center gap-2">
                  Generate itinerary
                  <AiCreditCostBadge credits={generateCost} onPrimary />
                </span>
              </Button>
            )}
          </div>
        ) : null}

        {phase === "results" ? (
          <div className="shrink-0 border-t border-divider bg-surface-elevated/95 px-5 py-4 backdrop-blur-sm">
            <div className="grid grid-cols-2 gap-3">
              <Button
                icon={RefreshCw}
                variant="secondary"
                loading={busy}
                disabled={saving}
                onClick={() => void runPlan("regenerate")}
                className="w-full !h-11 !border-border !bg-surface-elevated !text-text"
              >
                <span className="inline-flex items-center gap-2">
                  Recreate
                  <AiCreditCostBadge credits={recreateCost} />
                </span>
              </Button>
              {aiResult ? (
                <Button
                  icon={Save}
                  loading={saving}
                  disabled={
                    busy ||
                    (aiResult.itinerary.length === 0 &&
                      remainingPlaceCount === 0 &&
                      remainingRouteCount === 0)
                  }
                  onClick={() => void handleSave()}
                  className="w-full !h-11 !border-primary !bg-primary !text-white hover:!bg-primary-hover"
                >
                  Save
                  {remainingPlaceCount + remainingRouteCount > 0
                    ? ` (${remainingPlaceCount}p · ${remainingRouteCount}r)`
                    : ""}
                </Button>
              ) : (
                <Button
                  icon={Save}
                  loading={saving}
                  disabled={busy || !result || result.days.length === 0}
                  onClick={() => void handleSave()}
                  className="w-full !h-11 !border-primary !bg-primary !text-white hover:!bg-primary-hover"
                >
                  Save
                  {remainingPlaceCount > 0 ? ` (${remainingPlaceCount})` : ""}
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

function AiCreditCostBadge({
  credits,
  onPrimary = false,
}: {
  credits: number;
  onPrimary?: boolean;
}) {
  return (
    <span
      className={
        onPrimary
          ? "inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tabular-nums text-white"
          : "inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-warning"
      }
    >
      <Coins className="h-3 w-3" aria-hidden />
      {credits}
    </span>
  );
}

function formatFreeTimeLabel(freeTime: {
  start?: string;
  end?: string;
  durationMinutes?: number;
}): string | null {
  const parts: string[] = [];
  if (
    typeof freeTime.durationMinutes === "number" &&
    Number.isFinite(freeTime.durationMinutes)
  ) {
    const mins = Math.max(0, Math.round(freeTime.durationMinutes));
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      parts.push(m > 0 ? `${h}h ${m}m free` : `${h}h free`);
    } else if (mins > 0) {
      parts.push(`${mins}m free`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function nestedPlaceTitle(
  place: TripPlannerAiResponseNestedPlace,
  locationTitleById: Map<string, SavedLocation>
): string {
  if ("locationId" in place && place.locationId) {
    return (
      locationTitleById.get(place.locationId)?.title?.trim() ||
      place.locationId
    );
  }
  const full = place as Extract<
    TripPlannerAiResponseNestedPlace,
    { title: string }
  >;
  return full.title?.trim() || full.id || "Place";
}

function AiResultDayCard({
  day,
  locationTitleById,
}: {
  day: TripPlannerAiResponseDay;
  locationTitleById: Map<string, SavedLocation>;
}) {
  const dateLabel = parseIsoDate(day.date).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const hasRoutes = day.routes.length > 0;
  const placeCount = day.places.reduce(
    (n, slot) => n + (slot.places?.length ?? 0),
    0
  );
  const hasPlaces = placeCount > 0;
  const empty = !hasRoutes && !hasPlaces;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-sm">
      <header className="flex items-center gap-3 border-b border-divider bg-surface/80 px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-white">
          {day.day}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text">Day {day.day}</p>
          <p className="text-xs text-text-secondary">{dateLabel}</p>
        </div>
        {!empty ? (
          <div className="flex shrink-0 gap-1.5">
            {hasRoutes ? (
              <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] font-medium text-text-muted ring-1 ring-border/70">
                {day.routes.length}r
              </span>
            ) : null}
            {hasPlaces ? (
              <span className="rounded-full bg-primary-tint px-2 py-0.5 text-[10px] font-medium text-primary">
                {placeCount}p
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      {empty ? (
        <p className="px-4 py-4 text-sm text-text-secondary">
          No routes or places on this day.
        </p>
      ) : (
        <div className="space-y-2.5 p-3">
          {day.routes.map((route, index) => (
            <AiResultRouteRow
              key={`route-${day.day}-${index}-${route.transport}`}
              route={route}
            />
          ))}

          {day.places.map((slot) => {
            const freeLabel = formatFreeTimeLabel(slot.freeTime ?? {});
            const places = slot.places ?? [];
            if (places.length === 0 && !freeLabel) return null;
            return (
              <div
                key={`slot-${day.day}-${slot.cityId}`}
                className="rounded-xl border border-border/70 bg-surface px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface-elevated px-2 py-0.5 text-[11px] font-medium text-text-secondary ring-1 ring-border/60">
                    <MapPin className="h-3 w-3 text-primary" aria-hidden />
                    {slot.cityId}
                  </span>
                  {freeLabel ? (
                    <span className="rounded-full bg-primary-tint px-2 py-0.5 text-[11px] font-medium text-primary">
                      {freeLabel}
                    </span>
                  ) : null}
                  {slot.leisureType ? (
                    <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[11px] font-medium text-text-muted ring-1 ring-border/60">
                      {slot.leisureType}
                    </span>
                  ) : null}
                </div>
                {places.length > 0 ? (
                  <ul className="mt-2.5 space-y-2">
                    {places.map((place, i) => {
                      const title = nestedPlaceTitle(place, locationTitleById);
                      const isSaved = "locationId" in place && place.locationId;
                      const category =
                        !isSaved && "category" in place
                          ? place.category
                          : undefined;
                      const CategoryIcon = category
                        ? PLACE_CATEGORY_ICONS[category] ?? MapPin
                        : MapPin;
                      return (
                        <li
                          key={
                            isSaved
                              ? `saved-${place.locationId}`
                              : `new-${"id" in place ? place.id : i}`
                          }
                          className="flex items-start gap-2.5 rounded-lg bg-surface-elevated px-2.5 py-2 ring-1 ring-border/50"
                        >
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-tint text-primary">
                            <CategoryIcon className="h-3.5 w-3.5" aria-hidden />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-text">
                              {title}
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                              {isSaved ? (
                                <span className="rounded-full bg-success-background px-1.5 py-0.5 text-[10px] font-medium text-success">
                                  Saved
                                </span>
                              ) : null}
                              {category ? (
                                <span className="text-[11px] text-text-secondary">
                                  {PLACE_CATEGORY_LABELS[category] ?? category}
                                </span>
                              ) : null}
                            </span>
                            {!isSaved &&
                            "description" in place &&
                            place.description?.trim() ? (
                              <span className="mt-1 block text-xs leading-relaxed text-text-secondary line-clamp-2">
                                {place.description.trim()}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-text-secondary">
                    Free time — no places filled.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AiResultRouteRow({ route }: { route: TripPlannerAiResponseRoute }) {
  const TransportIcon = ROUTE_TRANSPORT_ICON[route.transport] ?? TrainFront;
  const transportLabel =
    ROUTE_TRANSPORT_LABEL[route.transport] ?? route.transport;
  const price =
    route.priceLabel ||
    (route.priceAmount != null
      ? route.priceAmount === 0
        ? "Free"
        : `${route.priceAmount}${
            route.priceCurrency ? ` ${route.priceCurrency}` : ""
          }`
      : null);

  return (
    <div className="flex items-start gap-3 rounded-xl border border-primary/15 bg-primary-tint/40 px-3 py-2.5">
      <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-elevated text-primary shadow-sm ring-1 ring-border/60">
        <TransportIcon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text">
          {route.from.name} → {route.to.name}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[11px] font-medium text-primary ring-1 ring-border/60">
            {transportLabel}
          </span>
          <span className="rounded-full bg-surface-elevated/80 px-2 py-0.5 text-[11px] font-medium text-text-muted">
            {route.source === "generated" ? "Generated" : "Existing"}
          </span>
          {price ? (
            <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[11px] font-medium text-text">
              {price}
            </span>
          ) : null}
        </div>
        {route.link ? (
          <a
            href={route.link}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Booking link
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function ResultDayCard({
  day,
  routes,
  onRemovePlace,
  onRemoveRoute,
}: {
  day: PlannedDaySuggestion;
  routes: PlannedRouteSuggestion[];
  onRemovePlace: (place: PlannedPlaceSuggestion) => void;
  onRemoveRoute: (routeIndex: number) => void;
}) {
  const dateLabel = parseIsoDate(day.date).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const timeline = buildDayTimeline(day, routes);
  const hasItems = timeline.length > 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-sm">
      <header className="border-b border-divider bg-surface/80 px-4 py-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-white">
            {day.day}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-text-secondary">
              Day {day.day} · {dateLabel}
            </p>
            <h3 className="mt-0.5 text-sm font-semibold text-text">{day.title}</h3>
            {day.description ? (
              <p className="mt-1 text-xs leading-relaxed text-text-secondary line-clamp-2">
                {day.description}
              </p>
            ) : null}
          </div>
        </div>
      </header>
      {!hasItems ? (
        <p className="px-4 py-4 text-sm text-text-secondary">
          No suggestion for this day — try regenerating for a destination-specific
          place.
        </p>
      ) : (
        <ul className="space-y-2 p-3">
          {timeline.map((item) => {
            if (item.kind === "route") {
              const { route, routeIndex } = item;
              const TransportIcon =
                ROUTE_TRANSPORT_ICON[route.transport] ?? TrainFront;
              const transportLabel =
                ROUTE_TRANSPORT_LABEL[route.transport] ?? route.transport;
              const duration = formatRouteDuration(
                route.durationMinutes,
                route.durationApproximate ?? true
              );
              const price =
                route.priceLabel ||
                (route.priceAmount != null
                  ? route.priceAmount === 0
                    ? "Free"
                    : `${route.priceAmount}${
                        route.priceCurrency
                          ? ` ${route.priceCurrency}`
                          : ""
                      }`
                  : null);
              return (
                <li
                  key={routeKey(route, routeIndex)}
                  className="rounded-xl border border-primary/15 bg-primary-tint/40 px-3 py-2.5"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-elevated text-primary shadow-sm ring-1 ring-border/60">
                      <TransportIcon className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-text">
                          {transferTitle(route)}
                        </p>
                        <span className="inline-flex items-center gap-1 rounded-full bg-surface-elevated px-2 py-0.5 text-[11px] font-medium text-primary ring-1 ring-border/60">
                          {transportLabel}
                        </span>
                      </div>
                      {duration ? (
                        <p className="mt-1 text-xs text-text-secondary">
                          {duration}
                          {route.note?.trim() ? ` · ${route.note.trim()}` : ""}
                        </p>
                      ) : route.note?.trim() ? (
                        <p className="mt-1 text-xs text-text-secondary">
                          {route.note.trim()}
                        </p>
                      ) : null}
                      {(price || route.link) && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {price ? (
                            <span className="inline-flex items-center rounded-full bg-surface-elevated px-2 py-0.5 text-[11px] font-medium text-text ring-1 ring-border/60">
                              {price}
                            </span>
                          ) : null}
                          {route.link ? (
                            <a
                              href={route.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Book / info
                            </a>
                          ) : null}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove transfer ${transferTitle(route)}`}
                      onClick={() => onRemoveRoute(routeIndex)}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-error-background hover:text-error"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            }

            const place = item.place;
            const category = place.category ?? "other";
            const CategoryIcon = PLACE_CATEGORY_ICONS[category] ?? MapPin;
            const categoryLabel =
              PLACE_CATEGORY_LABELS[category] ?? PLACE_CATEGORY_LABELS.other;
            return (
              <li
                key={placeKey(day.day, place)}
                className="rounded-xl border border-border/70 bg-surface px-3 py-2.5"
              >
                <div className="flex items-start gap-2.5">
                  <SuggestedPlaceThumb
                    imageUrl={place.imageUrl}
                    title={place.title}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-text">
                        {place.title}
                      </p>
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary-tint px-2 py-0.5 text-[11px] font-medium text-primary">
                        <CategoryIcon className="h-3 w-3" />
                        {categoryLabel}
                      </span>
                    </div>
                    <p className="mt-1 flex items-center gap-1 text-xs text-text-secondary">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {place.cityName}, {place.countryName}
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-text-secondary line-clamp-3">
                      {place.description}
                    </p>
                    {(place.priceLabel ||
                      place.priceAmount != null ||
                      place.link) && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {place.priceLabel || place.priceAmount != null ? (
                          <span className="inline-flex items-center rounded-full bg-surface-elevated px-2 py-0.5 text-[11px] font-medium text-text ring-1 ring-border/60">
                            {place.priceLabel ||
                              (place.priceAmount === 0
                                ? "Free"
                                : `${place.priceAmount}${
                                    place.priceCurrency
                                      ? ` ${place.priceCurrency}`
                                      : ""
                                  }`)}
                          </span>
                        ) : null}
                        {place.link ? (
                          <a
                            href={place.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            {place.category === "transport"
                              ? "Buy tickets"
                              : "Tickets / info"}
                          </a>
                        ) : null}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${place.title}`}
                    onClick={() => onRemovePlace(place)}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-error-background hover:text-error"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SuggestedPlaceThumb({
  imageUrl,
  title,
}: {
  imageUrl?: string | null;
  title?: string;
}) {
  const src = imageUrl?.trim() || null;
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!src) {
    return (
      <div className="mt-0.5 h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-primary-tint to-surface ring-1 ring-border/60">
        <div className="flex h-full items-center justify-center text-primary/60">
          <MapPin className="h-5 w-5" />
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={title ? `View photo of ${title}` : "View photo"}
        className="mt-0.5 h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-divider ring-1 ring-border/60 transition-opacity hover:opacity-90"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="h-full w-full object-cover" />
      </button>
      {open && mounted
        ? createPortal(
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
              <button
                type="button"
                aria-label="Close photo"
                className="absolute inset-0 bg-text/60 backdrop-blur-[2px]"
                onClick={() => setOpen(false)}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label={title ? `Photo of ${title}` : "Place photo"}
                className="relative z-10 max-h-[85vh] max-w-[min(92vw,40rem)] overflow-hidden rounded-2xl bg-surface-elevated shadow-xl ring-1 ring-border/50"
              >
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setOpen(false)}
                  className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-text/50 text-white transition-colors hover:bg-text/70"
                >
                  <X className="h-4 w-4" />
                </button>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={title ?? ""}
                  className="max-h-[85vh] w-full object-contain"
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
