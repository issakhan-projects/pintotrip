"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Timestamp } from "firebase/firestore";
import {
  Binoculars,
  Building2,
  Coffee,
  FerrisWheel,
  Landmark,
  Loader2,
  MapPin,
  Moon,
  Mountain,
  RefreshCw,
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
import { planTrip } from "@/services/functions";
import {
  addUtcDays,
  startOfUtcDay,
  tripDayCount,
} from "@/services/trip-planner";
import { fetchSuggestedPlacePhoto } from "@/features/add-place/placeSearch";
import {
  planTripRegenerateCost,
  formatInsufficientCreditsMessage,
  isInsufficientAICreditsError,
} from "@/types/credits";
import type { SavedLocation } from "@/hooks/useLocations";
import type {
  ItineraryDay,
  ItineraryDayWeather,
  TripItinerary,
  TripPlannerDoc,
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
} from "@/types/trip-plan";
import { distanceKm } from "./clusterPlaces";
import {
  matchLocationsToDestinations,
  sortLocationsForDestination,
} from "./matchTripPlaces";
import {
  listTripDestinations,
  owningDestinationForDate,
  toIsoDate,
} from "./tripDestinations";
import { weatherForTrip } from "./tripWeather";

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

/** Resolve Google Place photos for AI suggestions (null when missing). */
async function enrichPlanWithPlacePhotos(
  result: PlanTripResult,
  onPlacePhoto: (
    day: number,
    place: PlannedPlaceSuggestion,
    imageUrl: string | null
  ) => void
): Promise<void> {
  await Promise.all(
    result.days.flatMap((day) =>
      day.places.map(async (place) => {
        if (place.imageUrl) {
          onPlacePhoto(day.day, place, place.imageUrl);
          return;
        }
        try {
          const imageUrl = await fetchSuggestedPlacePhoto({
            title: place.title,
            cityName: place.cityName,
            countryName: place.countryName,
            lat: place.lat,
            lon: place.lon,
          });
          onPlacePhoto(day.day, place, imageUrl ?? null);
        } catch {
          onPlacePhoto(day.day, place, null);
        }
      })
    )
  );
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
    if (hit) return hit;
  }

  const title = suggestion.title.trim().toLowerCase();
  let best: SavedLocation | null = null;
  let bestDist = 1.5;

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

interface PlanTripSheetProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  trip: TripPlannerDoc;
  locations: SavedLocation[];
  aiCreditsBalance: number;
  language?: string;
  onSaved: (payload: {
    savedPlaceIds: string[];
    itinerary: TripItinerary;
  }) => Promise<void>;
}

export function PlanTripSheet({
  open,
  onClose,
  trip,
  locations,
  aiCreditsBalance,
  language,
  onSaved,
}: PlanTripSheetProps) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [result, setResult] = useState<PlanTripResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Bumps on close / new plan so in-flight photo fetches cannot overwrite state. */
  const photoEnrichGen = useRef(0);
  const weatherByIsoRef = useRef<Map<string, ItineraryDayWeather>>(new Map());

  const byId = useMemo(
    () => new Map(locations.map((l) => [l.id, l])),
    [locations]
  );

  const existingDays = useMemo(
    () => buildPlanTripExistingDays(trip, byId),
    [trip, byId]
  );

  const emptyDayCount = useMemo(
    () => existingDays.filter((d) => d.placeTitles.length === 0).length,
    [existingDays]
  );

  const leisureType = leisureTypeFromTrip(trip);
  const leisureLabel =
    LEISURE_TYPE_OPTIONS.find((o) => o.value === leisureType)?.label ??
    leisureType;

  const matchingPlaces = useMemo(() => {
    const destinations = listTripDestinations(trip);
    const occupiedIds = new Set(
      trip.itinerary.days.flatMap((day) =>
        day.places.map((slot) => slot.locationId)
      )
    );
    return sortLocationsForDestination(
      matchLocationsToDestinations(locations, destinations).filter(
        (place) => !occupiedIds.has(place.id)
      ),
      destinations
    );
  }, [locations, trip]);

  const remainingPlaceCount = useMemo(
    () => result?.days.reduce((sum, day) => sum + day.places.length, 0) ?? 0,
    [result]
  );

  const recreateCost = planTripRegenerateCost(trip.createMode);

  useEffect(() => {
    if (!open) {
      photoEnrichGen.current += 1;
      weatherByIsoRef.current = new Map();
      setPhase("setup");
      setResult(null);
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
      return {
        ...prev,
        days: prev.days
          .map((day) => {
            if (day.day !== dayNumber) return day;
            return {
              ...day,
              places: day.places.filter((p) => placeKey(day.day, p) !== key),
            };
          })
      };
    });
  }

  async function runPlan(mode: "generate" | "regenerate") {
    if (emptyDayCount === 0) {
      setError("All days already have places. Clear a day first.");
      return;
    }

    if (mode === "regenerate") {
      if (aiCreditsBalance < recreateCost) {
        setError(
          `Not enough AI credits. Need ${recreateCost}, you have ${aiCreditsBalance}.`
        );
        return;
      }
    }

    setBusy(true);
    setError(null);
    if (mode === "generate") {
      setPhase("loading");
    }

    try {
      const destinations = listTripDestinations(trip).map((dest) => ({
        cityName: dest.cityName,
        countryName: dest.countryName,
        ...(dest.countryId ? { countryId: dest.countryId } : {}),
        ...(dest.cityId ? { cityId: dest.cityId } : {}),
        lat: dest.lat,
        lon: dest.lon,
        ...(dest.startDate
          ? { startDate: toIsoDate(dest.startDate.toDate()) }
          : {}),
        ...(dest.endDate ? { endDate: toIsoDate(dest.endDate.toDate()) } : {}),
      }));

      const weather = await weatherForTrip(trip);
      weatherByIsoRef.current = weather.byIsoDate;

      const data = await planTrip({
        tripId: trip.id,
        destination: {
          cityName: trip.destination.cityName,
          countryName: trip.destination.countryName,
          ...(trip.destination.countryId
            ? { countryId: trip.destination.countryId }
            : {}),
          ...(trip.destination.cityId
            ? { cityId: trip.destination.cityId }
            : {}),
          lat: trip.destination.lat,
          lon: trip.destination.lon,
        },
        startDate: toIsoDate(trip.startDate.toDate()),
        endDate: toIsoDate(trip.endDate.toDate()),
        leisureType,
        mode,
        language,
        currency: trip.currency?.code,
        existingDays,
        destinations,
        savedPlaces: matchingPlaces.map((place) => ({
          locationId: place.id,
          title: place.title,
          lat: place.lat,
          lon: place.lon,
          cityName: place.city.name,
          countryName: place.country.name,
          ...(place.city.id ? { cityId: place.city.id } : {}),
          ...(place.country.id ? { countryId: place.country.id } : {}),
          status: place.status,
          ...(place.category ? { category: place.category } : {}),
        })),
        weather: weather.payload,
      });
      // Show text results immediately, then fill Google photos when ready.
      // Merge per-place so removals during fetch are preserved.
      const gen = ++photoEnrichGen.current;
      setResult(data);
      setPhase("results");
      void enrichPlanWithPlacePhotos(data, (dayNumber, place, imageUrl) => {
        if (photoEnrichGen.current !== gen) return;
        const key = placeKey(dayNumber, place);
        setResult((prev) => {
          if (!prev) return prev;
          return {
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
        });
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

  async function handleSave() {
    if (!result || result.days.length === 0) return;
    setSaving(true);
    setError(null);

    try {
      const destinations = listTripDestinations(trip);
      const occupiedIds = new Set(
        trip.itinerary.days.flatMap((day) =>
          day.places.map((slot) => slot.locationId)
        )
      );
      const pool = matchLocationsToDestinations(locations, destinations);
      const used = new Set(occupiedIds);
      const suggestionByDay = new Map(
        result.days.map((d) => [d.day, d] as const)
      );
      const locationIdsByDay = new Map<number, string[]>();

      for (const day of result.days) {
        const ids: string[] = [];
        for (const place of day.places) {
          const hit = matchSuggestionToSaved(place, pool, used);
          if (!hit) continue;
          used.add(hit.id);
          ids.push(hit.id);
        }
        locationIdsByDay.set(day.day, ids);
      }

      const weatherByIso = weatherByIsoRef.current;
      const dayCount = tripDayCount(trip.startDate, trip.endDate);
      const start = startOfUtcDay(trip.startDate.toDate());
      const existingByDay = new Map(
        trip.itinerary.days.map((d) => [d.day, d])
      );

      const slotFromId = (locationId: string, order: number) => {
        const loc = byId.get(locationId);
        return {
          locationId,
          order,
          status:
            loc?.status === "visited"
              ? ("visited" as const)
              : ("planned" as const),
        };
      };

      const weatherForDate = (date: Timestamp): ItineraryDayWeather | undefined =>
        weatherByIso.get(toIsoDate(date.toDate()));

      const mergedDays: ItineraryDay[] = [];
      for (let i = 0; i < dayCount; i += 1) {
        const dayNumber = i + 1;
        const date = Timestamp.fromDate(addUtcDays(start, i));
        const weather = weatherForDate(date);
        const existing = existingByDay.get(dayNumber);
        const suggestion = suggestionByDay.get(dayNumber);
        const newIds = locationIdsByDay.get(dayNumber) ?? [];
        const occupied =
          existing &&
          existing.places.some(
            (slot) => byId.get(slot.locationId)?.status !== "cancelled"
          );

        if (occupied && existing) {
          mergedDays.push({
            ...existing,
            day: dayNumber,
            date,
            places: existing.places
              .filter(
                (slot) => byId.get(slot.locationId)?.status !== "cancelled"
              )
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
            places: newIds.map(slotFromId),
            ...(weather ? { weather } : {}),
          });
          continue;
        }

        if (existing) {
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
            day.places.map((slot) => slot.locationId)
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

  const sheetTitle =
    phase === "results"
      ? "Your AI itinerary"
      : phase === "loading"
        ? "Planning your trip"
        : "Plan my trip";

  return (
    <Sheet open={open} onClose={onClose} title={sheetTitle} size="lg">
      {phase === "setup" ? (
        <div className="flex flex-col gap-5">
          <div>
            <p className="text-sm text-text-secondary">
              {leisureType === "umrah" ? (
                <>
                  We&apos;ll plan {emptyDayCount} empty{" "}
                  {emptyDayCount === 1 ? "day" : "days"} around worship and rest
                  in Makkah and Madinah. Sightseeing is optional — unused time
                  is fine.
                </>
              ) : leisureType === "relaxation" ? (
                <>
                  We&apos;ll plan {emptyDayCount} empty{" "}
                  {emptyDayCount === 1 ? "day" : "days"} for relaxation in{" "}
                  {trip.destination.cityName}. Expect free time, not a packed
                  attraction list.
                </>
              ) : (
                <>
                  We&apos;ll plan {emptyDayCount} empty{" "}
                  {emptyDayCount === 1 ? "day" : "days"} in{" "}
                  {trip.destination.cityName} around{" "}
                  {leisureLabel.toLowerCase()}. The goal is your trip purpose,
                  not filling every hour.
                </>
              )}
            </p>
          </div>

          {error ? (
            <p className="rounded-xl bg-error-background px-3 py-2 text-sm text-error">
              {error}
            </p>
          ) : null}

          <Button
            icon={Sparkles}
            disabled={emptyDayCount === 0}
            onClick={() => void runPlan("generate")}
            className="!bg-primary hover:!bg-primary-hover !border-primary !text-white h-11"
          >
            Generate itinerary
          </Button>
        </div>
      ) : null}

      {phase === "loading" ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-text">
            Planning days around your trip purpose…
          </p>
          <p className="max-w-xs text-sm text-text-secondary">
            {leisureType === "umrah"
              ? "Building a worship-first Umrah itinerary with rest — extra ziyarat only if they fit."
              : `Shaping ${leisureLabel.toLowerCase()} in ${trip.destination.cityName} — free time is allowed.`}
          </p>
        </div>
      ) : null}

      {phase === "results" && result ? (
        <div className="flex flex-col gap-5">
          <div>
            <p className="text-sm text-text-secondary">
              Preview for{" "}
              {LEISURE_TYPE_OPTIONS.find((o) => o.value === result.leisureType)
                ?.label ?? result.leisureType}
              . Days may include free time. Remove places you don&apos;t want,
              then save — or recreate for {recreateCost} more AI credits.
            </p>
          </div>

          {result.days.length === 0 ? (
            <p className="rounded-xl bg-surface px-4 py-6 text-center text-sm text-text-secondary">
              No days left in this plan. Recreate to get a new one.
            </p>
          ) : (
            <div className="space-y-4">
              {result.days.map((day) => (
                <ResultDayCard
                  key={`plan-day-${day.day}`}
                  day={day}
                  onRemovePlace={(place) => removePlace(day.day, place)}
                />
              ))}
            </div>
          )}

          {error ? (
            <p className="rounded-xl bg-error-background px-3 py-2 text-sm text-error">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              icon={RefreshCw}
              variant="secondary"
              loading={busy}
              disabled={saving}
              onClick={() => void runPlan("regenerate")}
              className="!border-border !bg-surface-elevated !text-text h-11"
            >
              Recreate ({recreateCost} AI credits)
            </Button>
            <Button
            icon={Save}
              loading={saving}
              disabled={busy || result.days.length === 0}
              onClick={() => void handleSave()}
              className="!bg-primary hover:!bg-primary-hover !border-primary !text-white h-11"
            >
              Save to trip
              {remainingPlaceCount > 0 ? ` (${remainingPlaceCount})` : ""}
            </Button>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

function ResultDayCard({
  day,
  onRemovePlace,
}: {
  day: PlannedDaySuggestion;
  onRemovePlace: (place: PlannedPlaceSuggestion) => void;
}) {
  const dateLabel = parseIsoDate(day.date).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

  return (
    <section className="rounded-2xl border border-border bg-surface-elevated p-4">
      <header>
        <p className="text-xs font-medium text-text-secondary">
          Day {day.day} · {dateLabel}
        </p>
        <h3 className="mt-1 text-sm font-semibold text-text">{day.title}</h3>
        {day.description ? (
          <p className="mt-0.5 text-sm text-text-secondary">{day.description}</p>
        ) : null}
      </header>
      {day.places.length === 0 ? (
        <p className="mt-3 rounded-xl bg-surface px-3 py-2.5 text-sm text-text-secondary">
          Free time — nothing scheduled.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
        {day.places.map((place) => {
          const category = place.category ?? "other";
          const CategoryIcon = PLACE_CATEGORY_ICONS[category] ?? MapPin;
          const categoryLabel =
            PLACE_CATEGORY_LABELS[category] ?? PLACE_CATEGORY_LABELS.other;
          return (
            <li
              key={placeKey(day.day, place)}
              className="rounded-xl bg-surface px-3 py-2.5"
            >
              <div className="flex items-start gap-2">
                <SuggestedPlaceThumb imageUrl={place.imageUrl} />
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
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-text-secondary">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {place.cityName}, {place.countryName}
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">
                    {place.description}
                  </p>
                  {(place.priceLabel ||
                    place.priceAmount != null ||
                    place.link) && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {place.priceLabel || place.priceAmount != null ? (
                        <span className="inline-flex items-center rounded-full bg-surface-elevated px-2 py-0.5 text-[11px] font-medium text-text">
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
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-error-background hover:text-error"
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
}: {
  imageUrl?: string | null;
}) {
  const src = imageUrl?.trim() || null;
  return (
    <div className="mt-0.5 h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-divider">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-text-muted">
          <MapPin className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}
