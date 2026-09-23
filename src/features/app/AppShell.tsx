"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { Coins, Plus, Search, Sparkles } from "lucide-react";
import type { User } from "firebase/auth";
import { useI18n } from "@/i18n";
import { BottomNav, type AppTab } from "@/features/app/BottomNav";
import { MapListToggle, type MapListMode } from "@/features/app/MapListToggle";
import { TravelMap, type MapInteractionMode } from "@/features/map/TravelMap";
import { PlacePreviewSheet } from "@/features/map/PlacePreviewSheet";
import { MapCityLegend } from "@/features/map/MapCityLegend";
import { PlacesList } from "@/features/places/PlacesList";
import { PlaceDetailSheet } from "@/features/places/PlaceDetailSheet";
import { AddPlaceSheet } from "@/features/add-place/AddPlaceSheet";
import { ManualPlaceSheet } from "@/features/add-place/ManualPlaceSheet";
import { SearchSheet } from "@/features/search/SearchSheet";
import { CityIntelligenceSheet } from "@/features/city/CityIntelligenceSheet";
import { ProfilePanel } from "@/features/profile/ProfilePanel";
import { TripPlannerPanel } from "@/features/planner/TripPlannerPanel";
import { ReviewSheet } from "@/features/review/ReviewSheet";
import { TravelProfileSheet } from "@/features/onboarding";
import { isProEntitled } from "@/features/profile/plans";
import { NotificationBanner } from "@/features/referral";
import { PlacesApiDevBadge } from "@/features/app/PlacesApiDevBadge";
import { useLocations, type SavedLocation } from "@/hooks/useLocations";
import { useFavoriteCities } from "@/hooks/useFavoriteCities";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useReviewPrompt } from "@/hooks/useReviewPrompt";
import { useReferralCompletion } from "@/hooks/useReferralCompletion";
import type { LocationStatus } from "@/types/location";
import {
  centerMapOnCoords,
  reverseGeocode,
  type MapInstance,
  type MapMarkerInput,
} from "@/lib/maps";

const FAVORITE_CITY_MARKER_PREFIX = "fav-city:";

interface AppShellProps {
  user: User;
  onLogout: () => void;
  initialTab?: AppTab;
}

export function AppShell({ user, onLogout, initialTab }: AppShellProps) {
  const router = useRouter();
  const {
    locations,
    loading,
    refresh,
    patchLocation,
    backfillCityGooglePlaceIds,
    removeLocation,
  } = useLocations(user.uid);
  const {
    favoriteCities,
    isFavorite,
    toggleFavorite,
    removeFavorite,
  } = useFavoriteCities(user.uid);
  const { profile } = useUserProfile(user);
  const { t, setLocale } = useI18n();
  const aiCreditsBalance = profile?.aiCreditsBalance ?? null;
  const isPro = isProEntitled(profile?.subscription);
  const needsTravelProfile = Boolean(profile) && !profile?.travelProfile;

  useEffect(() => {
    const lang = profile?.preferences?.language;
    if (lang) setLocale(lang);
  }, [profile?.preferences?.language, setLocale]);

  const [tab, setTab] = useState<AppTab>(initialTab ?? "map");
  const [viewMode, setViewMode] = useState<MapListMode>("map");
  const [travelProfileOpen, setTravelProfileOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [preview, setPreview] = useState<SavedLocation | null>(null);
  const [detail, setDetail] = useState<SavedLocation | null>(null);
  const [cityInfo, setCityInfo] = useState<{
    cityName: string;
    countryName: string;
    lat: number;
    lon: number;
  } | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const [cityPickMode, setCityPickMode] = useState(false);
  const [cityResolving, setCityResolving] = useState(false);
  const [pickCoords, setPickCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  /** Bumped on bottom-nav switches so nested panel state (profile subviews, etc.) resets. */
  const [placesMountKey, setPlacesMountKey] = useState(0);
  const [plannerOpened, setPlannerOpened] = useState(initialTab === "planner");
  const [profileMountKey, setProfileMountKey] = useState(0);
  const mapRef = useRef<MapInstance | null>(null);

  const clearTransientUi = useCallback(() => {
    setPreview(null);
    setDetail(null);
    setCityInfo(null);
    setAddOpen(false);
    setSearchOpen(false);
    setManualOpen(false);
    setPickMode(false);
    setCityPickMode(false);
  }, []);

  // After account setup: ask for travel tastes once.
  useEffect(() => {
    setTravelProfileOpen(needsTravelProfile);
  }, [needsTravelProfile]);

  const goToTab = useCallback(
    (next: AppTab) => {
      clearTransientUi();
      if (next === "map") {
        setViewMode("map");
      }
      if (next === "places") {
        setPlacesMountKey((k) => k + 1);
      }
      if (next === "planner") {
        setPlannerOpened(true);
      }
      if (next === "profile") {
        setProfileMountKey((k) => k + 1);
      }
      setTab(next);
    },
    [clearTransientUi]
  );

  const reviewBlocked =
    travelProfileOpen ||
    addOpen ||
    searchOpen ||
    manualOpen ||
    Boolean(preview) ||
    Boolean(detail) ||
    Boolean(cityInfo) ||
    pickMode ||
    cityPickMode;

  const {
    open: reviewOpen,
    close: closeReview,
    markSubmitted: markReviewSubmitted,
  } = useReviewPrompt({
    hasLeftReview: Boolean(profile?.hasLeftReview),
    savedItemCount: locations.length + favoriteCities.length,
    blocked: reviewBlocked || loading,
    enabled: Boolean(profile) && !loading && !needsTravelProfile,
  });

  useReferralCompletion({
    enabled: Boolean(profile) && !loading,
    needsOnboarding: needsTravelProfile,
  });

  const markers: MapMarkerInput[] = useMemo(() => {
    const placeMarkers: MapMarkerInput[] = locations.map((place) => ({
      id: place.id,
      lat: place.lat,
      lon: place.lon,
      title: place.title,
      status: place.status,
      kind: "place" as const,
      googlePlaceId: place.city.googlePlaceId,
    }));

    const cityMarkers: MapMarkerInput[] = favoriteCities.map((city) => ({
      id: `${FAVORITE_CITY_MARKER_PREFIX}${city.cityId || city.id}`,
      lat: city.lat,
      lon: city.lon,
      title: city.cityName,
      kind: "city" as const,
    }));

    return [...cityMarkers, ...placeMarkers];
  }, [locations, favoriteCities]);

  const onMarkerSelect = useCallback(
    (id: string) => {
      if (pickMode || cityPickMode) return;

      if (id.startsWith(FAVORITE_CITY_MARKER_PREFIX)) {
        const cityId = id.slice(FAVORITE_CITY_MARKER_PREFIX.length);
        const fav =
          favoriteCities.find((c) => c.cityId === cityId || c.id === cityId) ??
          null;
        if (fav) {
          setPreview(null);
          setDetail(null);
          setCityInfo({
            cityName: fav.cityName,
            countryName: fav.country,
            lat: fav.lat,
            lon: fav.lon,
          });
        }
        return;
      }

      const place = locations.find((l) => l.id === id) ?? null;
      setPreview(place);
    },
    [locations, favoriteCities, pickMode, cityPickMode]
  );

  const showMapSurface = tab === "map" && viewMode === "map";
  const showListSurface =
    (tab === "map" && viewMode === "list") || tab === "places";

  const interactionMode: MapInteractionMode = pickMode
    ? "pick-place"
    : cityPickMode
      ? "pick-city"
      : "browse";

  const openCityInfo = useCallback(
    (city: {
      cityName: string;
      countryName: string;
      lat: number;
      lon: number;
    }) => {
      setPreview(null);
      setDetail(null);
      setCityPickMode(false);
      setCityInfo({ ...city });
    },
    []
  );

  const handleMapClick = useCallback(
    async (coords: { lat: number; lng: number }) => {
      if (pickMode) {
        setPickCoords(coords);
        setManualOpen(true);
        setPickMode(false);
        return;
      }

      if (!cityPickMode) return;

      setCityResolving(true);
      try {
        const place = await reverseGeocode(coords.lat, coords.lng);
        if (!place?.city && !place?.country) {
          return;
        }
        openCityInfo({
          cityName: place.city || t("app.unknownCity"),
          countryName: place.country || t("app.unknownCountry"),
          lat: place.lat,
          lon: place.lon,
        });
      } finally {
        setCityResolving(false);
      }
    },
    [pickMode, cityPickMode, openCityInfo, t]
  );

  return (
    <main className="relative flex min-h-0 flex-1 flex-col bg-background">
      {/* Map always mounted underneath for continuity */}
      <div
        className={
          showMapSurface
            ? "absolute inset-0"
            : "pointer-events-none absolute inset-0 opacity-0"
        }
        aria-hidden={!showMapSurface}
      >
        <TravelMap
          className="h-full w-full"
          markers={markers}
          cityLocations={isPro ? locations : []}
          onCityPlaceIdResolved={
            isPro
              ? (batch) => {
                  void backfillCityGooglePlaceIds(batch);
                }
              : undefined
          }
          onMarkerSelect={onMarkerSelect}
          onMapReady={(map) => {
            mapRef.current = map;
          }}
          interactionMode={interactionMode}
          fitToMarkers
          onMapClick={(coords) => {
            void handleMapClick(coords);
          }}
        />
        {showMapSurface && isPro ? <MapCityLegend /> : null}
      </div>

      {showListSurface ? (
        <div className="absolute inset-0 z-10 bg-background">
          <PlacesList
            key={placesMountKey}
            locations={locations}
            loading={loading}
            allowGooglePlacePhotos={isPro}
            onSelectPlace={(place) => setPreview(place)}
            onAddPlace={() => setAddOpen(true)}
            onSelectCity={openCityInfo}
            onDeleteCity={async (places) => {
              await Promise.all(places.map((place) => removeLocation(place.id)));
              const first = places[0];
              if (
                first &&
                isFavorite(first.city.name, first.country.name, {
                  lat: first.lat,
                  lon: first.lon,
                })
              ) {
                try {
                  await removeFavorite(first.city.name, first.country.name, {
                    lat: first.lat,
                    lon: first.lon,
                  });
                } catch {
                  // Places already removed; favorite cleanup is best-effort.
                }
              }
              if (preview && places.some((p) => p.id === preview.id)) {
                setPreview(null);
              }
              if (detail && places.some((p) => p.id === detail.id)) {
                setDetail(null);
              }
            }}
          />
        </div>
      ) : null}

      {plannerOpened ? (
        <div
          className={
            tab === "planner"
              ? "absolute inset-0 z-10 bg-background"
              : "pointer-events-none hidden"
          }
          aria-hidden={tab !== "planner"}
        >
          <TripPlannerPanel
            user={user}
            resyncOnMount={initialTab === "planner"}
          />
        </div>
      ) : null}

      {tab === "profile" ? (
        <div className="absolute inset-0 z-10 bg-background">
          <ProfilePanel
            key={profileMountKey}
            user={user}
            locations={locations}
            locationsLoading={loading}
            onLogout={onLogout}
            onOpenPlaces={() => goToTab("places")}
            onExploreMap={() => goToTab("map")}
          />
        </div>
      ) : null}

      {/* Top chrome */}
      {tab !== "profile" ? (
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex max-w-full items-start justify-between gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:gap-3 sm:px-4 sm:pt-4">
        <div className="pointer-events-auto flex min-w-0 shrink items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => goToTab("map")}
            aria-label={t("app.brand")}
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-surface-elevated/95 p-1.5 shadow-sm backdrop-blur sm:py-1.5 sm:pl-1.5 sm:pr-3.5"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icon.svg"
              alt=""
              width={24}
              height={24}
              className="h-6 w-6 shrink-0"
            />
            <p className="hidden font-[family-name:var(--font-manrope)] text-sm font-semibold tracking-wide text-accent sm:block">
              {t("app.brand")}
            </p>
          </button>

          {aiCreditsBalance !== null ? (
            <button
              type="button"
              onClick={() => router.push("/pricing")}
              className="flex h-10 shrink-0 items-center rounded-full border border-border bg-surface-elevated/95 shadow-sm backdrop-blur transition-colors hover:bg-surface sm:h-11"
              title={t("app.credits.title")}
            >
              <span className="flex items-center px-2.5 sm:px-3">
                <Coins className="h-3.5 w-3.5 text-primary" aria-hidden />
              </span>
              <span className="h-4 w-px shrink-0 bg-border" aria-hidden />
              <span className="px-2.5 text-sm font-semibold tabular-nums text-text sm:px-3">
                {aiCreditsBalance}
              </span>
              <span className="sr-only">{t("app.credits.srOpenPricing")}</span>
            </button>
          ) : null}
        </div>

        {tab === "map" ? (
          <div className="pointer-events-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            {viewMode === "map" ? (
              <button
                type="button"
                aria-label={t("app.cityInfo")}
                aria-pressed={cityPickMode}
                onClick={() => {
                  setPickMode(false);
                  setCityPickMode((v) => !v);
                }}
                className={
                  cityPickMode
                    ? "flex h-10 shrink-0 items-center rounded-full border border-primary bg-primary text-white shadow-sm transition-colors sm:h-11"
                    : "flex h-10 shrink-0 items-center rounded-full border border-border bg-surface-elevated/95 text-text shadow-sm backdrop-blur transition-colors hover:bg-surface sm:h-11"
                }
              >
                <span className="flex items-center px-2.5 sm:px-3">
                  <Sparkles
                    className={
                      cityPickMode
                        ? "h-3.5 w-3.5 text-white"
                        : "h-3.5 w-3.5 text-text"
                    }
                    aria-hidden
                  />
                </span>
                <span
                  className={
                    cityPickMode
                      ? "h-4 w-px shrink-0 bg-white/30"
                      : "h-4 w-px shrink-0 bg-border"
                  }
                  aria-hidden
                />
                <span className="px-2.5 text-sm font-medium sm:px-3">
                  {t("app.cityInfo")}
                </span>
              </button>
            ) : null}
            <MapListToggle mode={viewMode} onChange={setViewMode} />
          </div>
        ) : tab === "places" ? (
          <div className="pointer-events-auto hidden gap-2 md:flex">
            <Button
              icon={Search}
              variant="secondary"
              onClick={() => setSearchOpen(true)}
              className="!bg-surface-elevated/95 !text-text !border-border"
            >
              {t("app.search")}
            </Button>
            <Button
              icon={Plus}
              onClick={() => setAddOpen(true)}
              className="btn-primary"
            >
              {t("app.add")}
            </Button>
          </div>
        ) : null}
      </div>
      ) : null}

      <NotificationBanner
        userId={user.uid}
        onOpenProfile={() => goToTab("profile")}
      />

      {pickMode ? (
        <div className="absolute inset-x-0 top-20 z-20 flex justify-center px-4">
          <div className="rounded-full border border-primary/30 bg-primary-tint px-4 py-2 text-sm font-medium text-primary shadow-sm">
            {t("app.pickPinHint")}
            <button
              type="button"
              className="ml-3 underline"
              onClick={() => setPickMode(false)}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {cityPickMode ? (
        <div className="absolute inset-x-0 top-20 z-20 flex justify-center px-4">
          <div className="rounded-full border border-primary/30 bg-primary-tint px-4 py-2 text-sm font-medium text-primary shadow-sm">
            {cityResolving
              ? t("app.findingCity")
              : t("app.pickCityHint")}
            <button
              type="button"
              className="ml-3 underline"
              onClick={() => setCityPickMode(false)}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : null}

      <BottomNav
        active={tab}
        onMap={() => goToTab("map")}
        onAdd={() => setAddOpen(true)}
        onPlaces={() => goToTab("places")}
        onPlanner={() => goToTab("planner")}
        onProfile={() => goToTab("profile")}
        plannerLocked={!isPro}
      />

      {/* Empty map CTA */}
      {showMapSurface &&
      !loading &&
      locations.length === 0 &&
      favoriteCities.length === 0 &&
      !pickMode &&
      !cityPickMode ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-28 z-20 flex justify-center px-4">
          <div className="pointer-events-auto max-w-sm rounded-2xl border border-border bg-surface-elevated/95 p-4 text-center shadow-lg backdrop-blur">
            <p className="text-sm font-semibold text-text">
              {t("app.emptyMapTitle")}
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              {t("app.emptyMapBody")}
            </p>
            <Button
              icon={Plus}
              onClick={() => setAddOpen(true)}
              className="mt-3 !bg-primary hover:!bg-primary-hover !border-primary !text-white"
            >
              {t("app.addFirstPlace")}
            </Button>
          </div>
        </div>
      ) : null}

      <AddPlaceSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        userId={user.uid}
        isPro={isPro}
        onSaved={() => {
          void refresh();
          goToTab("map");
        }}
      />

      <ManualPlaceSheet
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        userId={user.uid}
        coords={pickCoords}
        onSaved={() => {
          void refresh();
          goToTab("map");
        }}
      />

      <SearchSheet
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        locations={locations}
        onSelectPlace={(place) => {
          goToTab("map");
          setDetail(place);
        }}
      />

      <PlacePreviewSheet
        place={preview}
        open={Boolean(preview)}
        allowGooglePlacePhotos={isPro}
        onClose={() => setPreview(null)}
        onUpdateStatus={async (status: LocationStatus) => {
          if (!preview) return;
          await patchLocation(preview.id, { status });
          setPreview({ ...preview, status });
        }}
        onSaveNote={async (note: string) => {
          if (!preview) return;
          await patchLocation(preview.id, { note });
          setPreview({ ...preview, note });
        }}
        onDelete={async () => {
          if (!preview) return;
          await removeLocation(preview.id);
          setPreview(null);
        }}
        onViewOnMap={(place) => {
          setPreview(null);
          setTab("map");
          setViewMode("map");
          if (mapRef.current) {
            centerMapOnCoords(mapRef.current, {
              lat: place.lat,
              lon: place.lon,
            });
          }
        }}
      />

      <PlaceDetailSheet
        place={detail}
        open={Boolean(detail)}
        allowGooglePlacePhotos={isPro}
        onClose={() => setDetail(null)}
        onUpdateStatus={async (status: LocationStatus) => {
          if (!detail) return;
          await patchLocation(detail.id, { status });
          setDetail({ ...detail, status });
        }}
        onSaveNote={async (note: string) => {
          if (!detail) return;
          await patchLocation(detail.id, { note });
          setDetail({ ...detail, note });
        }}
        onDelete={async () => {
          if (!detail) return;
          await removeLocation(detail.id);
          setDetail(null);
        }}
        onViewOnMap={(place) => {
          setDetail(null);
          setTab("map");
          setViewMode("map");
          if (mapRef.current) {
            centerMapOnCoords(mapRef.current, {
              lat: place.lat,
              lon: place.lon,
            });
          }
        }}
        onOpenCity={openCityInfo}
      />

      <CityIntelligenceSheet
        open={Boolean(cityInfo)}
        onClose={() => setCityInfo(null)}
        userId={user.uid}
        city={cityInfo}
        isFavorite={
          cityInfo
            ? isFavorite(cityInfo.cityName, cityInfo.countryName, {
                lat: cityInfo.lat,
                lon: cityInfo.lon,
              })
            : false
        }
        onToggleFavorite={
          cityInfo
            ? async () => {
                await toggleFavorite({
                  cityName: cityInfo.cityName,
                  country: cityInfo.countryName,
                  lat: cityInfo.lat,
                  lon: cityInfo.lon,
                });
              }
            : undefined
        }
        onPlaceSaved={() => {
          void refresh();
        }}
      />

      <TravelProfileSheet
        open={travelProfileOpen}
        userId={user.uid}
        onComplete={() => setTravelProfileOpen(false)}
      />

      <ReviewSheet
        open={reviewOpen}
        onClose={closeReview}
        alreadyReviewed={Boolean(profile?.hasLeftReview)}
        onSubmitted={() => {
          markReviewSubmitted();
        }}
      />

      <PlacesApiDevBadge />
    </main>
  );
}
