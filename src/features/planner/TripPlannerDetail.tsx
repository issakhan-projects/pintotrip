"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ImageIcon,
  Loader2,
  MapPin,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import type { User } from "firebase/auth";
import { Timestamp } from "firebase/firestore";
import { useTrip } from "@/hooks/useTrip";
import { useLocations } from "@/hooks/useLocations";
import { useUserProfile } from "@/hooks/useUserProfile";
import { getCityIntelligence } from "@/services/functions";
import { deleteTrip } from "@/services/trip-planner";
import {
  formatInsufficientCreditsMessage,
  isInsufficientAICreditsError,
} from "@/types/credits";
import type {
  TripItinerary,
  TripPlannerStep,
} from "@/types/trip-planner";
import type { LocationStatus } from "@/types/location";
import { tripDayCount } from "@/services/trip-planner";
import { Button, ConfirmModal } from "@/components/ui";
import { getPublicEnv } from "@/lib/env";
import { cx } from "@/lib/utils";
import {
  formatTripHeroDates,
  overallTripProgress,
  placesProgress,
  preparationProgress,
  tripChecklistProgress,
} from "./tripUtils";
import { TripStepNav } from "./TripStepNav";
import { TripDetailsStep } from "./TripDetailsStep";
import { BeforeYouGoStep } from "./BeforeYouGoStep";
import { PlacesStep } from "./PlacesStep";
import { EditTripSheet } from "./EditTripSheet";

interface TripPlannerDetailProps {
  user: User;
  tripId: string;
}

function parseStep(value: string | null): TripPlannerStep {
  if (value === "details" || value === "preparation" || value === "places") {
    return value;
  }
  return "details";
}

function destinationStaticMapUrl(
  lat: number,
  lon: number,
  size = "1200x560"
): string | null {
  const key = getPublicEnv().googleMaps.apiKey;
  if (!key) return null;
  const params = new URLSearchParams({
    center: `${lat},${lon}`,
    zoom: "12",
    size,
    scale: "2",
    maptype: "roadmap",
    markers: `color:0x6D28D9|${lat},${lon}`,
    key,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

export function TripPlannerDetail({ user, tripId }: TripPlannerDetailProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { trip, loading, error, patchTrip, setTrip } = useTrip(
    tripId,
    user.uid
  );
  const { locations, patchLocation, refresh: refreshLocations } =
    useLocations(user.uid);
  const { profile } = useUserProfile(user);

  const [step, setStep] = useState<TripPlannerStep>(() =>
    searchParams.get("new") === "1"
      ? "preparation"
      : parseStep(searchParams.get("step"))
  );
  const [intelBusy, setIntelBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [coverIndex, setCoverIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const fetchCityIntelligence = useCallback(async () => {
    if (!trip || intelBusy) return;
    const { destination } = trip;
    if (
      destination.lat == null ||
      destination.lon == null ||
      !destination.cityName
    ) {
      await patchTrip({
        cityIntelligence: {
          status: "error",
          errorMessage: "Destination coordinates are missing.",
          lastUpdatedAt: Timestamp.now(),
        },
      });
      return;
    }

    setIntelBusy(true);
    await patchTrip({
      cityIntelligence: {
        ...trip.cityIntelligence,
        status: "loading",
      },
    });

    try {
      const result = await getCityIntelligence({
        city: destination.cityName,
        country: destination.countryName,
        lat: destination.lat,
        lon: destination.lon,
        userCountry: profile?.citizenship || trip.from.countryName,
        userCurrency: trip.currency.code || profile?.currency,
        language: profile?.preferences?.language,
      });

      await patchTrip({
        cityIntelligence: {
          status: "ready",
          result,
          lastUpdatedAt: Timestamp.now(),
        },
      });
    } catch (err) {
      let message = "Failed to load city information.";
      if (isInsufficientAICreditsError(err)) {
        message = formatInsufficientCreditsMessage(err);
      } else if (err instanceof Error && err.message) {
        message = err.message;
      }
      await patchTrip({
        cityIntelligence: {
          status: "error",
          errorMessage: message,
          lastUpdatedAt: Timestamp.now(),
        },
      });
    } finally {
      setIntelBusy(false);
    }
  }, [trip, intelBusy, patchTrip, profile]);

  useEffect(() => {
    if (!trip) return;
    if (trip.cityIntelligence.status !== "pending") return;
    const timer = window.setTimeout(() => {
      void fetchCityIntelligence();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when pending for this trip
  }, [trip?.id, trip?.cityIntelligence.status]);

  const completed = useMemo(
    () => ({
      details: true,
      preparation:
        trip != null &&
        trip.preparation.items.length > 0 &&
        trip.preparation.items.every((i) => i.completed),
      places:
        trip != null &&
        trip.savedPlaceIds.length > 0 &&
        placesProgress(trip, locations).percent === 100,
    }),
    [trip, locations]
  );

  const coverCandidates = useMemo(() => {
    if (!trip) return [] as string[];
    const urls: string[] = [];
    const seen = new Set<string>();

    const push = (url?: string) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      urls.push(url);
    };

    trip.destination.photos?.forEach((url) => push(url));

    const byId = new Map(locations.map((l) => [l.id, l]));
    for (const id of trip.savedPlaceIds) {
      const place = byId.get(id);
      place?.images.forEach((img) => push(img.url));
    }

    const destCity = trip.destination.cityName?.toLowerCase();
    const destCountry = trip.destination.countryName?.toLowerCase();
    for (const place of locations) {
      if (
        destCity &&
        place.city.name.toLowerCase() === destCity &&
        (!destCountry || place.country.name.toLowerCase() === destCountry)
      ) {
        place.images.forEach((img) => push(img.url));
      }
    }

    if (trip.destination.lat != null && trip.destination.lon != null) {
      push(
        destinationStaticMapUrl(trip.destination.lat, trip.destination.lon) ??
          undefined
      );
    }

    return urls;
  }, [trip, locations]);

  const galleryImages = useMemo(() => {
    return coverCandidates.filter(
      (url) => !url.includes("maps.googleapis.com")
    );
  }, [coverCandidates]);

  useEffect(() => {
    setCoverIndex(0);
  }, [trip?.id]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  async function togglePrepItem(itemId: string, completedFlag: boolean) {
    if (!trip) return;
    const items = trip.preparation.items.map((item) =>
      item.id === itemId ? { ...item, completed: completedFlag } : item
    );
    setTrip({
      ...trip,
      preparation: { items },
    });
    await patchTrip({ preparation: { items } });
  }

  async function addPrepItem(title: string) {
    if (!trip) return;
    const maxOrder = trip.preparation.items.reduce(
      (max, item) => Math.max(max, item.order),
      -1
    );
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `prep_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const items = [
      ...trip.preparation.items,
      {
        id,
        title,
        completed: false,
        category: "other" as const,
        order: maxOrder + 1,
      },
    ];
    setTrip({
      ...trip,
      preparation: { items },
    });
    await patchTrip({ preparation: { items } });
  }

  async function handleDelete() {
    if (!trip) return;
    setDeleting(true);
    setMenuOpen(false);
    try {
      await deleteTrip(user.uid, trip.id);
      router.push("/map?tab=planner");
    } finally {
      setDeleting(false);
      setConfirmDeleteOpen(false);
    }
  }

  function openEditTrip() {
    setMenuOpen(false);
    setStep("details");
    setEditOpen(true);
  }

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center bg-surface">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </main>
    );
  }

  if (error || !trip) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-surface px-6 text-center">
        <p className="text-sm text-error">{error ?? "Trip not found."}</p>
        <button
          type="button"
          className="text-sm font-medium text-primary underline"
          onClick={() => router.push("/map?tab=planner")}
        >
          Back to Trips
        </button>
      </main>
    );
  }

  const days = tripDayCount(trip.startDate, trip.endDate);
  const overall = overallTripProgress(trip, locations);
  const places = placesProgress(trip, locations);
  const prep = preparationProgress(trip.preparation.items);
  const checklist = tripChecklistProgress(trip, locations);
  const destLabel = [trip.destination.cityName, trip.destination.countryName]
    .filter(Boolean)
    .join(", ");
  const coverUrl =
    coverCandidates[
      Math.min(coverIndex, Math.max(coverCandidates.length - 1, 0))
    ] ?? null;

  return (
    <main className="relative flex min-h-0 flex-1 flex-col bg-surface">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-10 pt-4 sm:px-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => router.push("/map?tab=planner")}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Trips
          </button>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              icon={Pencil}
              className="!h-9 !rounded-lg !px-3 !text-[13px]"
              onClick={openEditTrip}
            >
              Edit trip
            </Button>
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                aria-label="Trip options"
                onClick={() => setMenuOpen((v) => !v)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-elevated text-text-secondary shadow-sm hover:bg-surface hover:text-text"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menuOpen ? (
                <div className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-xl border border-border bg-surface-elevated py-1 shadow-lg">
                  <button
                    type="button"
                    disabled={deleting}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-error hover:bg-error-background disabled:opacity-50"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmDeleteOpen(true);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete trip
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <section className="relative overflow-hidden rounded-2xl bg-text shadow-sm">
          <div className="relative aspect-[21/9] min-h-[200px] w-full sm:min-h-[240px]">
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- remote cover / static map URLs vary
              <img
                src={coverUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary-light to-primary-hover" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-black/10" />

            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-4 sm:p-6">
              <div className="min-w-0 text-white">
                <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
                  {trip.name}
                </h1>
                <p className="mt-1 text-sm text-white/90 sm:text-[15px]">
                  {formatTripHeroDates(trip.startDate, trip.endDate)}
                  <span className="mx-1.5 text-white/50">•</span>
                  {days} day{days === 1 ? "" : "s"}
                </p>
                <p className="mt-1.5 flex items-center gap-1.5 text-sm text-white/85">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{destLabel}</span>
                </p>
              </div>

              {coverCandidates.length > 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    setCoverIndex((i) => (i + 1) % coverCandidates.length)
                  }
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-black/45 px-3 py-2 text-xs font-medium text-white backdrop-blur-sm hover:bg-black/55"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  Change cover
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-text">
                  Trip progress
                </span>
                <span className="text-lg font-semibold tabular-nums text-text">
                  {overall}%
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${overall}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-text-secondary">
                {checklist.total > 0
                  ? `${checklist.completed} of ${checklist.total} completed`
                  : "Trip details ready — continue with preparation"}
              </p>
            </div>

            <div className={cx("w-full lg:max-w-xl lg:flex-[1.35]")}>
              <TripStepNav
                active={step}
                completed={completed}
                onChange={setStep}
                progress={{
                  preparation: {
                    completed: prep.completed,
                    total: prep.total,
                  },
                  places: {
                    completed: places.visited,
                    total: places.total,
                  },
                }}
              />
            </div>
          </div>
        </section>

        <div className="mt-6 min-h-0 flex-1 pb-4">
          {step === "details" ? (
            <TripDetailsStep
              trip={trip}
              galleryImages={galleryImages}
              onEdit={openEditTrip}
              onRetryCityIntelligence={() => void fetchCityIntelligence()}
              onGoToPreparation={() => setStep("preparation")}
              onGoToPlaces={() => setStep("places")}
            />
          ) : null}

          {step === "preparation" ? (
            <BeforeYouGoStep
              trip={trip}
              onToggleItem={(id, value) => void togglePrepItem(id, value)}
              onAddItem={(title) => void addPrepItem(title)}
              onGoToDetails={() => setStep("details")}
              onGoToPlaces={() => setStep("places")}
              onViewGuide={() => setStep("details")}
            />
          ) : null}

          {step === "places" ? (
            <PlacesStep
              trip={trip}
              locations={locations}
              userId={user.uid}
              aiCreditsBalance={profile?.aiCreditsBalance ?? 0}
              language={profile?.preferences?.language}
              onUpdateSavedPlaces={async (ids) => {
                await patchTrip({ savedPlaceIds: ids });
              }}
              onUpdateItinerary={async (itinerary: TripItinerary) => {
                await patchTrip({ itinerary });
              }}
              onSavePlan={async ({ savedPlaceIds, itinerary }) => {
                await patchTrip({ savedPlaceIds, itinerary });
                await refreshLocations();
              }}
              onMarkPlaceStatus={async (locationId, status: LocationStatus) => {
                await patchLocation(locationId, { status });
                if (trip.itinerary.days.length > 0) {
                  const nextDays = trip.itinerary.days.map((day) => ({
                    ...day,
                    places: day.places.map((p) =>
                      p.locationId === locationId ? { ...p, status } : p
                    ),
                  }));
                  await patchTrip({
                    itinerary: {
                      status:
                        trip.itinerary.status === "empty"
                          ? "edited"
                          : trip.itinerary.status,
                      days: nextDays,
                    },
                  });
                }
              }}
              onSavePlaceNote={async (locationId, note) => {
                await patchLocation(locationId, { note });
              }}
            />
          ) : null}
        </div>
      </div>

      <EditTripSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        trip={trip}
        onSave={async (input) => {
          await patchTrip(input);
        }}
      />

      <ConfirmModal
        open={confirmDeleteOpen}
        title="Delete this trip?"
        description="This removes the trip and its itinerary. This can’t be undone."
        confirmLabel="Delete"
        cancelLabel="Keep"
        tone="danger"
        loading={deleting}
        onCancel={() => {
          if (!deleting) setConfirmDeleteOpen(false);
        }}
        onConfirm={() => void handleDelete()}
      />
    </main>
  );
}
