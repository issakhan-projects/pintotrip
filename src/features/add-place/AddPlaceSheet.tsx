"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmModal, TextInput } from "@/components/ui";
import { useI18n, type TranslateFn } from "@/i18n";
import {
  Check,
  ChevronRight,
  Coins,
  ImageIcon,
  Info,
  Link2,
  Loader2,
  Lock,
  MapPin,
  Save,
  Search,
} from "lucide-react";
import { Timestamp } from "firebase/firestore";
import { Sheet } from "@/components/ui/Sheet";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { findPlace } from "@/services/functions";
import { uploadLocationDraftImage } from "@/services/storage";
import {
  assertCanAddLocation,
  createUserLocation,
} from "@/services/locations";
import { resolveUserLanguage } from "@/services/users";
import {
  AI_CREDIT_COSTS,
  isInsufficientAICreditsError,
} from "@/types/credits";
import {
  getConfidenceLevel,
  type AnalyzeLocationResult,
  type LocationAlternative,
} from "@/types/ai";
import { PLACE_CATEGORY_LABELS } from "@/types/trip-plan";
import { slugifyId, countryIdFromParts, isAsciiId, confidencePercent, cx } from "@/lib/utils";
import { resolveCountryCode } from "@/lib/countries";
import {
  withCityGooglePlaceId,
  resolveEnglishPlaceIds,
  englishPlaceIdsFromNames,
  geocodeByAddress,
  hasUsableMapCoords,
  cityCountryFromAddressComponents,
} from "@/lib/maps";
import {
  IMAGE_FILE_ACCEPT,
  ImageUploadError,
  prepareClientImage,
} from "@/lib/images";
import type { UserLocationCreateInput } from "@/types/location";
import {
  fetchPlacePhotoUrl,
  searchPlacesByName,
  type SearchedPlace,
} from "@/features/add-place/placeSearch";

type AddStep =
  | "menu"
  | "photo"
  | "link"
  | "analyzing"
  | "result"
  | "error"
  | "search"
  | "search-confirm";

/**
 * Temporary: Google Places Text Search for "Search by name" is disabled
 * to cut Places API cost. Flip to true after optimization / caching.
 */
const ENABLE_ADD_PLACE_NAME_SEARCH = false;

interface AddPlaceSheetProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  onSaved: () => void;
  /** Google Maps name search — gated by canUsePlaceNameSearch (Free off). */
  isPro?: boolean;
  /**
   * Enter map pick mode (like city intelligence): close this sheet and let the
   * user tap the main map to drop a pin.
   */
  onPickFromMap?: () => void;
  /**
   * When true (map page), after saving a place pan the map to that location.
   */
  offerMoveMapToDetected?: boolean;
  onMoveMapToDetected?: (coords: { lat: number; lon: number }) => void;
}

const ANALYZE_MESSAGE_KEYS = [
  "addPlace.analyzing.photo",
  "addPlace.analyzing.clues",
  "addPlace.analyzing.locations",
  "addPlace.analyzing.verifying",
] as const;

export function AddPlaceSheet({
  open,
  onClose,
  userId,
  onSaved,
  isPro = false,
  onPickFromMap,
  offerMoveMapToDetected = false,
  onMoveMapToDetected,
}: AddPlaceSheetProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [step, setStep] = useState<AddStep>("menu");
  const [jpegDataUrl, setJpegDataUrl] = useState<string | null>(null);
  const [jpegBlob, setJpegBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [link, setLink] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeLocationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchedPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<SearchedPlace | null>(
    null
  );
  const [manualTitle, setManualTitle] = useState("");
  const [manualCity, setManualCity] = useState("");
  const [manualCountry, setManualCountry] = useState("");
  const [manualNote, setManualNote] = useState("");

  useEffect(() => {
    if (!open) {
      setStep("menu");
      setJpegDataUrl(null);
      setJpegBlob(null);
      setPreviewUrl(null);
      setPreparingPhoto(false);
      setLink("");
      setImageUrl(null);
      setResult(null);
      setError(null);
      setSaving(false);
      setSearchQuery("");
      setSearchResults([]);
      setSearching(false);
      setSelectedPlace(null);
      setManualTitle("");
      setManualCity("");
      setManualCountry("");
      setManualNote("");
    }
  }, [open]);

  // Name search temporarily disabled — never stay on Places-backed steps.
  useEffect(() => {
    if (ENABLE_ADD_PLACE_NAME_SEARCH) return;
    if (step === "search" || step === "search-confirm") {
      setStep("menu");
    }
  }, [step]);

  useEffect(() => {
    if (!ENABLE_ADD_PLACE_NAME_SEARCH) return;
    if (step !== "search") return;
    if (!isPro) {
      setStep("menu");
      return;
    }
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchPlacesByName(q)
        .then((results) => {
          if (!cancelled) setSearchResults(results);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery, step, isPro]);

  useEffect(() => {
    if (step !== "analyzing") return;
    const id = window.setInterval(() => {
      setMessageIndex((i) => (i + 1) % ANALYZE_MESSAGE_KEYS.length);
    }, 2200);
    return () => window.clearInterval(id);
  }, [step]);

  function handleClose() {
    onClose();
  }

  async function onPickFile(next: File | null) {
    setJpegDataUrl(null);
    setJpegBlob(null);
    setPreviewUrl(null);
    setImageUrl(null);
    setError(null);
    if (!next) return;

    setPreparingPhoto(true);
    try {
      // Decode HEIC + compress to JPEG before preview / AI — never send raw originals.
      const prepared = await prepareClientImage(next);
      setJpegDataUrl(prepared.dataUrl);
      setJpegBlob(prepared.blob);
      setPreviewUrl(prepared.dataUrl);
    } catch (err) {
      setError(photoUploadErrorMessage(t, err));
    } finally {
      setPreparingPhoto(false);
    }
  }

  async function runAnalyze(
    request:
      | { type: "image"; imageUrl: string }
      | { type: "link"; link: string }
  ) {
    setError(null);
    setMessageIndex(0);
    try {
      await assertCanAddLocation(userId);
      setStep("analyzing");
      const language = await resolveUserLanguage(userId);
      const data = await findPlace({ ...request, language });
      setResult(data);
      setStep("result");
    } catch (err) {
      const message = parseAnalyzeError(t, err);
      setError(message);
      setStep("error");
    }
  }

  async function analyzePhoto() {
    if (!jpegDataUrl) return;
    setImageUrl(jpegDataUrl);
    await runAnalyze({ type: "image", imageUrl: jpegDataUrl });
  }

  async function analyzeLink() {
    const trimmed = link.trim();
    if (!trimmed) return;
    setImageUrl(null);
    await runAnalyze({ type: "link", link: trimmed });
  }

  async function acceptAlternative(alt: LocationAlternative) {
    if (!result) return;
    const address = [alt.title, alt.city, alt.country]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(", ");
    if (!address) {
      throw new Error(t("addPlace.resolveMatchFailed"));
    }
    const countryCode =
      resolveCountryCode(alt.countryId) ||
      resolveCountryCode(alt.country) ||
      undefined;
    const results = await geocodeByAddress(address, {
      language: "en",
      ...(countryCode ? { country: countryCode } : {}),
    });
    const location = results[0]?.geometry?.location;
    if (!location) {
      throw new Error(t("addPlace.resolveMatchFailed"));
    }
    const lat =
      typeof location.lat === "function" ? location.lat() : Number(location.lat);
    const lon =
      typeof location.lng === "function" ? location.lng() : Number(location.lng);
    if (!hasUsableMapCoords(lat, lon)) {
      throw new Error(t("addPlace.resolveMatchFailed"));
    }
    const fromGeocode = cityCountryFromAddressComponents(
      results[0]?.address_components
    );
    const cityName = alt.city?.trim() || fromGeocode.city || "";
    const countryName =
      alt.country.trim() || fromGeocode.country || countryCode || "";
    const resolvedCountryCode =
      fromGeocode.countryCode || countryCode || undefined;
    setResult({
      identified: true,
      title: alt.title,
      ...(alt.placeId ? { placeId: alt.placeId } : {}),
      description:
        [cityName, countryName].filter(Boolean).join(", ") || alt.title,
      lat,
      lon,
      why: result.why?.trim() || t("addPlace.selectedFromMatchesWhy"),
      city: cityName,
      ...(alt.cityId ? { cityId: alt.cityId } : {}),
      country: countryName,
      ...(alt.countryId ? { countryId: alt.countryId } : {}),
      ...(resolvedCountryCode ? { countryCode: resolvedCountryCode } : {}),
      confidence: alt.confidence,
      confidenceLevel: getConfidenceLevel(alt.confidence),
      locationConfidence: alt.confidence,
      verificationPerformed: result.verificationPerformed,
    });
  }

  async function savePlace() {
    if (!result?.identified) return;
    setSaving(true);
    try {
      let storedImageUrl = imageUrl;
      // Persist ≤300 KB JPEG to Storage (recompressed from the AI preview blob).
      if (jpegBlob) {
        const draftId = crypto.randomUUID();
        storedImageUrl = await uploadLocationDraftImage(
          userId,
          draftId,
          jpegBlob
        );
        setImageUrl(storedImageUrl);
      }

      const countryName = result.country.trim();
      const cityName = result.city.trim();
      const hasAsciiIds =
        isAsciiId(result.cityId) && isAsciiId(result.countryId);
      const englishIds = hasAsciiIds
        ? null
        : await resolveEnglishPlaceIds(result.lat, result.lon);
      // Always prefer ISO alpha-2 — AI may send slug "kazakhstan" instead of "kz".
      const countryCode =
        result.countryCode?.trim() ||
        resolveCountryCode(result.countryId) ||
        englishIds?.countryCode ||
        resolveCountryCode(countryName) ||
        undefined;
      const country = {
        id: countryIdFromParts(
          englishIds?.countryNameEn || countryName,
          countryCode
        ),
        name: countryName || countryCode || t("common.unknown"),
      };
      const cityId = isAsciiId(result.cityId)
        ? result.cityId!.trim().toLowerCase()
        : (englishIds?.cityId && isAsciiId(englishIds.cityId)
            ? englishIds.cityId
            : null) ||
          (isAsciiId(slugifyId(englishIds?.cityNameEn || ""))
            ? slugifyId(englishIds!.cityNameEn)
            : null) ||
          (isAsciiId(slugifyId(cityName)) ? slugifyId(cityName) : null);
      if (!isAsciiId(country.id) || !cityId) {
        throw new Error(t("addPlace.resolveIds"));
      }
      const city = await withCityGooglePlaceId(
        {
          id: cityId,
          name: cityName || t("common.unknown"),
        },
        country,
        { lat: result.lat, lon: result.lon }
      );
      const input: UserLocationCreateInput = {
        title: result.title,
        description: result.description,
        lat: result.lat,
        lon: result.lon,
        country,
        city,
        status: "want_to_visit",
        ...(result.category ? { category: result.category } : {}),
        images: storedImageUrl
          ? [{ url: storedImageUrl, source: "user" }]
          : [],
        confidence: result.confidence,
        locationConfidence: result.locationConfidence,
        exactCoordinatesConfidence: result.exactCoordinatesConfidence,
        ai: {
          why: result.why,
          model: "findPlace",
          processedAt: Timestamp.now(),
        },
        source: storedImageUrl
          ? { type: "image", url: storedImageUrl }
          : { type: "link", url: link.trim() },
      };
      await createUserLocation(userId, input);
      if (
        offerMoveMapToDetected &&
        Number.isFinite(result.lat) &&
        Number.isFinite(result.lon)
      ) {
        onMoveMapToDetected?.({ lat: result.lat, lon: result.lon });
      }
      onSaved();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("addPlace.saveFailed"));
      setStep("error");
    } finally {
      setSaving(false);
    }
  }

  function selectSearchedPlace(place: SearchedPlace) {
    setSelectedPlace(place);
    setManualTitle(place.title);
    setManualCity(place.cityName);
    setManualCountry(place.countryName);
    setManualNote("");
    setError(null);
    setStep("search-confirm");
    void fetchPlacePhotoUrl({
      title: place.title,
      cityName: place.cityName,
      countryName: place.countryName,
    }).then((photoUrl) => {
      if (!photoUrl) return;
      setSelectedPlace((prev) =>
        prev?.placeId === place.placeId ? { ...prev, photoUrl } : prev
      );
    });
  }

  async function saveSearchedPlace() {
    if (!selectedPlace || !isPro) return;
    if (!manualTitle.trim() || !manualCity.trim() || !manualCountry.trim()) {
      setError(t("addPlace.requiredFields"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const countryName = manualCountry.trim();
      const cityName = manualCity.trim();
      const [englishIds, photoUrl] = await Promise.all([
        (async () =>
          englishPlaceIdsFromNames(
            cityName,
            countryName,
            resolveCountryCode(countryName) || undefined
          ) ??
          (await resolveEnglishPlaceIds(
            selectedPlace.lat,
            selectedPlace.lon
          )))(),
        selectedPlace.photoUrl
          ? Promise.resolve(selectedPlace.photoUrl)
          : fetchPlacePhotoUrl({
              title: manualTitle.trim() || selectedPlace.title,
              cityName: cityName,
              countryName: countryName,
            }),
      ]);
      const countryCode =
        englishIds?.countryCode ||
        resolveCountryCode(countryName) ||
        undefined;
      const countryData = {
        id: countryIdFromParts(
          englishIds?.countryNameEn || countryName,
          countryCode
        ),
        name: countryName,
      };
      const cityId =
        (englishIds?.cityId && isAsciiId(englishIds.cityId)
          ? englishIds.cityId
          : null) ||
        (isAsciiId(slugifyId(englishIds?.cityNameEn || ""))
          ? slugifyId(englishIds!.cityNameEn)
          : null) ||
        (isAsciiId(slugifyId(cityName)) ? slugifyId(cityName) : null);
      if (!isAsciiId(countryData.id) || !cityId) {
        throw new Error(t("addPlace.resolveIds"));
      }
      const cityData = await withCityGooglePlaceId(
        {
          id: cityId,
          name: cityName,
        },
        countryData,
        { lat: selectedPlace.lat, lon: selectedPlace.lon }
      );
      const note = manualNote.trim();
      await createUserLocation(userId, {
        title: manualTitle.trim(),
        description:
          note || selectedPlace.address || t("addPlace.addedFromSearch"),
        ...(note ? { note } : {}),
        lat: selectedPlace.lat,
        lon: selectedPlace.lon,
        country: countryData,
        city: cityData,
        status: "want_to_visit",
        images: photoUrl
          ? [{ url: photoUrl, source: "external" }]
          : [],
        confidence: 1,
        ai: {
          why: t("addPlace.matchedFromSearch", {
            address: selectedPlace.address,
          }),
          model: "manual",
          processedAt: Timestamp.now(),
        },
        source: { type: "manual" },
      });
      if (
        offerMoveMapToDetected &&
        Number.isFinite(selectedPlace.lat) &&
        Number.isFinite(selectedPlace.lon)
      ) {
        onMoveMapToDetected?.({
          lat: selectedPlace.lat,
          lon: selectedPlace.lon,
        });
      }
      onSaved();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("addPlace.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const title =
    step === "menu"
      ? t("addPlace.title.menu")
      : step === "photo"
        ? t("addPlace.title.photo")
        : step === "link"
          ? t("addPlace.title.link")
          : step === "analyzing"
            ? t("addPlace.title.analyzing")
            : step === "result"
              ? result?.identified
                ? t("addPlace.title.found")
                : t("addPlace.title.notIdentified")
              : step === "search"
                ? t("addPlace.title.search")
                : step === "search-confirm"
                  ? t("addPlace.title.save")
                  : t("addPlace.title.notIdentified");

  return (
    <Sheet open={open} onClose={handleClose} title={title} size="lg">
      {step === "menu" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-secondary">
            {t("addPlace.discoverPrompt")}
          </p>
          <div className="flex gap-2 rounded-xl border border-primary/15 bg-primary-tint px-3 py-2.5 text-xs text-primary">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">{t("addPlace.hint")}</p>
              <p className="mt-0.5 text-primary/80">
                {t("addPlace.hintBody")}
              </p>
            </div>
          </div>
          <MenuOptionCard
            variant="photo"
            icon={<ImageIcon className="h-5 w-5" />}
            title={t("addPlace.menu.photo")}
            subtitle={t("addPlace.menu.photoSub")}
            tags={[
              { label: t("addPlace.chips.landmarks"), checked: true },
              { label: t("addPlace.chips.buildings"), checked: true },
              { label: t("addPlace.chips.landscapes"), checked: true },
            ]}
            visual={<PhotoStackVisual />}
            onClick={() => setStep("photo")}
          />
          <MenuOptionCard
            variant="link"
            icon={<MapPin className="h-5 w-5" />}
            title={t("addPlace.menu.map")}
            subtitle={t("addPlace.menu.mapSub")}
            tags={[
              { label: t("addPlace.chips.pin") },
              { label: t("addPlace.chips.anySpot") },
              { label: t("addPlace.chips.manual") },
            ]}
            visual={<MapPickVisual />}
            onClick={() => {
              handleClose();
              onPickFromMap?.();
            }}
          />
          <MenuOptionCard
            variant="link"
            icon={<Link2 className="h-5 w-5" />}
            title={t("addPlace.menu.link")}
            subtitle={t("addPlace.menu.linkSub")}
            tags={[
              { label: t("addPlace.chips.instagram") },
              { label: t("addPlace.chips.tiktok") },
              { label: t("addPlace.chips.googleMaps") },
              { label: t("addPlace.chips.blog") },
              { label: t("addPlace.chips.other") },
            ]}
            visual={<LinkInputVisual />}
            onClick={() => setStep("link")}
          />
          {ENABLE_ADD_PLACE_NAME_SEARCH ? (
            <MenuOptionCard
              variant="link"
              icon={
                isPro ? (
                  <Search className="h-5 w-5" />
                ) : (
                  <Lock className="h-5 w-5" />
                )
              }
              title={t("addPlace.menu.search")}
              subtitle={
                isPro
                  ? t("addPlace.menu.searchSub")
                  : t("addPlace.menu.searchPro")
              }
              tags={
                isPro
                  ? [
                      { label: t("addPlace.chips.landmarks") },
                      { label: t("addPlace.chips.cities") },
                      { label: t("addPlace.chips.restaurants") },
                    ]
                  : [{ label: t("addPlace.chips.pro") }]
              }
              visual={<SearchInputVisual />}
              onClick={() => {
                if (isPro) {
                  setStep("search");
                  return;
                }
                handleClose();
                router.push("/pricing");
              }}
            />
          ) : null}
        </div>
      ) : null}

      {step === "photo" ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">
            {t("addPlace.photoPrompt")}
          </p>
          <label
            className={cx(
              "flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface px-4 py-10 text-center transition-colors hover:border-primary hover:bg-primary-tint/40"
            )}
          >
            <input
              type="file"
              accept={IMAGE_FILE_ACCEPT}
              className="sr-only"
              disabled={preparingPhoto}
              onChange={(e) => {
                void onPickFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt={t("addPlace.altSelected")}
                className="mb-3 max-h-56 rounded-xl object-cover"
              />
            ) : preparingPhoto ? (
              <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" />
            ) : (
              <ImageIcon className="mb-3 h-8 w-8 text-primary" />
            )}
            <span className="text-sm font-medium text-text">
              {preparingPhoto
                ? t("addPlace.preparing")
                : previewUrl
                  ? t("addPlace.change")
                  : t("addPlace.upload")}
            </span>
            <span className="mt-1 text-xs text-text-muted">
              {t("addPlace.formats")}
            </span>
          </label>
          {error && step === "photo" ? (
            <p className="text-sm text-error">{error}</p>
          ) : null}
          <div className="rounded-xl bg-surface px-3 py-3 text-xs text-text-secondary">
            <p className="font-medium text-text">
              {t("addPlace.photoTipsTitle")}
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              <li>{t("addPlace.photoTips.visible")}</li>
              <li>{t("addPlace.photoTips.avoid")}</li>
            </ul>
          </div>
          <Button
            icon={Search}
            disabled={!jpegDataUrl || preparingPhoto}
            color="neutral"
            onClick={() => void analyzePhoto()}
            className="w-full disabled:!opacity-40"
          >
            <span className="inline-flex items-center gap-2">
              {t("addPlace.analyze")}
              <AiCreditCostBadge credits={AI_CREDIT_COSTS.findPlace} />
            </span>
          </Button>
          <button
            type="button"
            className="text-sm text-text-secondary"
            onClick={() => setStep("menu")}
          >
            {t("common.back")}
          </button>
        </div>
      ) : null}

      {step === "link" ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">
            {t("addPlace.linkPrompt")}
          </p>
          <TextInput
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder={t("addPlace.linkPlaceholder")}
          />
          <Button
            icon={Search}
            disabled={!link.trim()}
            onClick={() => void analyzeLink()}
            className="w-full disabled:!opacity-40"
            color="neutral"
          >
            <span className="inline-flex items-center gap-2">
              {t("addPlace.analyze")}
              <AiCreditCostBadge credits={AI_CREDIT_COSTS.findPlace} />
            </span>
          </Button>
          <button
            type="button"
            className="text-sm text-text-secondary"
            onClick={() => setStep("menu")}
          >
            {t("common.back")}
          </button>
        </div>
      ) : null}

      {step === "analyzing" ? (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-base font-medium text-text">
            {t(ANALYZE_MESSAGE_KEYS[messageIndex])}
          </p>
          <p className="text-sm text-text-muted">{t("addPlace.analyzingHint")}</p>
        </div>
      ) : null}

      {step === "result" && result ? (
        <AiResultView
          result={result}
          imageUrl={imageUrl ?? previewUrl}
          saving={saving}
          onSave={() => void savePlace()}
          onAcceptAlternative={(alt) => acceptAlternative(alt)}
          onReject={() => {
            setResult(null);
            setStep("photo");
          }}
        />
      ) : null}

      {step === "error" ? (
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <p className="text-base font-medium text-text">
            {t("addPlace.couldNotIdentify")}
          </p>
          <p className="text-sm text-text-secondary">{error}</p>
          <Button
            onClick={() => setStep("photo")}
            className="w-full"
            color="neutral"
          >
            {t("addPlace.tryAnotherPhoto")}
          </Button>
          <button
            type="button"
            className="text-sm text-text-secondary"
            onClick={() => setStep("menu")}
          >
            {t("addPlace.backToOptions")}
          </button>
        </div>
      ) : null}

      {step === "search" ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">
            {t("addPlace.searchPrompt")}
          </p>
          <TextInput
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("addPlace.searchPlaceholder")}
            autoFocus
          />
          {searching ? (
            <div className="flex items-center gap-2 py-2 text-sm text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("addPlace.searching")}
            </div>
          ) : null}
          {!searching &&
          searchQuery.trim().length >= 2 &&
          searchResults.length === 0 ? (
            <p className="text-sm text-text-muted">
              {t("addPlace.noMatches")}
            </p>
          ) : null}
          {searchResults.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {searchResults.map((place) => (
                <li key={place.placeId}>
                  <button
                    type="button"
                    onClick={() => selectSearchedPlace(place)}
                    className="flex w-full items-start gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 text-left transition-colors hover:border-primary/30 hover:bg-primary-tint/30"
                  >
                    <Search className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-text">
                        {place.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-text-secondary">
                        {place.address}
                      </span>
                    </span>
                    <ChevronRight
                      className="mt-0.5 h-4 w-4 shrink-0 text-text-muted"
                      aria-hidden
                    />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            className="text-sm text-text-secondary"
            onClick={() => setStep("menu")}
          >
            {t("common.back")}
          </button>
        </div>
      ) : null}

      {step === "search-confirm" && selectedPlace ? (
        <div className="flex flex-col gap-3">
          {selectedPlace.photoUrl ? (
            <div className="overflow-hidden rounded-xl bg-divider">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedPlace.photoUrl}
                alt=""
                className="h-40 w-full object-cover"
              />
            </div>
          ) : null}
          <p className="text-xs text-text-muted">{selectedPlace.address}</p>
          <TextInput
            placeholder={t("addPlace.fields.title")}
            value={manualTitle}
            onChange={(e) => setManualTitle(e.target.value)}
          />
          <TextInput
            placeholder={t("addPlace.fields.city")}
            value={manualCity}
            onChange={(e) => setManualCity(e.target.value)}
          />
          <TextInput
            placeholder={t("addPlace.fields.country")}
            value={manualCountry}
            onChange={(e) => setManualCountry(e.target.value)}
          />
          <TextInput
            placeholder={t("addPlace.fields.note")}
            value={manualNote}
            onChange={(e) => setManualNote(e.target.value)}
          />
          {error ? <p className="text-sm text-error">{error}</p> : null}
          <Button
            loading={saving}
            icon={Save}
            color="primary"
            onClick={() => void saveSearchedPlace()}
            className="w-full"
          >
            {t("addPlace.title.save")}
          </Button>
          <button
            type="button"
            className="text-sm text-text-secondary"
            onClick={() => {
              setSelectedPlace(null);
              setError(null);
              setStep("search");
            }}
          >
            {t("common.back")}
          </button>
        </div>
      ) : null}
    </Sheet>
  );
}

function MenuOptionCard({
  icon,
  title,
  subtitle,
  tags,
  visual,
  onClick,
  variant,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  tags: Array<{ label: string; checked?: boolean }>;
  visual?: ReactNode;
  onClick: () => void;
  variant: "photo" | "link";
}) {
  const isPhoto = variant === "photo";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "group flex w-full items-center gap-3 overflow-hidden rounded-2xl border px-3.5 py-3.5 text-left transition-all",
        "active:scale-[0.99]",
        isPhoto
          ? "border-primary/25 bg-gradient-to-br from-primary-tint via-primary-tint/80 to-white hover:border-primary/40"
          : "border-border bg-gradient-to-br from-surface via-surface to-white hover:border-text-muted/30"
      )}
    >
      <span
        className={cx(
          "flex h-11 w-11 shrink-0 items-center justify-center self-start rounded-xl shadow-sm",
          isPhoto
            ? "bg-primary text-white"
            : "bg-white text-text-secondary ring-1 ring-border"
        )}
      >
        {icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold tracking-tight text-text">
          {title}
        </span>
        <span
          className={cx(
            "mt-0.5 block text-sm",
            isPhoto ? "text-primary/70" : "text-text-secondary"
          )}
        >
          {subtitle}
        </span>
        {tags.length > 0 ? (
          <span className="mt-2.5 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag.label}
                className={cx(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  isPhoto
                    ? "bg-white/85 text-primary ring-1 ring-primary/15"
                    : "bg-white text-text-secondary ring-1 ring-border"
                )}
              >
                {tag.checked ? (
                  <Check
                    className="h-3 w-3 shrink-0"
                    strokeWidth={2.5}
                    aria-hidden
                  />
                ) : null}
                {tag.label}
              </span>
            ))}
          </span>
        ) : null}
      </span>

      {visual ? (
        <span className="hidden shrink-0 sm:block" aria-hidden>
          {visual}
        </span>
      ) : null}

      <ChevronRight
        className={cx(
          "h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5",
          isPhoto ? "text-primary" : "text-text-muted"
        )}
        aria-hidden
      />
    </button>
  );
}

function PhotoStackVisual() {
  return (
    <span className="relative mr-0.5 block h-[72px] w-[84px]">
      <span className="absolute left-0 top-3 h-12 w-10 -rotate-[16deg] overflow-hidden rounded-[6px] border-2 border-white bg-surface shadow-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://i.pinimg.com/736x/3f/a5/96/3fa596f6d0a60b558a5ff24d65ba3dcc.jpg"
          alt=""
          className="h-full w-full object-cover opacity-75 blur-[0.3px]"
        />
      </span>
      <span className="absolute right-0 top-2 h-12 w-10 rotate-[14deg] overflow-hidden rounded-[6px] border-2 border-white bg-surface shadow-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://i.pinimg.com/736x/35/ce/51/35ce5159a316b6232066a28b2919e0d2.jpg"
          alt=""
          className="h-full w-full object-cover opacity-75 blur-[0.3px]"
        />
      </span>
      <span className="absolute left-1/2 top-0 z-[1] h-[58px] w-12 -translate-x-1/2 overflow-hidden rounded-[6px] border-2 border-white bg-surface shadow-lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://i.pinimg.com/1200x/c9/1e/83/c91e83e79cf4e7c4e4331810c2fe7e5e.jpg"
          alt=""
          className="h-full w-full object-cover"
        />
      </span>
    </span>
  );
}

function LinkInputVisual() {
  const { t } = useI18n();
  return (
    <span className="flex h-[56px] w-[108px] items-center justify-center rounded-xl bg-[#eef0f3] p-2 shadow-sm">
      <span className="flex w-full items-center gap-1.5 rounded-lg border border-border bg-white px-2 py-2 shadow-sm">
        <Link2 className="h-3 w-3 shrink-0 text-text-muted" aria-hidden />
        <span className="truncate text-[10px] text-text-muted">
          {t("addPlace.linkPlaceholder")}
        </span>
      </span>
    </span>
  );
}

function MapPickVisual() {
  return (
    <span className="relative mr-0.5 flex h-[72px] w-[84px] items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-primary-tint via-white to-surface shadow-sm ring-1 ring-border">
      <span className="absolute inset-x-3 top-4 h-px bg-border/80" />
      <span className="absolute inset-x-5 top-8 h-px bg-border/60" />
      <span className="absolute inset-y-3 left-5 w-px bg-border/70" />
      <span className="absolute inset-y-5 left-10 w-px bg-border/50" />
      <MapPin className="relative z-[1] h-7 w-7 text-primary drop-shadow-sm" />
    </span>
  );
}

function SearchInputVisual() {
  const { t } = useI18n();

  return (
    <span className="flex h-[56px] w-[108px] items-center justify-center rounded-xl bg-[#eef0f3] p-2 shadow-sm">
      <span className="flex w-full items-center gap-1.5 rounded-lg border border-border bg-white px-2 py-2 shadow-sm">
        <Search className="h-3 w-3 shrink-0 text-text-muted" aria-hidden />
        <span className="truncate text-[10px] text-text-muted">
          {t("addPlace.searchEllipsis")}
        </span>
      </span>
    </span>
  );
}

function AiResultView({
  result,
  imageUrl,
  saving,
  onSave,
  onAcceptAlternative,
  onReject,
}: {
  result: AnalyzeLocationResult;
  imageUrl: string | null;
  saving: boolean;
  onSave: () => void;
  onAcceptAlternative: (alt: LocationAlternative) => Promise<void>;
  onReject: () => void;
}) {
  const { t } = useI18n();
  const [pendingAlt, setPendingAlt] = useState<LocationAlternative | null>(
    null
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resolvingAlt, setResolvingAlt] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  if (!result.identified) {
    const alternatives = (result.alternatives ?? []).slice(0, 3);
    return (
      <div className="flex flex-col gap-4">
        {imageUrl ? (
          <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={t("addPlace.altUploaded")}
              className="h-full w-full object-cover"
            />
          </div>
        ) : null}

        <div>
          <h3 className="text-xl font-semibold text-text">
            {t("addPlace.couldNotIdentifyConfident")}
          </h3>
          {result.why ? (
            <p className="mt-2 text-sm text-text-secondary">{result.why}</p>
          ) : null}
        </div>

        {alternatives.length > 0 ? (
          <div className="rounded-xl bg-surface px-3 py-3">
            <p className="text-sm font-medium text-text">
              {t("addPlace.possibleMatches")}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              {t("addPlace.selectPossibleMatch")}
            </p>
            <ul className="mt-2 space-y-2">
              {alternatives.map((alt) => (
                <li key={`${alt.title}-${alt.country}`}>
                  <button
                    type="button"
                    disabled={resolvingAlt}
                    onClick={() => {
                      setResolveError(null);
                      setPendingAlt(alt);
                      setConfirmOpen(true);
                    }}
                    className={cx(
                      "flex w-full items-center gap-3 rounded-xl border border-border bg-surface-elevated px-3 py-2.5 text-left transition-colors",
                      "hover:border-primary/40 hover:bg-primary-tint/40",
                      "disabled:pointer-events-none disabled:opacity-60"
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-text">
                        {alt.title}
                      </span>
                      {alt.city || alt.country ? (
                        <span className="mt-0.5 block text-xs text-text-secondary">
                          {[alt.city, alt.country].filter(Boolean).join(", ")}
                        </span>
                      ) : null}
                    </span>
                    {alt.confidence > 0 ? (
                      <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
                        {t("addPlace.confidencePercent", {
                          n: confidencePercent(alt.confidence),
                        })}
                      </span>
                    ) : null}
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-text-muted"
                      aria-hidden
                    />
                  </button>
                </li>
              ))}
            </ul>
            {resolveError ? (
              <p className="mt-2 text-sm text-error">{resolveError}</p>
            ) : null}
          </div>
        ) : null}

        <Button
          variant="secondary"
          onClick={onReject}
          disabled={resolvingAlt}
          className="btn-secondary w-full"
        >
          {t("addPlace.tryAnotherPhoto")}
        </Button>

        <ConfirmModal
          open={confirmOpen && Boolean(pendingAlt)}
          title={t("addPlace.confirmPossibleMatchTitle")}
          description={t("addPlace.confirmPossibleMatchBody", {
            title: pendingAlt?.title ?? "",
          })}
          confirmLabel={t("addPlace.confirmPossibleMatch")}
          cancelLabel={t("common.cancel")}
          loading={resolvingAlt}
          onCancel={() => {
            if (resolvingAlt) return;
            setConfirmOpen(false);
            setPendingAlt(null);
          }}
          onConfirm={async () => {
            if (!pendingAlt) return;
            setResolvingAlt(true);
            setResolveError(null);
            try {
              await onAcceptAlternative(pendingAlt);
              setConfirmOpen(false);
              setPendingAlt(null);
            } catch (err) {
              setConfirmOpen(false);
              setPendingAlt(null);
              setResolveError(
                err instanceof Error && err.message.trim()
                  ? err.message
                  : t("addPlace.resolveMatchFailed")
              );
            } finally {
              setResolvingAlt(false);
            }
          }}
        />
      </div>
    );
  }

  const identifiedConfidence = formatIdentifiedConfidence(t, result.confidence);
  const showConfidenceDetail =
    result.confidenceLevel !== "high" || Boolean(identifiedConfidence.detail);

  return (
    <div className="flex flex-col gap-4">
      {imageUrl ? (
        <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-surface">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={result.title}
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}

      <div>
        <p className="text-sm font-medium text-primary">
          {identifiedConfidence.label}
        </p>
        <h3 className="mt-1 text-xl font-semibold text-text">{result.title}</h3>
        <p className="mt-1 text-sm text-text-secondary">
          {[result.city, result.country].filter(Boolean).join(", ")}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge status="want_to_visit" />
          {result.category ? (
            <span className="rounded-full bg-primary-tint px-2.5 py-0.5 text-[11px] font-medium text-primary">
              {PLACE_CATEGORY_LABELS[result.category] ?? result.category}
            </span>
          ) : null}
        </div>
        {showConfidenceDetail && identifiedConfidence.detail ? (
          <p className="mt-1 text-sm text-warning">{identifiedConfidence.detail}</p>
        ) : null}
      </div>

      <p className="text-sm leading-relaxed text-text">{result.description}</p>

      <div className="rounded-xl bg-surface px-3 py-3">
        <p className="text-sm font-medium text-text">
          {t("addPlace.whyThisPlace")}
        </p>
        <p className="mt-1 text-sm text-text-secondary">{result.why}</p>
      </div>

      <Button
        loading={saving}
        onClick={onSave}
        icon={Save}
        color="primary"
        className="btn-primary w-full"
      >
        {t("common.save")}
      </Button>
      <Button
        variant="secondary"
        onClick={onReject}
        className="btn-secondary w-full"
      >
        {t("addPlace.notThisPlace")}
      </Button>
    </div>
  );
}

function AiCreditCostBadge({ credits }: { credits: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-warning">
      <Coins className="h-3 w-3" aria-hidden />
      {credits}
    </span>
  );
}

function photoUploadErrorMessage(t: TranslateFn, err: unknown): string {
  if (err instanceof ImageUploadError) {
    return t(`addPlace.uploadError.${err.code}`);
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return t("addPlace.uploadError.unreadable");
}

function formatIdentifiedConfidence(
  t: TranslateFn,
  confidence: number
): { label: string; detail?: string } {
  if (confidence >= 0.85) {
    return { label: t("places.confidence.found") };
  }
  if (confidence >= 0.7) {
    return {
      label: t("places.confidence.likely"),
      detail: t("addPlace.confidencePercent", {
        n: confidencePercent(confidence),
      }),
    };
  }
  return {
    label: t("places.confidence.uncertain"),
    detail: t("places.confidence.unconfirmed"),
  };
}

function parseAnalyzeError(t: TranslateFn, err: unknown): string {
  if (isInsufficientAICreditsError(err)) {
    return t("credits.insufficientDetail", {
      message: err.message,
      required: err.requiredCredits,
      available: err.availableCredits,
    });
  }
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code: string }).code);
    if (code.includes("unimplemented")) {
      return t("addPlace.error.notEnabled");
    }
    if (code.includes("unauthenticated")) {
      return t("addPlace.error.signInAgain");
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return t("addPlace.error.analyzeGeneric");
}
