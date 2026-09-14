"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { Coins, Plus, Search, Sparkles } from "lucide-react";
import type { User } from "firebase/auth";
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
  } = useFavoriteCities(user.uid);
  const { profile } = useUserProfile(user);
  const aiCreditsBalance = profile?.aiCreditsBalance ?? null;
  const isPro = isProEntitled(profile?.subscription);
  const needsTravelProfile = Boolean(profile) && !profile?.travelProfile;

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
  const [plannerMountKey, setPlannerMountKey] = useState(0);
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
        setPlannerMountKey((k) => k + 1);
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
          cityName: place.city || "Unknown city",
          countryName: place.country || "Unknown country",
          lat: place.lat,
          lon: place.lon,
        });
      } finally {
        setCityResolving(false);
      }
    },
    [pickMode, cityPickMode, openCityInfo]
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
            onSelectPlace={(place) => setDetail(place)}
            onAddPlace={() => setAddOpen(true)}
            onSelectCity={openCityInfo}
          />
        </div>
      ) : null}

      {tab === "planner" ? (
        <div className="absolute inset-0 z-10 bg-background">
          <TripPlannerPanel key={plannerMountKey} user={user} />
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
            aria-label="PinToTrip"
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
              PinToTrip
            </p>
          </button>

          {aiCreditsBalance !== null ? (
            <button
              type="button"
              onClick={() => router.push("/pricing")}
              className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface-elevated/95 px-2.5 py-2 shadow-sm backdrop-blur transition-colors hover:bg-surface sm:gap-1.5 sm:px-3"
              title="AI credits available"
            >
              <Coins className="h-3.5 w-3.5 text-primary" aria-hidden />
              <p className="text-sm font-semibold tabular-nums text-text">
                {aiCreditsBalance}
              </p>
              <span className="sr-only">AI credits available — open pricing</span>
            </button>
          ) : null}
        </div>

        {tab === "map" ? (
          <div className="pointer-events-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            {viewMode === "map" ? (
              <Button
                icon={Sparkles}
                variant="secondary"
                aria-label="City info"
                onClick={() => {
                  setPickMode(false);
                  setCityPickMode((v) => !v);
                }}
                className={
                  cityPickMode
                    ? "!h-10 !w-10 !gap-0 !rounded-full !px-0 !bg-primary !text-white !border-primary sm:!h-11 sm:!w-auto sm:!gap-2 sm:!px-4"
                    : "!h-10 !w-10 !gap-0 !rounded-full !px-0 !bg-surface-elevated/95 !text-text !border-border sm:!h-11 sm:!w-auto sm:!gap-2 sm:!px-4"
                }
              >
                <span className="hidden sm:inline">City info</span>
              </Button>
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
              Search
            </Button>
            <Button
              icon={Plus}
              onClick={() => setAddOpen(true)}
              className="btn-primary"
            >
              Add
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
            Tap the map to place a pin
            <button
              type="button"
              className="ml-3 underline"
              onClick={() => setPickMode(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {cityPickMode ? (
        <div className="absolute inset-x-0 top-20 z-20 flex justify-center px-4">
          <div className="rounded-full border border-primary/30 bg-primary-tint px-4 py-2 text-sm font-medium text-primary shadow-sm">
            {cityResolving
              ? "Finding city…"
              : "Tap the map to pick a city"}
            <button
              type="button"
              className="ml-3 underline"
              onClick={() => setCityPickMode(false)}
            >
              Cancel
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
              Your travel map is empty.
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              Save places you discover and they&apos;ll appear here.
            </p>
            <Button
              icon={Plus}
              onClick={() => setAddOpen(true)}
              className="mt-3 !bg-primary hover:!bg-primary-hover !border-primary !text-white"
            >
              Add your first place
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
        onClose={() => setPreview(null)}
        onOpenDetails={(place) => {
          setPreview(null);
          setDetail(place);
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
            ? isFavorite(cityInfo.cityName, cityInfo.countryName)
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
    </main>
  );
}
