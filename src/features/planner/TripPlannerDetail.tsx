"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BedDouble,
  CalendarDays,
  ChevronDown,
  ImageIcon,
  Link2,
  Loader2,
  MoreHorizontal,
  Search,
  Sparkles,
  Trash2,
  Upload,
  WifiOff,
} from "lucide-react";
import type { User } from "firebase/auth";
import { Timestamp } from "firebase/firestore";
import { useTrip } from "@/hooks/useTrip";
import { useLocations } from "@/hooks/useLocations";
import { useUserProfile } from "@/hooks/useUserProfile";
import {
  canUsePlaceNameSearch,
  isProEntitled,
} from "@/features/profile/plans";
import { getCityIntelligence } from "@/services/functions";
import { deleteTrip } from "@/services/trip-planner";
import { subscribeTripRoutes } from "@/services/trip-routes";
import { getTripReview } from "@/services/trip-reviews";
import { uploadTripCover } from "@/services/storage";
import {
  IMAGE_FILE_ACCEPT,
  imageUploadErrorMessage,
  prepareClientImage,
  storageImageCompressOptions,
} from "@/lib/images";
import {
  formatInsufficientCreditsMessage,
  isInsufficientAICreditsError,
} from "@/types/credits";
import type {
  PreparationItem,
  TripItinerary,
  TripPlannerDoc,
  TripPlannerStep,
  TripRoute,
} from "@/types/trip-planner";
import type { LocationImage, LocationStatus } from "@/types/location";
import { tripDayCount } from "@/services/trip-planner";
import { Button, DeleteConfirmModal, TextInput } from "@/components/ui";
import { getPublicEnv } from "@/lib/env";
import { resetBodyScrollLock } from "@/lib/bodyScrollLock";
import {
  tripDetailKey,
  tripDetailStore,
} from "@/lib/firebase/data-cache";
import { cx } from "@/lib/utils";
import { isBrowserOffline } from "@/lib/planner/offline-store";
import {
  formatTripSummaryDates,
  formatTripSummaryDatesWithWeekday,
  overallTripProgress,
  placesProgress,
  preparationProgress,
  routesProgress,
  tripChecklistProgress,
} from "./tripUtils";
import { newCustomPreparationId } from "./buildPreparation";
import { listTripDestinations, primaryTripDestination } from "./tripDestinations";
import { parseHttpUrl } from "./preparationLinks";
import { TripStepNav } from "./TripStepNav";
import { TripDetailsStep } from "./TripDetailsStep";
import { BeforeYouGoStep } from "./BeforeYouGoStep";
import { PlacesStep } from "./PlacesStep";
import { RoutesStep } from "./RoutesStep";
import { EditTripSheet } from "./EditTripSheet";
import { TripReviewModal } from "./TripReviewModal";
import {
  needsCompletedStatus,
  needsTripReviewPrompt,
} from "./tripLifecycle";
import { LEISURE_TYPE_OPTIONS } from "@/types/trip-plan";
import { useI18n } from "@/i18n";

interface TripPlannerDetailProps {
  user: User;
  tripId: string;
}

function useOfflineBanner(): boolean {
  const [offline, setOffline] = useState(() => isBrowserOffline());

  useEffect(() => {
    const sync = () => setOffline(isBrowserOffline());
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    sync();
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return offline;
}

function parseStep(value: string | null): TripPlannerStep {
  if (
    value === "details" ||
    value === "preparation" ||
    value === "routes" ||
    value === "places"
  ) {
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
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const offline = useOfflineBanner();
  const { trip, loading, error, patchTrip, setTrip } = useTrip(
    tripId,
    user.uid
  );
  const { locations, patchLocation, refresh: refreshLocations } =
    useLocations(user.uid);
  const { profile } = useUserProfile(user);

  const [tripRoutes, setTripRoutes] = useState<TripRoute[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewHandledRef = useRef(false);
  const [step, setStep] = useState<TripPlannerStep>(() =>
    searchParams.get("new") === "1"
      ? "preparation"
      : parseStep(searchParams.get("step"))
  );
  const [intelBusy, setIntelBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [coverMenuOpen, setCoverMenuOpen] = useState(false);
  const [coverLinkOpen, setCoverLinkOpen] = useState(false);
  const [coverLinkDraft, setCoverLinkDraft] = useState("");
  const [coverIndex, setCoverIndex] = useState(0);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverUploadError, setCoverUploadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const coverFileRef = useRef<HTMLInputElement>(null);

  // Clear a stuck body scroll lock left by nested Sheet/Modal restores.
  useEffect(() => {
    resetBodyScrollLock();
  }, [tripId]);

  useEffect(() => {
    reviewHandledRef.current = false;
    setReviewOpen(false);
  }, [tripId]);

  useEffect(() => {
    if (!tripId) {
      setTripRoutes([]);
      return;
    }
    return subscribeTripRoutes(user.uid, tripId, setTripRoutes);
  }, [user.uid, tripId]);

  // Flip ended trips to completed, then offer the planning review.
  useEffect(() => {
    if (!trip || reviewHandledRef.current) return;

    let cancelled = false;

    void (async () => {
      let current = trip;

      if (needsCompletedStatus(current)) {
        try {
          await patchTrip({ status: "completed" });
          if (cancelled) return;
          current = { ...current, status: "completed" };
          setTrip(current);
        } catch {
          return;
        }
      }

      if (!needsTripReviewPrompt(current)) {
        reviewHandledRef.current = true;
        return;
      }

      try {
        const existing = await getTripReview(user.uid, current.id);
        if (cancelled) return;
        reviewHandledRef.current = true;
        if (existing) return;
        setReviewOpen(true);
      } catch {
        // Ignore review lookup failures; allow a later retry.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [trip, user.uid, patchTrip, setTrip]);

  async function dismissTripReview() {
    reviewHandledRef.current = true;
    setReviewOpen(false);
    try {
      await patchTrip({ reviewDismissedAt: Timestamp.now() });
    } catch {
      // Keep closed even if dismiss write fails.
    }
  }

  function closeCoverMenu() {
    setCoverMenuOpen(false);
    setCoverLinkOpen(false);
    setCoverLinkDraft("");
  }

  /** Mark a saved location visited/planned and mirror status onto itinerary slots. */
  async function markPlaceStatus(
    locationId: string,
    status: LocationStatus
  ) {
    await patchLocation(locationId, { status });

    const latest =
      tripDetailStore.get(tripDetailKey(user.uid, tripId)) ?? trip;
    if (!latest || latest.itinerary.days.length === 0) return;

    if (status === "cancelled") {
      const days = latest.itinerary.days.map((day) => ({
        ...day,
        places: day.places
          .filter((p) => p.locationId !== locationId)
          .map((p, order) => ({ ...p, order })),
      }));
      await patchTrip({
        itinerary: { status: "edited", days },
      });
      return;
    }

    const nextDays = latest.itinerary.days.map((day) => ({
      ...day,
      places: day.places.map((p) =>
        p.locationId === locationId ? { ...p, status } : p
      ),
    }));
    await patchTrip({
      itinerary: {
        status:
          latest.itinerary.status === "empty"
            ? "edited"
            : latest.itinerary.status,
        days: nextDays,
      },
    });
  }

  const fetchCityIntelligence = useCallback(async () => {
    if (!trip || intelBusy) return;
    const destinations = listTripDestinations(trip).filter(
      (d) =>
        Boolean(d.cityName?.trim()) &&
        typeof d.lat === "number" &&
        typeof d.lon === "number"
    );
    if (destinations.length === 0) {
      await patchTrip({
        cityIntelligence: {
          status: "error",
          errorMessage: t("planner.detail.coordsMissing"),
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
      const batch = await getCityIntelligence({
        cities: destinations.map((d) => ({
          city: d.cityName,
          country: d.countryName,
          lat: d.lat!,
          lon: d.lon!,
          cityId: d.cityId,
          countryId: d.countryId,
        })),
        userCountry: profile?.citizenship || trip.from.countryName,
        userCurrency: trip.currency.code || profile?.currency,
        language: profile?.preferences?.language,
      });

      await patchTrip({
        cityIntelligence: {
          status: "ready",
          results: batch.results,
          lastUpdatedAt: Timestamp.now(),
        },
      });
    } catch (err) {
      let message = t("planner.detail.cityInfoFailed");
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
  }, [trip, intelBusy, patchTrip, profile, t]);

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
    () => {
      const places = trip ? placesProgress(trip, locations) : null;
      const routes = routesProgress(tripRoutes);
      return {
        details: true,
        preparation:
          trip != null &&
          trip.preparation.items.length > 0 &&
          trip.preparation.items.every((i) => i.completed),
        routes: routes.total > 0 && routes.percent === 100,
        places: places != null && places.total > 0 && places.percent === 100,
      };
    },
    [trip, locations, tripRoutes]
  );

  const coverCandidates = useMemo(() => {
    if (!trip) return [] as string[];
    const urls: string[] = [];
    const seen = new Set<string>();
    const primary = primaryTripDestination(trip);

    const push = (url?: string) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      urls.push(url);
    };

    push(trip.photoUrl);
    primary.photos?.forEach((url) => push(url));

    const byId = new Map(locations.map((l) => [l.id, l]));
    for (const id of trip.savedPlaceIds) {
      const place = byId.get(id);
      place?.images.forEach((img) => push(img.url));
    }

    const destCity = primary.cityName?.toLowerCase();
    const destCountry = primary.countryName?.toLowerCase();
    for (const place of locations) {
      if (
        destCity &&
        place.city.name.toLowerCase() === destCity &&
        (!destCountry || place.country.name.toLowerCase() === destCountry)
      ) {
        place.images.forEach((img) => push(img.url));
      }
    }

    if (primary.lat != null && primary.lon != null) {
      push(destinationStaticMapUrl(primary.lat, primary.lon) ?? undefined);
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

  useEffect(() => {
    if (!coverMenuOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        closeCoverMenu();
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [coverMenuOpen]);

  async function handleCoverFileChange(file: File | undefined) {
    if (!file || !trip) return;
    setCoverUploading(true);
    setCoverUploadError(null);
    closeCoverMenu();
    try {
      const prepared = await prepareClientImage(
        file,
        storageImageCompressOptions({
          maxSides: [1920, 1600, 1280, 1024, 800, 640],
          qualities: [0.82, 0.7, 0.55, 0.42, 0.32],
        })
      );
      const url = await uploadTripCover(user.uid, trip.id, prepared.blob, {
        contentType: "image/jpeg",
      });
      await patchTrip({ photoUrl: url });
      setCoverIndex(0);
    } catch (err) {
      setCoverUploadError(imageUploadErrorMessage(err));
    } finally {
      setCoverUploading(false);
      if (coverFileRef.current) coverFileRef.current.value = "";
    }
  }

  async function handleCoverLinkSubmit() {
    if (!trip) return;
    const url = parseHttpUrl(coverLinkDraft);
    if (!url) {
      setCoverUploadError(t("planner.detail.imageLinkInvalid"));
      return;
    }
    setCoverUploading(true);
    setCoverUploadError(null);
    try {
      await patchTrip({ photoUrl: url });
      setCoverIndex(0);
      closeCoverMenu();
    } catch (err) {
      setCoverUploadError(
        err instanceof Error ? err.message : t("planner.detail.imageLinkInvalid")
      );
    } finally {
      setCoverUploading(false);
    }
  }

  async function togglePrepItem(itemId: string, completedFlag: boolean) {
    if (!trip) return;
    const items = trip.preparation.items.map((item) =>
      item.id === itemId ? { ...item, completed: completedFlag } : item
    );
    setTrip({
      ...trip,
      preparation: { ...trip.preparation, items },
    });
    await patchTrip({ preparation: { ...trip.preparation, items } });
  }

  async function addPrepItem(title: string, link?: string) {
    if (!trip) return;
    const maxOrder = trip.preparation.items.reduce(
      (max, item) => Math.max(max, item.order),
      -1
    );
    const items = [
      ...trip.preparation.items,
      {
        id: newCustomPreparationId(),
        title,
        completed: false,
        category: "other" as const,
        order: maxOrder + 1,
        ...(link ? { link, linkLabel: t("common.openLink") } : {}),
      },
    ];
    setTrip({
      ...trip,
      preparation: { ...trip.preparation, items },
    });
    await patchTrip({ preparation: { ...trip.preparation, items } });
  }

  async function deletePrepItem(itemId: string) {
    if (!trip) return;
    const items = trip.preparation.items.filter((item) => item.id !== itemId);
    setTrip({
      ...trip,
      preparation: { ...trip.preparation, items },
    });
    await patchTrip({ preparation: { ...trip.preparation, items } });
  }

  async function syncPrepItems(items: PreparationItem[]) {
    if (!trip) return;
    setTrip({
      ...trip,
      preparation: { ...trip.preparation, items },
    });
    await patchTrip({ preparation: { ...trip.preparation, items } });
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
        <p className="text-sm text-error">
          {error ?? t("planner.detail.notFound")}
        </p>
        <button
          type="button"
          className="text-sm font-medium text-primary underline"
          onClick={() => router.push("/map?tab=planner")}
        >
          {t("planner.detail.backToTrips")}
        </button>
      </main>
    );
  }

  const days = tripDayCount(trip.startDate, trip.endDate);
  const nights = Math.max(0, days - 1);
  const overall = overallTripProgress(trip, locations);
  const places = placesProgress(trip, locations);
  const routes = routesProgress(tripRoutes);
  const prep = preparationProgress(trip.preparation.items);
  const checklist = tripChecklistProgress(trip, locations);
  const primaryDest = primaryTripDestination(trip);
  const cityLabel = primaryDest.cityName?.trim() || trip.name;
  const leisureLabel =
    trip.leisureType === "custom"
      ? trip.leisureCustom?.trim() || t("planner.detail.summary.styleFallback")
      : LEISURE_TYPE_OPTIONS.find((o) => o.value === trip.leisureType)?.label ??
        t("planner.detail.summary.styleFallback");
  return (
    <main className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain">
      {offline ? (
        <div
          role="status"
          className="sticky top-0 z-30 border-b border-warning/30 bg-warning-background px-4 py-2.5 text-center sm:px-6"
        >
          <p className="inline-flex items-center justify-center gap-2 text-sm font-medium text-warning">
            <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
            {t("planner.detail.offline")}
          </p>
        </div>
      ) : null}
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-10 pt-4 sm:px-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => router.push("/map?tab=planner")}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("planner.detail.backToTrips")}
          </button>

          <div className="relative" ref={menuRef}>
            <input
              ref={coverFileRef}
              type="file"
              accept={IMAGE_FILE_ACCEPT}
              className="sr-only"
              onChange={(e) =>
                void handleCoverFileChange(e.target.files?.[0])
              }
            />
            <button
              type="button"
              aria-label={t("trip.optionsAria")}
              onClick={() => {
                setMenuOpen((v) => !v);
                if (coverMenuOpen) closeCoverMenu();
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-elevated text-text-secondary shadow-sm hover:bg-surface hover:text-text"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen ? (
              <div className="absolute right-0 z-20 mt-1 min-w-[12rem] rounded-xl border border-border bg-surface-elevated py-1 shadow-lg">
                <button
                  type="button"
                  disabled={coverUploading}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-surface disabled:opacity-50"
                  onClick={() => {
                    setMenuOpen(false);
                    coverFileRef.current?.click();
                  }}
                >
                  {coverUploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  {t("planner.detail.uploadPhoto")}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-surface"
                  onClick={() => {
                    setMenuOpen(false);
                    setCoverMenuOpen(true);
                    setCoverLinkOpen(true);
                    setCoverUploadError(null);
                  }}
                >
                  <Link2 className="h-3.5 w-3.5" />
                  {t("planner.detail.addImageLink")}
                </button>
                {coverCandidates.length > 1 ? (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-surface"
                    onClick={() => {
                      setCoverIndex((i) => (i + 1) % coverCandidates.length);
                      setMenuOpen(false);
                    }}
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                    {t("planner.detail.nextPhoto")}
                  </button>
                ) : null}
                <div className="my-1 border-t border-border" />
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
                  {t("trip.delete")}
                </button>
              </div>
            ) : null}
            {coverMenuOpen && coverLinkOpen ? (
              <form
                className="absolute right-0 z-20 mt-1 flex w-[min(18rem,calc(100vw-2rem))] flex-col gap-2 rounded-xl border border-border bg-surface-elevated p-3 shadow-lg"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleCoverLinkSubmit();
                }}
              >
                <label
                  htmlFor="trip-cover-image-link"
                  className="text-xs font-medium text-text-secondary"
                >
                  {t("planner.detail.addImageLink")}
                </label>
                <TextInput
                  id="trip-cover-image-link"
                  type="url"
                  value={coverLinkDraft}
                  onChange={(e) => {
                    setCoverLinkDraft(e.target.value);
                    if (coverUploadError) setCoverUploadError(null);
                  }}
                  placeholder={t("planner.detail.imageLinkPlaceholder")}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    color="primary"
                    disabled={coverUploading || !coverLinkDraft.trim()}
                    className="!h-8 !flex-1 !rounded-lg !px-2 !text-xs"
                  >
                    {t("common.save")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={coverUploading}
                    className="!h-8 !rounded-lg !px-2 !text-xs"
                    onClick={closeCoverMenu}
                  >
                    {t("common.cancel")}
                  </Button>
                </div>
                {coverUploadError ? (
                  <p className="text-[11px] text-error">{coverUploadError}</p>
                ) : null}
              </form>
            ) : null}
          </div>
        </div>

        {/* Mobile: compact trip summary bar. */}
        <button
          type="button"
          onClick={openEditTrip}
          className="flex w-full items-center gap-3 rounded-xl border-[3px] border-accent bg-surface-elevated px-3.5 py-3 text-left shadow-sm sm:hidden"
          aria-label={t("trip.edit")}
        >
          <Search className="h-5 w-5 shrink-0 text-text" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold leading-tight text-text">
              {cityLabel}
            </span>
            <span className="mt-0.5 block truncate text-[13px] leading-snug text-text-secondary">
              {formatTripSummaryDates(trip.startDate, trip.endDate)}
              {" ("}
              {t(nights === 1 ? "common.night_one" : "common.night_other", {
                count: nights,
              })}
              {")"}
            </span>
          </span>
        </button>

        {/* Desktop: multi-field trip summary bar. */}
        <div className="hidden rounded-xl border-[3px] border-accent bg-surface-elevated p-1.5 shadow-sm sm:block">
          <div className="flex min-h-[4.5rem] items-stretch gap-0">
            <button
              type="button"
              onClick={openEditTrip}
              className="flex min-w-0 flex-[1.1] items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface"
            >
              <BedDouble
                className="h-5 w-5 shrink-0 text-text-secondary"
                aria-hidden
              />
              <span className="min-w-0">
                <span className="block truncate text-xs text-text-secondary">
                  {t("planner.detail.summary.whereLabel")}
                </span>
                <span className="mt-0.5 block truncate text-sm font-semibold text-text">
                  {cityLabel}
                </span>
              </span>
            </button>

            <div className="my-2 w-px shrink-0 bg-border" aria-hidden />

            <button
              type="button"
              onClick={openEditTrip}
              className="flex min-w-0 flex-[1.2] items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface"
            >
              <CalendarDays
                className="h-5 w-5 shrink-0 text-text-secondary"
                aria-hidden
              />
              <span className="min-w-0">
                <span className="block truncate text-xs text-text-secondary">
                  {t("planner.detail.summary.datesLabel")}
                </span>
                <span className="mt-0.5 block truncate text-sm font-semibold text-text">
                  {formatTripSummaryDatesWithWeekday(
                    trip.startDate,
                    trip.endDate
                  )}
                </span>
              </span>
            </button>

            <div className="my-2 w-px shrink-0 bg-border" aria-hidden />

            <button
              type="button"
              onClick={openEditTrip}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface"
            >
              <Sparkles
                className="h-5 w-5 shrink-0 text-text-secondary"
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-text-secondary">
                  {t("planner.detail.summary.styleLabel")}
                </span>
                <span className="mt-0.5 block truncate text-sm font-semibold text-text">
                  {leisureLabel}
                  <span className="font-normal text-text-secondary">
                    {" · "}
                    {t(nights === 1 ? "common.night_one" : "common.night_other", {
                      count: nights,
                    })}
                  </span>
                </span>
              </span>
              <ChevronDown
                className="h-4 w-4 shrink-0 text-text-muted"
                aria-hidden
              />
            </button>

            <Button
              type="button"
              color="primary"
              onClick={openEditTrip}
              className="!ml-1 !h-auto !min-h-[3.25rem] !shrink-0 !self-center !rounded-lg !px-6 !text-sm !font-semibold"
            >
              {t("planner.detail.summary.edit")}
            </Button>
          </div>
        </div>

        {/* <section className="mt-4 rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm">
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
        </section> */}


        <section className="mt-3">
          <TripStepNav
            active={step}
            completed={completed}
            onChange={setStep}
            progress={{
              preparation: {
                completed: prep.completed,
                total: prep.total,
              },
              routes: {
                completed: routes.done,
                total: routes.total,
              },
              places: {
                completed: places.visited,
                total: places.total,
              },
            }}
          />
        </section>

        <div className="mt-6 min-h-0 flex-1 pb-4">
          {step === "details" ? (
            <TripDetailsStep
              trip={trip}
              userId={user.uid}
              galleryImages={galleryImages}
              locations={locations}
              onEdit={openEditTrip}
              onRetryCityIntelligence={() => void fetchCityIntelligence()}
              onGoToPreparation={() => setStep("preparation")}
              onGoToPlaces={() => setStep("places")}
            />
          ) : null}

          {step === "routes" ? (
            <RoutesStep
              trip={trip}
              userId={user.uid}
              locations={locations}
              onMarkPlaceStatus={markPlaceStatus}
              onSavePlaceNote={async (locationId, note) => {
                await patchLocation(locationId, { note });
              }}
            />
          ) : null}

          {step === "preparation" ? (
            <BeforeYouGoStep
              trip={trip}
              userId={user.uid}
              homeCurrency={
                profile?.currency ||
                trip.cityIntelligence.results?.[0]?.exchangeRate?.from
              }
              onToggleItem={(id, value) => void togglePrepItem(id, value)}
              onAddItem={(title, link) => void addPrepItem(title, link)}
              onDeleteItem={(id) => void deletePrepItem(id)}
              onSyncItems={(items) => void syncPrepItems(items)}
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
              canSearchPlaces={canUsePlaceNameSearch(profile?.subscription)}
              allowGooglePlacePhotos={isProEntitled(profile?.subscription)}
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
              onMarkPlaceStatus={markPlaceStatus}
              onSavePlaceNote={async (locationId, note) => {
                await patchLocation(locationId, { note });
              }}
              onSavePlaceTravelInfo={async (locationId, patch) => {
                await patchLocation(locationId, patch);
              }}
              onSavePlaceImages={async (
                locationId,
                images: LocationImage[]
              ) => {
                await patchLocation(locationId, { images });
              }}
            />
          ) : null}
        </div>
      </div>

      <EditTripSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        trip={trip}
        locations={locations}
        onSave={async (input) => {
          await patchTrip(input);
        }}
      />

      <DeleteConfirmModal
        open={confirmDeleteOpen}
        entity="trip"
        description={t("planner.detail.deleteDesc")}
        loading={deleting}
        onCancel={() => {
          if (!deleting) setConfirmDeleteOpen(false);
        }}
        onConfirm={() => void handleDelete()}
      />

      <TripReviewModal
        open={reviewOpen}
        userId={user.uid}
        tripId={trip.id}
        tripName={trip.name}
        onClose={() => void dismissTripReview()}
        onSubmitted={() => {
          reviewHandledRef.current = true;
          setReviewOpen(false);
        }}
      />
    </main>
  );
}

