"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Timestamp } from "firebase/firestore";
import {
  Binoculars,
  Building2,
  Camera,
  Coffee,
  Compass,
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
  Users,
  UtensilsCrossed,
  Waves,
  X,
  Save,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { planTrip } from "@/services/functions";
import { createUserLocation } from "@/services/locations";
import {
  addUtcDays,
  startOfUtcDay,
  tripDayCount,
} from "@/services/trip-planner";
import { fetchSuggestedPlacePhoto } from "@/features/add-place/placeSearch";
import { resolveCountryCode } from "@/lib/countries";
import { withCityGooglePlaceId, resolveEnglishPlaceIds } from "@/lib/maps";
import { countryIdFromParts, cx, isAsciiId, slugifyId } from "@/lib/utils";
import {
  AI_CREDIT_COSTS,
  formatInsufficientCreditsMessage,
  isInsufficientAICreditsError,
} from "@/types/credits";
import type { SavedLocation } from "@/hooks/useLocations";
import type {
  ItineraryDay,
  TripItinerary,
  TripPlannerDoc,
} from "@/types/trip-planner";
import {
  LEISURE_TYPE_OPTIONS,
  PLACE_CATEGORY_LABELS,
  type LeisureType,
  type PlaceCategory,
  type PlanTripExistingDay,
  type PlanTripResult,
  type PlannedDaySuggestion,
  type PlannedPlaceSuggestion,
} from "@/types/trip-plan";

const LEISURE_TYPE_ICONS: Record<LeisureType, LucideIcon> = {
  sightseeing: Camera,
  food: UtensilsCrossed,
  nature: Trees,
  nightlife: Moon,
  shopping: ShoppingBag,
  relaxation: Waves,
  adventure: Mountain,
  family: Users,
  mixed: Compass,
  umrah: Landmark,
};

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

function isSaudiArabiaDestination(trip: TripPlannerDoc): boolean {
  const id = trip.destination.countryId?.trim().toLowerCase();
  if (id === "sa" || id === "ksa") return true;
  if (resolveCountryCode(trip.destination.countryName) === "SA") return true;

  const country = trip.destination.countryName.trim().toLowerCase();
  if (country.includes("saudi") || country.includes("سعود")) return true;

  const city = `${trip.destination.cityId ?? ""} ${trip.destination.cityName}`
    .trim()
    .toLowerCase();
  return (
    /\b(makkah|mecca|madinah|medina|jeddah|riyadh)\b/.test(city) ||
    city.includes("مكة") ||
    city.includes("مدينة") ||
    city.includes("المدينة") ||
    city.includes("جدة") ||
    city.includes("الرياض")
  );
}

function toIsoDate(date: Date): string {
  const d = startOfUtcDay(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

  const days: PlanTripExistingDay[] = [];
  for (let i = 0; i < dayCount; i += 1) {
    const dayNumber = i + 1;
    const date = toIsoDate(addUtcDays(start, i));
    const existing = byDayNumber.get(dayNumber);
    const placeTitles =
      existing?.places
        .map((p) => byId.get(p.locationId)?.title)
        .filter((t): t is string => Boolean(t)) ?? [];

    days.push({
      day: dayNumber,
      date,
      title: existing?.title,
      placeTitles,
    });
  }
  return days;
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
  userId,
  trip,
  locations,
  aiCreditsBalance,
  language,
  onSaved,
}: PlanTripSheetProps) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [leisureType, setLeisureType] = useState<LeisureType>("mixed");
  const [result, setResult] = useState<PlanTripResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Bumps on close / new plan so in-flight photo fetches cannot overwrite state. */
  const photoEnrichGen = useRef(0);

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

  const isSaudiTrip = useMemo(
    () => isSaudiArabiaDestination(trip),
    [trip]
  );

  const leisureOptions = useMemo(() => {
    const base = LEISURE_TYPE_OPTIONS.filter((o) => o.value !== "umrah");
    if (!isSaudiTrip) return base;
    const umrah = LEISURE_TYPE_OPTIONS.find((o) => o.value === "umrah");
    return umrah ? [umrah, ...base] : base;
  }, [isSaudiTrip]);

  const remainingPlaceCount = useMemo(
    () => result?.days.reduce((sum, day) => sum + day.places.length, 0) ?? 0,
    [result]
  );

  const planCost = AI_CREDIT_COSTS.planTrip;
  const recreateCost = AI_CREDIT_COSTS.planTripRegenerate;

  useEffect(() => {
    if (!open) {
      photoEnrichGen.current += 1;
      setPhase("setup");
      setResult(null);
      setError(null);
      setSaving(false);
      setBusy(false);
      return;
    }
    setLeisureType(isSaudiTrip ? "umrah" : "mixed");
  }, [open, isSaudiTrip]);

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
          .filter((day) => day.places.length > 0),
      };
    });
  }

  async function runPlan(mode: "generate" | "regenerate") {
    if (emptyDayCount === 0) {
      setError("All days already have places. Clear a day first.");
      return;
    }

    const cost = mode === "regenerate" ? recreateCost : planCost;
    if (aiCreditsBalance < cost) {
      setError(
        `Not enough AI credits. Need ${cost}, you have ${aiCreditsBalance}.`
      );
      return;
    }

    setBusy(true);
    setError(null);
    if (mode === "generate") {
      setPhase("loading");
    }

    try {
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
    if (!result || remainingPlaceCount === 0) return;
    setSaving(true);
    setError(null);

    try {
      const createdIds: string[] = [];
      const suggestionByDay = new Map(
        result.days.map((d) => [d.day, d] as const)
      );

      // Create location docs for every remaining suggested place.
      const locationIdsByDay = new Map<number, string[]>();
      for (const day of result.days) {
        const ids: string[] = [];
        for (const place of day.places) {
          const hasAsciiCity = isAsciiId(place.cityId);
          const hasAsciiCountry =
            isAsciiId(place.countryId) ||
            isAsciiId(trip.destination.countryId);
          const englishIds =
            hasAsciiCity && hasAsciiCountry
              ? null
              : await resolveEnglishPlaceIds(place.lat, place.lon);
          const countryCode =
            place.countryCode?.trim() ||
            englishIds?.countryCode ||
            resolveCountryCode(place.countryName) ||
            undefined;
          const countryData = {
            id: isAsciiId(place.countryId)
              ? place.countryId!.trim().toLowerCase()
              : isAsciiId(trip.destination.countryId)
                ? trip.destination.countryId!.trim().toLowerCase()
                : countryIdFromParts(
                    englishIds?.countryNameEn || place.countryName,
                    countryCode
                  ),
            name: place.countryName,
          };
          const cityId = isAsciiId(place.cityId)
            ? place.cityId!.trim().toLowerCase()
            : isAsciiId(trip.destination.cityId) &&
                place.cityName.toLowerCase() ===
                  trip.destination.cityName.toLowerCase()
              ? trip.destination.cityId!.trim().toLowerCase()
              : englishIds?.cityId ||
                slugifyId(englishIds?.cityNameEn || place.cityName);
          const knownLocalityPlaceId = locations.find(
            (l) =>
              (l.city.id || "").toLowerCase() === cityId ||
              (l.city.name.toLowerCase() === place.cityName.toLowerCase() &&
                l.country.name.toLowerCase() ===
                  place.countryName.toLowerCase())
          )?.city.googlePlaceId;
          const cityData = await withCityGooglePlaceId(
            {
              id: cityId,
              name: place.cityName,
              ...(knownLocalityPlaceId
                ? { googlePlaceId: knownLocalityPlaceId }
                : {}),
            },
            countryData,
            { lat: place.lat, lon: place.lon }
          );

          const priceLabel =
            place.priceLabel?.trim() ||
            (place.priceAmount != null
              ? place.priceAmount === 0
                ? "Free"
                : `≈ ${place.priceAmount}${
                    place.priceCurrency ? ` ${place.priceCurrency}` : ""
                  }`
              : undefined);
          const hasPrice =
            place.priceAmount != null || Boolean(priceLabel);
          const linkUrl = place.link?.trim() || undefined;

          let imageUrl = place.imageUrl?.trim() || null;
          if (!imageUrl) {
            try {
              imageUrl = await fetchSuggestedPlacePhoto({
                title: place.title,
                cityName: place.cityName,
                countryName: place.countryName,
                lat: place.lat,
                lon: place.lon,
              });
            } catch {
              imageUrl = null;
            }
          }

          const locationId = await createUserLocation(userId, {
            title: place.title,
            description: place.description,
            lat: place.lat,
            lon: place.lon,
            country: countryData,
            city: cityData,
            status: "planned",
            category: place.category,
            ...(hasPrice
              ? {
                  price: {
                    ...(place.priceAmount != null
                      ? { amount: place.priceAmount }
                      : {}),
                    ...(place.priceCurrency
                      ? { currency: place.priceCurrency }
                      : {}),
                    ...(priceLabel ? { label: priceLabel } : {}),
                  },
                }
              : {}),
            ...(linkUrl
              ? {
                  links: [
                    {
                      url: linkUrl,
                      label:
                        place.category === "transport"
                          ? "Buy tickets"
                          : "Tickets / info",
                    },
                  ],
                }
              : {}),
            images: imageUrl
              ? [{ url: imageUrl, source: "external" }]
              : [],
            confidence: 0.75,
            ai: {
              why: place.why,
              model: result.model || "planTrip",
              processedAt: Timestamp.now(),
            },
            source: linkUrl
              ? { type: "link", url: linkUrl }
              : { type: "manual" },
          });
          ids.push(locationId);
          createdIds.push(locationId);
        }
        locationIdsByDay.set(day.day, ids);
      }

      const dayCount = tripDayCount(trip.startDate, trip.endDate);
      const start = startOfUtcDay(trip.startDate.toDate());
      const existingByDay = new Map(
        trip.itinerary.days.map((d) => [d.day, d])
      );

      const mergedDays: ItineraryDay[] = [];
      for (let i = 0; i < dayCount; i += 1) {
        const dayNumber = i + 1;
        const date = Timestamp.fromDate(addUtcDays(start, i));
        const existing = existingByDay.get(dayNumber);
        const suggestion = suggestionByDay.get(dayNumber);
        const newIds = locationIdsByDay.get(dayNumber) ?? [];

        if (existing && existing.places.length > 0) {
          mergedDays.push({
            ...existing,
            day: dayNumber,
            date,
          });
          continue;
        }

        if (suggestion && newIds.length > 0) {
          mergedDays.push({
            day: dayNumber,
            date,
            title: suggestion.title,
            description: suggestion.description,
            places: newIds.map((locationId, order) => ({
              locationId,
              order,
              status: "planned" as const,
            })),
          });
          continue;
        }

        if (existing) {
          mergedDays.push({
            ...existing,
            day: dayNumber,
            date,
          });
        } else {
          mergedDays.push({
            day: dayNumber,
            date,
            title: `Day ${dayNumber}`,
            places: [],
          });
        }
      }

      const nextIds = Array.from(
        new Set([...trip.savedPlaceIds, ...createdIds])
      );

      await onSaved({
        savedPlaceIds: nextIds,
        itinerary: {
          status: "generated",
          days: mergedDays.filter((d) => d.places.length > 0),
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
          <div className="flex items-center gap-3 rounded-2xl bg-primary-tint px-3.5 py-3">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-text-secondary">
                AI Credits
              </p>
              <p className="mt-1 text-sm font-semibold tabular-nums text-text">
                {aiCreditsBalance}
                <span className="font-medium text-text-secondary">
                  {" "}
                  available
                </span>
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-primary-light/35 px-3 py-1.5 text-xs font-semibold text-primary">
              {planCost} credits
            </span>
          </div>

          <div>
            <p className="text-sm font-medium text-text">
              {isSaudiTrip ? "Type of plan" : "Type of leisure"}
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              {leisureType === "umrah" ? (
                <>
                  We&apos;ll fill {emptyDayCount} empty{" "}
                  {emptyDayCount === 1 ? "day" : "days"} with an Umrah plan
                  across Makkah and Madinah — including the Prophet&apos;s
                  Mosque, ziyarat, and train or bus between cities.
                </>
              ) : (
                <>
                  We&apos;ll fill {emptyDayCount} empty{" "}
                  {emptyDayCount === 1 ? "day" : "days"} in{" "}
                  {trip.destination.cityName} with matching places.
                </>
              )}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {leisureOptions.map((option) => {
                const selected = leisureType === option.value;
                const Icon = LEISURE_TYPE_ICONS[option.value];
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setLeisureType(option.value)}
                    className={cx(
                      "flex items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
                      selected
                        ? "border-primary bg-primary-tint"
                        : "border-border hover:border-primary/30"
                    )}
                  >
                    <span
                      className={cx(
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                        selected
                          ? "bg-primary text-white"
                          : "bg-surface text-text-secondary"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-text">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-text-secondary">
                        {option.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
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
            Generate itinerary ({planCost} AI credits)
          </Button>
        </div>
      ) : null}

      {phase === "loading" ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-text">
            Finding places for your empty days…
          </p>
          <p className="max-w-xs text-sm text-text-secondary">
            {leisureType === "umrah"
              ? "Building an Umrah itinerary for Makkah and Madinah with ziyarat and train or bus links."
              : `Matching ${
                  LEISURE_TYPE_OPTIONS.find((o) => o.value === leisureType)
                    ?.label.toLowerCase() ?? "places"
                } in ${trip.destination.cityName}.`}
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
              . Remove the places you don&apos;t like, then save — or recreate
              for {recreateCost} more AI credits.
            </p>
          </div>

          {remainingPlaceCount === 0 ? (
            <p className="rounded-xl bg-surface px-4 py-6 text-center text-sm text-text-secondary">
              All suggested places were removed. Recreate to get a new plan.
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
              disabled={busy || remainingPlaceCount === 0}
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
