"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Coins,
  Globe,
  Loader2,
  LocateFixed,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { Timestamp } from "firebase/firestore";
import { Button, TextInput } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { useI18n } from "@/i18n";
import { findAroundMe } from "@/services/functions";
import { createUserLocation } from "@/services/locations";
import {
  getBrowserCoords,
  resolveEnglishPlaceIds,
  reverseGeocode,
  withCityGooglePlaceId,
} from "@/lib/maps";
import { cx, isAsciiId } from "@/lib/utils";
import {
  fetchSuggestedPlacePhoto,
  pexelsPhotoUrlExcludeId,
} from "@/features/add-place/placeSearch";
import {
  AROUND_ME_TYPES,
  AROUND_ME_RADIUS_KM_OPTIONS,
  DEFAULT_AROUND_ME_RADIUS_KM,
  type AroundMePlaceResult,
  type AroundMeRadiusKm,
  type AroundMeTypeId,
} from "@/types/around-me";
import {
  AI_CREDIT_COSTS,
  isInsufficientAICreditsError,
} from "@/types/credits";
import type { SavedLocation } from "@/hooks/useLocations";
import type { UserLocationCreateInput } from "@/types/location";

type SheetPhase = "pick" | "loading" | "results";

export type AroundMeOrigin = {
  lat: number;
  lon: number;
  label: string;
  source: "gps" | "map";
  cityId?: string;
  countryId?: string;
  cityName?: string;
  countryName?: string;
};

interface AroundMeSheetProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  language?: string;
  aiCreditsBalance: number | null;
  /** Existing saved places — used to mark already-added results. */
  locations: SavedLocation[];
  onPlaceSaved?: () => void;
  /**
   * Location chosen by tapping the map (parent sets this after pick mode).
   * When present on open, it becomes the search center.
   */
  initialOrigin?: AroundMeOrigin | null;
  /** Close the sheet and let the parent enter map-pick mode (like City Info). */
  onPickFromMap?: () => void;
}

function googleMapsUrl(place: AroundMePlaceResult): string {
  const fromLink = place.links?.find((link) =>
    /google\.(com|co\.)|maps\.app\.goo\.gl/i.test(link.url)
  );
  if (fromLink?.url) return fromLink.url;

  const placeId = place.googlePlaceId.replace(/^places\//, "").trim();
  if (placeId) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.title)}&query_place_id=${encodeURIComponent(placeId)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lon}`;
}

function openInGoogleMaps(place: AroundMePlaceResult) {
  window.open(googleMapsUrl(place), "_blank", "noopener,noreferrer");
}

function placeCoverUrl(place: AroundMePlaceResult): string | null {
  for (const image of place.images ?? []) {
    const url = image.url?.trim();
    if (url) return url;
  }
  return null;
}

function placeNeedsPexelsPhoto(place: AroundMePlaceResult): boolean {
  return !placeCoverUrl(place);
}

export function AroundMeSheet({
  open,
  onClose,
  userId,
  language = "en",
  aiCreditsBalance,
  locations,
  onPlaceSaved,
  initialOrigin = null,
  onPickFromMap,
}: AroundMeSheetProps) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<SheetPhase>("pick");
  const [query, setQuery] = useState("");
  const [selectedType, setSelectedType] = useState<AroundMeTypeId | null>(
    null
  );
  const [radiusKm, setRadiusKm] = useState<AroundMeRadiusKm>(
    DEFAULT_AROUND_ME_RADIUS_KM
  );
  const [origin, setOrigin] = useState<AroundMeOrigin | null>(null);
  const [locating, setLocating] = useState(false);
  const [places, setPlaces] = useState<AroundMePlaceResult[]>([]);
  const [nearLabel, setNearLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());
  /** Skip full reset while the sheet is closed only for map-pick. */
  const skipResetRef = useRef(false);

  useEffect(() => {
    if (!open) {
      if (skipResetRef.current) return;
      setPhase("pick");
      setQuery("");
      setSelectedType(null);
      setRadiusKm(DEFAULT_AROUND_ME_RADIUS_KM);
      setOrigin(null);
      setLocating(false);
      setPlaces([]);
      setNearLabel(null);
      setError(null);
      setAddingId(null);
      setAddedIds(new Set());
      return;
    }

    skipResetRef.current = false;
    if (initialOrigin) {
      setOrigin(initialOrigin);
      setNearLabel(initialOrigin.label);
      setError(null);
    }
  }, [open, initialOrigin]);

  const filteredTypes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return AROUND_ME_TYPES;
    return AROUND_ME_TYPES.filter((type) => {
      const label = t(`aroundMe.types.${type.id}`).toLowerCase();
      return label.includes(q) || type.id.toLowerCase().includes(q);
    });
  }, [query, t]);

  const savedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const loc of locations) {
      keys.add(
        `${loc.title.trim().toLowerCase()}|${loc.lat.toFixed(4)}|${loc.lon.toFixed(4)}`
      );
    }
    return keys;
  }, [locations]);

  const creditCost = AI_CREDIT_COSTS.findAroundMe;
  const canAfford =
    aiCreditsBalance === null || aiCreditsBalance >= creditCost;

  const selectedTypeMeta = selectedType
    ? AROUND_ME_TYPES.find((type) => type.id === selectedType)
    : null;
  const selectedLabel = selectedType
    ? t(`aroundMe.types.${selectedType}`)
    : null;

  /** Places still missing a cover — drives Pexels fill without looping. */
  const missingPhotoKey = useMemo(
    () =>
      places
        .filter(placeNeedsPexelsPhoto)
        .map((p) => p.googlePlaceId)
        .join("|"),
    [places]
  );

  // Fill empty Around Me thumbs from Pexels by place name (title-first).
  useEffect(() => {
    if (phase !== "results" || !missingPhotoKey) return;

    let cancelled = false;
    const usedPhotoIds = new Set<string>();
    for (const place of places) {
      const existing = placeCoverUrl(place);
      if (existing) usedPhotoIds.add(pexelsPhotoUrlExcludeId(existing));
    }

    void (async () => {
      const next = places.map((place) => ({
        ...place,
        images: [...(place.images ?? [])],
      }));
      let changed = false;

      for (const place of next) {
        if (cancelled) return;
        if (!placeNeedsPexelsPhoto(place)) continue;

        const title = place.title.trim();
        const cityName = place.city.name.trim();
        if (!title || !cityName) continue;

        try {
          const photo = await fetchSuggestedPlacePhoto({
            title,
            cityName,
            countryName: place.country.name.trim() || undefined,
            lat: place.lat,
            lon: place.lon,
            excludePlaceIds: usedPhotoIds,
          });
          if (cancelled) return;
          if (!photo?.photoUrl) continue;

          usedPhotoIds.add(photo.placeId);
          usedPhotoIds.add(pexelsPhotoUrlExcludeId(photo.photoUrl));
          place.images = [{ url: photo.photoUrl, source: "external" }];
          changed = true;
        } catch {
          // Keep empty — MapPin placeholder in the card.
        }
      }

      if (changed && !cancelled) setPlaces(next);
    })();

    return () => {
      cancelled = true;
    };
    // places is read at effect start; missingPhotoKey gates re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [phase, missingPhotoKey]);

  async function resolveCurrentLocation(): Promise<AroundMeOrigin> {
    const coords = await getBrowserCoords({
      timeoutMs: 15_000,
      maximumAge: 0,
      enableHighAccuracy: true,
    });
    if (!coords) {
      throw new Error(t("aroundMe.error.gps"));
    }

    const [place, englishIds] = await Promise.all([
      reverseGeocode(coords.lat, coords.lon, { language: "en" }),
      resolveEnglishPlaceIds(coords.lat, coords.lon),
    ]);

    if (!place?.city && !place?.country && !englishIds?.countryId) {
      throw new Error(t("aroundMe.error.cityFromGps"));
    }

    const cityName =
      englishIds?.cityNameEn || place?.city || undefined;
    const countryName =
      englishIds?.countryNameEn || place?.country || undefined;
    const label =
      [cityName, countryName].filter(Boolean).join(", ") ||
      t("aroundMe.currentLocation");

    return {
      lat: coords.lat,
      lon: coords.lon,
      label,
      source: "gps",
      ...(englishIds?.cityId ? { cityId: englishIds.cityId } : {}),
      ...(englishIds?.countryId ? { countryId: englishIds.countryId } : {}),
      ...(cityName ? { cityName } : {}),
      ...(countryName ? { countryName } : {}),
    };
  }

  async function enrichOriginIds(
    center: AroundMeOrigin
  ): Promise<AroundMeOrigin> {
    if (center.countryId && /^[a-z]{2}$/.test(center.countryId)) {
      return center;
    }
    const englishIds = await resolveEnglishPlaceIds(center.lat, center.lon);
    if (!englishIds?.countryId) return center;
    return {
      ...center,
      cityId: center.cityId || englishIds.cityId,
      countryId: englishIds.countryId,
      cityName: center.cityName || englishIds.cityNameEn,
      countryName: center.countryName || englishIds.countryNameEn,
      label:
        center.label ||
        [englishIds.cityNameEn, englishIds.countryNameEn]
          .filter(Boolean)
          .join(", "),
    };
  }

  async function handleUseCurrentLocation() {
    if (locating) return;
    setLocating(true);
    setError(null);
    try {
      const next = await resolveCurrentLocation();
      setOrigin(next);
      setNearLabel(next.label);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("aroundMe.error.gpsGeneric")
      );
    } finally {
      setLocating(false);
    }
  }

  function handlePickOnMap() {
    skipResetRef.current = true;
    onPickFromMap?.();
  }

  async function runSearch(
    typeId: AroundMeTypeId,
    onErrorPhase: SheetPhase = "pick"
  ) {
    setError(null);
    setPhase("loading");

    try {
      let center = origin;
      if (!center) {
        center = await resolveCurrentLocation();
        setOrigin(center);
      } else {
        center = await enrichOriginIds(center);
        setOrigin(center);
      }

      setNearLabel(center.label);

      const result = await findAroundMe({
        lat: center.lat,
        lon: center.lon,
        typeId,
        radiusKm,
        language,
        ...(center.cityId ? { cityId: center.cityId } : {}),
        ...(center.countryId ? { countryId: center.countryId } : {}),
        ...(center.cityName ? { cityName: center.cityName } : {}),
        ...(center.countryName ? { countryName: center.countryName } : {}),
      });

      setPlaces(result.places);
      setPhase("results");
    } catch (err) {
      if (isInsufficientAICreditsError(err)) {
        setError(
          t("credits.insufficientDetail", {
            message: err.message,
            required: err.requiredCredits,
            available: err.availableCredits,
          })
        );
      } else {
        setError(
          err instanceof Error ? err.message : t("aroundMe.error.searchFailed")
        );
      }
      setPhase(onErrorPhase);
    }
  }

  async function handleContinue() {
    if (!selectedType || !canAfford || !origin) return;
    await runSearch(selectedType, "pick");
  }

  async function handleSearchAgain() {
    if (!selectedType || !canAfford || !origin) return;
    // Re-runs findAroundMe and charges credits again; keep old list if it fails.
    await runSearch(selectedType, "results");
  }

  async function handleAdd(place: AroundMePlaceResult) {
    if (addingId) return;
    setAddingId(place.googlePlaceId);
    setError(null);
    try {
      if (!isAsciiId(place.city.id) || !isAsciiId(place.country.id)) {
        throw new Error(t("aroundMe.error.missingIds"));
      }
      const country = {
        id: place.country.id.trim().toLowerCase(),
        name: place.country.name,
      };
      const city = await withCityGooglePlaceId(
        {
          id: place.city.id.trim().toLowerCase(),
          name: place.city.name,
        },
        country,
        { lat: place.lat, lon: place.lon }
      );

      const input: UserLocationCreateInput = {
        title: place.title,
        description: place.description,
        ...(place.note ? { note: place.note } : {}),
        lat: place.lat,
        lon: place.lon,
        country,
        city,
        status: "planned",
        ...(place.category ? { category: place.category } : {}),
        ...(place.price ? { price: place.price } : {}),
        ...(place.links ? { links: place.links } : {}),
        images: place.images ?? [],
        confidence: place.confidence,
        ai: {
          why: place.ai.why,
          model: place.ai.model,
          processedAt: Timestamp.now(),
        },
        source: { type: "around_me" },
      };

      await createUserLocation(userId, input);
      setAddedIds((prev) => new Set(prev).add(place.googlePlaceId));
      onPlaceSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("aroundMe.error.saveFailed"));
    } finally {
      setAddingId(null);
    }
  }

  function isAlreadySaved(place: AroundMePlaceResult): boolean {
    if (addedIds.has(place.googlePlaceId)) return true;
    const key = `${place.title.trim().toLowerCase()}|${place.lat.toFixed(4)}|${place.lon.toFixed(4)}`;
    return savedKeys.has(key);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("aroundMe.title")}
      description={t("aroundMe.description")}
      leading={
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary ring-1 ring-primary/15">
          <LocateFixed className="h-[18px] w-[18px]" aria-hidden />
        </span>
      }
      size="lg"
      bodyClassName="!pt-3"
    >
      {phase === "pick" ? (
        <div className="flex flex-col gap-5">
          <div className="rounded-2xl border border-border/80 bg-gradient-to-br from-primary-tint/80 via-surface to-surface px-4 py-3.5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-elevated text-primary shadow-sm">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text">
                  {t("aroundMe.moodTitle")}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
                  {t("aroundMe.moodBody")}
                </p>
              </div>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
              {t("aroundMe.searchNear")}
            </p>
            <div
              className="flex flex-wrap gap-1.5"
              role="radiogroup"
              aria-label={t("aroundMe.searchLocationAria")}
            >
              <button
                type="button"
                role="radio"
                aria-checked={origin?.source === "gps"}
                disabled={locating}
                onClick={() => void handleUseCurrentLocation()}
                className={cx(
                  "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-all",
                  origin?.source === "gps"
                    ? "border-primary bg-primary-tint text-primary shadow-sm ring-1 ring-primary/25"
                    : "border-border bg-surface-elevated/70 text-text hover:border-primary/30 hover:bg-surface-elevated",
                  locating && "cursor-wait opacity-80"
                )}
              >
                {locating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <LocateFixed className="h-3.5 w-3.5" aria-hidden />
                )}
                <span>
                  {locating
                    ? t("aroundMe.gettingGps")
                    : origin?.source === "gps"
                      ? origin.label
                      : t("aroundMe.currentLocation")}
                </span>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={origin?.source === "map"}
                disabled={locating || !onPickFromMap}
                onClick={handlePickOnMap}
                className={cx(
                  "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-all",
                  origin?.source === "map"
                    ? "border-primary bg-primary-tint text-primary shadow-sm ring-1 ring-primary/25"
                    : "border-border bg-surface-elevated/70 text-text hover:border-primary/30 hover:bg-surface-elevated",
                  (!onPickFromMap || locating) && "opacity-60"
                )}
              >
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                <span>
                  {origin?.source === "map" ? origin.label : t("aroundMe.pickOnMap")}
                </span>
              </button>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
              {t("aroundMe.searchRadius")}
            </p>
            <div
              className="grid grid-cols-4 gap-2"
              role="radiogroup"
              aria-label={t("aroundMe.searchRadiusAria")}
            >
              {AROUND_ME_RADIUS_KM_OPTIONS.map((km) => {
                const selected = radiusKm === km;
                return (
                  <button
                    key={km}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setRadiusKm(km)}
                    className={cx(
                      "rounded-xl border px-2 py-2.5 text-center text-sm font-semibold tabular-nums transition-all",
                      selected
                        ? "border-primary bg-primary-tint text-primary shadow-sm ring-1 ring-primary/25"
                        : "border-border bg-surface-elevated/70 text-text hover:border-primary/30 hover:bg-surface-elevated"
                    )}
                  >
                    {km}
                    <span className="ml-0.5 text-[11px] font-medium opacity-70">
                      {t("aroundMe.km")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("aroundMe.searchTypesPlaceholder")}
            icon={Search}
            aria-label={t("aroundMe.searchTypesAria")}
          />

          <ul className="flex flex-wrap gap-1.5">
            {filteredTypes.map((type) => {
              const selected = selectedType === type.id;
              return (
                <li key={type.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedType(type.id)}
                    aria-pressed={selected}
                    className={cx(
                      "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-left text-xs font-medium transition-all",
                      selected
                        ? "border-primary bg-primary-tint text-primary shadow-sm ring-1 ring-primary/25"
                        : "border-border bg-surface-elevated/70 text-text hover:border-primary/30 hover:bg-surface-elevated"
                    )}
                  >
                    <span className="text-sm leading-none" aria-hidden>
                      {type.icon}
                    </span>
                    <span className="truncate">
                      {t(`aroundMe.types.${type.id}`)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {filteredTypes.length === 0 ? (
            <p className="text-center text-sm text-text-secondary">
              {t("aroundMe.noTypes")}
            </p>
          ) : null}

          {error ? (
            <div className="flex items-start gap-2 rounded-2xl border border-danger/25 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>{error}</p>
            </div>
          ) : null}

          <div className="sticky bottom-0 -mx-1 border-t border-border/60 bg-surface/95 px-1 pt-3 backdrop-blur">
            <div className="mb-2.5 flex items-center justify-between gap-2 text-xs text-text-secondary">
              <span className="inline-flex items-center gap-1.5">
                <Coins className="h-3.5 w-3.5 text-primary" aria-hidden />
                {t("aroundMe.aiCredits", { n: creditCost })}
              </span>
              {aiCreditsBalance !== null ? (
                <span className="tabular-nums">
                  {t("aroundMe.balance", { n: aiCreditsBalance })}
                </span>
              ) : null}
            </div>
            {!origin ? (
              <p className="mb-2 text-center text-xs text-text-secondary">
                {t("aroundMe.chooseLocation")}
              </p>
            ) : null}
            {!canAfford ? (
              <p className="mb-2 text-center text-xs text-danger">
                {t("aroundMe.notEnoughCredits")}
              </p>
            ) : null}
            <Button
              onClick={() => void handleContinue()}
              disabled={!selectedType || !canAfford || !origin || locating}
              color="neutral"
              className="w-full"
              icon={LocateFixed}
            >
              {t("aroundMe.continueCredits", {
                action: selectedLabel
                  ? t("aroundMe.findType", { label: selectedLabel })
                  : t("common.continue"),
                n: creditCost,
              })}
            </Button>
          </div>
        </div>
      ) : null}

      {phase === "loading" ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
          <div className="relative">
            <div className="absolute inset-0 animate-ping rounded-full bg-primary/15" />
            <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary-tint text-primary ring-1 ring-primary/20">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
            </span>
          </div>
          <div>
            <p className="text-base font-semibold text-text">
              {t("aroundMe.scanning")}
            </p>
            <p className="mt-1 max-w-xs text-sm text-text-secondary">
              {selectedLabel
                ? t("aroundMe.findingType", { label: selectedLabel })
                : t("aroundMe.findingPlaces")}
            </p>
            {nearLabel ? (
              <p className="mt-2 text-xs font-medium text-primary">
                {t("aroundMe.near", { label: nearLabel })}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {phase === "results" ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text">
                {selectedTypeMeta && selectedLabel ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden>{selectedTypeMeta.icon}</span>
                    {selectedLabel}
                  </span>
                ) : (
                  t("aroundMe.nearbyPlaces")
                )}
              </p>
              <p className="mt-0.5 text-xs text-text-secondary">
                {t(
                  nearLabel
                    ? "aroundMe.resultsMetaNear"
                    : "aroundMe.resultsMeta",
                  {
                    places: t(
                      places.length === 1
                        ? "places.placeCount_one"
                        : "places.placeCount_other",
                      { count: places.length }
                    ),
                    km: radiusKm,
                    label: nearLabel ?? "",
                  }
                )}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              disabled={!canAfford || !selectedType || !origin}
              onClick={() => void handleSearchAgain()}
              className="shrink-0"
            >
              {t("aroundMe.again", { n: creditCost })}
            </Button>
          </div>

          {error ? (
            <div className="flex items-start gap-2 rounded-2xl border border-danger/25 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>{error}</p>
            </div>
          ) : null}

          {!canAfford ? (
            <p className="text-center text-xs text-text-secondary">
              {t("aroundMe.needCreditsAgain", {
                need: creditCost,
                have: aiCreditsBalance ?? 0,
              })}
            </p>
          ) : null}

          <ul className="space-y-3">
            {places.map((place, index) => {
              const saved = isAlreadySaved(place);
              const busy = addingId === place.googlePlaceId;
              const cover = placeCoverUrl(place);
              return (
                <li
                  key={place.googlePlaceId}
                  className="overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-sm"
                >
                  <div className="flex gap-0">
                    <div className="relative h-28 w-24 shrink-0 overflow-hidden bg-divider sm:h-32 sm:w-28">
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={cover}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-text-muted">
                          <MapPin className="h-5 w-5" aria-hidden />
                        </div>
                      )}
                      <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-surface-elevated text-[11px] font-bold tabular-nums text-primary shadow-sm ring-1 ring-primary/15">
                        {index + 1}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1 px-3 py-3.5 pr-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-semibold leading-snug text-text">
                            {place.title}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-text-secondary">
                            {place.city.name}
                            {place.country.name
                              ? `, ${place.country.name}`
                              : ""}
                            {place.category ? ` · ${place.category}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openInGoogleMaps(place)}
                            aria-label={t("aroundMe.openInMapsAria", {
                              title: place.title,
                            })}
                            title={t("aroundMe.openInMaps")}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-text-secondary transition-colors hover:border-primary/30 hover:bg-primary-tint hover:text-primary"
                          >
                            <Globe className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            disabled={saved || busy}
                            onClick={() => void handleAdd(place)}
                            aria-label={
                              saved
                                ? t("aroundMe.alreadySavedAria", {
                                    title: place.title,
                                  })
                                : t("aroundMe.addAria", { title: place.title })
                            }
                            title={
                              saved
                                ? t("aroundMe.added")
                                : t("aroundMe.addToMap")
                            }
                            className={cx(
                              "inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-colors",
                              saved
                                ? "border-primary/20 bg-primary-tint text-primary"
                                : "border-primary bg-primary text-white hover:bg-primary-hover",
                              (saved || busy) && "opacity-90",
                              busy && "cursor-wait"
                            )}
                          >
                            {busy ? (
                              <Loader2
                                className="h-4 w-4 animate-spin"
                                aria-hidden
                              />
                            ) : saved ? (
                              <Check className="h-4 w-4" aria-hidden />
                            ) : (
                              <Plus className="h-4 w-4" aria-hidden />
                            )}
                          </button>
                        </div>
                      </div>

                      <p className="mt-2.5 line-clamp-3 text-sm leading-relaxed text-text-secondary">
                        {place.description}
                      </p>

                      {place.ai.why ? (
                        <p className="mt-2 line-clamp-2 rounded-xl bg-surface px-2.5 py-1.5 text-xs leading-relaxed text-text-secondary">
                          <span className="font-medium text-text">
                            {t("aroundMe.why")}{" "}
                          </span>
                          {place.ai.why}
                        </p>
                      ) : null}

                      {place.price?.label ? (
                        <p className="mt-2 text-xs font-semibold text-text">
                          {place.price.label}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            className="mx-auto text-xs font-medium text-text-secondary underline-offset-2 hover:text-primary hover:underline"
            onClick={() => {
              setPhase("pick");
              setPlaces([]);
              setError(null);
            }}
          >
            {t("aroundMe.changeType")}
          </button>
        </div>
      ) : null}
    </Sheet>
  );
}
