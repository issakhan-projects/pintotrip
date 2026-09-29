"use client";

import { useEffect, useRef, useState } from "react";
import {
  Binoculars,
  Building2,
  Check,
  CircleDot,
  Coffee,
  Coins,
  FerrisWheel,
  ImagePlus,
  Images,
  Landmark,
  Loader2,
  MapPin,
  MapPinned,
  Moon,
  MoreHorizontal,
  Mountain,
  NotebookPen,
  Percent,
  Share2,
  ShoppingBag,
  Sparkles,
  Store,
  Tag,
  TrainFront,
  Trees,
  Trash2,
  UtensilsCrossed,
  Waves,
  X,
  type LucideIcon,
} from "lucide-react";
import { Timestamp } from "firebase/firestore";
import { Button, DeleteConfirmModal, TextInput } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { SavedLocation } from "@/hooks/useLocations";
import type {
  LocationAiMetadata,
  LocationImage,
  LocationStatus,
} from "@/types/location";
import {
  PLACE_CATEGORY_LABELS,
  type PlaceCategory,
} from "@/types/trip-plan";
import {
  AI_CREDIT_COSTS,
  formatInsufficientCreditsMessage,
  isInsufficientAICreditsError,
} from "@/types/credits";
import { getCityIntelligenceForPlace } from "@/services/functions";
import { getUserProfile } from "@/services/users";
import {
  deleteStorageObjectByUrl,
  uploadLocationImage,
} from "@/services/storage";
import { CityIntelligenceResultsView } from "@/features/city/CityIntelligenceResultsView";
import { buildTravelInfoDescription } from "@/features/city/travelInfoDescription";
import type { CityIntelligenceResult } from "@/types/city-intelligence";
import {
  IMAGE_FILE_ACCEPT,
  imageUploadErrorMessage,
} from "@/lib/images";
import {
  fetchSuggestedWikimediaPlacePhoto,
  wikimediaPhotoUrlExcludeId,
} from "@/lib/wikimedia";
import {
  confidencePercent,
  formatConfidenceCopy,
  cx,
} from "@/lib/utils";

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
  neighborhood: Building2,
  transport: TrainFront,
  other: MapPin,
};

const CITY_INTEL_CREDITS = AI_CREDIT_COSTS.getCityIntelligence;

interface PlacePreviewSheetProps {
  place: SavedLocation | null;
  open: boolean;
  onClose: () => void;
  /** Required to call City Intelligence and fill location info. */
  userId?: string;
  onUpdateStatus?: (status: LocationStatus) => Promise<void>;
  onSaveNote?: (note: string) => Promise<void>;
  /**
   * Persist City Intelligence summary onto this location
   * (description / note / ai metadata).
   */
  onSaveTravelInfo?: (patch: {
    description: string;
    note: string;
    ai: LocationAiMetadata;
  }) => Promise<void>;
  /** Persist updated image list after a user upload. */
  onSaveImages?: (images: LocationImage[]) => Promise<void>;
  onDelete?: () => Promise<void>;
  onViewOnMap?: (place: SavedLocation) => void;
  /**
   * When false (Free / Plus), skip Google Places / Maps photo URLs so the
   * sheet does not trigger Place Photos billing. User uploads and Wikimedia stay.
   * Pro should pass true.
   */
  allowGooglePlacePhotos?: boolean;
}

/** Billable Place Photos / Maps image hosts — avoid loading on Free/Plus. */
function isGoogleMapsPhotoUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "maps.googleapis.com" ||
      host === "places.googleapis.com" ||
      host.endsWith(".maps.googleapis.com")
    );
  } catch {
    return (
      url.includes("maps.googleapis.com") ||
      url.includes("places.googleapis.com")
    );
  }
}

export function PlacePreviewSheet({
  place,
  open,
  onClose,
  userId,
  onUpdateStatus,
  onSaveNote,
  onSaveTravelInfo,
  onSaveImages,
  onDelete,
  onViewOnMap,
  allowGooglePlacePhotos = false,
}: PlacePreviewSheetProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fillingInfo, setFillingInfo] = useState(false);
  const [fillError, setFillError] = useState<string | null>(null);
  const [fillSuccess, setFillSuccess] = useState(false);
  const [intelData, setIntelData] = useState<CityIntelligenceResult | null>(
    null
  );
  const [intelCitizenship, setIntelCitizenship] = useState("");
  const [previewTab, setPreviewTab] = useState<"main" | "city">("main");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [addingStockPhoto, setAddingStockPhoto] = useState(false);
  const [removingPhotoUrl, setRemovingPhotoUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoBusy = uploadingPhoto || addingStockPhoto;

  useEffect(() => {
    setNote(place?.note ?? "");
  }, [place]);

  useEffect(() => {
    setMenuOpen(false);
    setNoteOpen(false);
    setConfirmDeleteOpen(false);
    setDeleting(false);
    setStatusBusy(false);
    setFillingInfo(false);
    setFillError(null);
    setFillSuccess(false);
    setIntelData(null);
    setIntelCitizenship("");
    setPreviewTab("main");
    setUploadingPhoto(false);
    setAddingStockPhoto(false);
    setRemovingPhotoUrl(null);
    setPhotoError(null);
  }, [place?.id, open]);

  // Reload rich city tips when City info tab is open and tips were saved before.
  useEffect(() => {
    if (!open || !userId || previewTab !== "city") return;
    if (!place || place.ai?.model !== "city-intelligence") return;
    if (intelData) return;

    const cityName = place.city.name;
    const countryName = place.country.name;
    const lat = place.lat;
    const lon = place.lon;
    const cityId = place.city.id;
    const countryId = place.country.id;

    let cancelled = false;
    setFillingInfo(true);
    setFillError(null);

    void (async () => {
      try {
        const profile = await getUserProfile(userId);
        const citizenship = profile?.citizenship?.trim() ?? "";
        if (!citizenship) {
          if (!cancelled) {
            setFillError(
              "Add your citizenship in Profile to reload personalized city tips."
            );
            setFillingInfo(false);
          }
          return;
        }

        const language =
          profile?.preferences?.language ||
          (typeof navigator !== "undefined"
            ? navigator.language.split("-")[0] || "en"
            : "en");

        const intel = await getCityIntelligenceForPlace({
          city: cityName,
          country: countryName,
          lat,
          lon,
          cityId,
          countryId,
          userCountry: citizenship,
          userCurrency: profile?.currency,
          language,
        });

        if (cancelled) return;
        setIntelData(intel);
        setIntelCitizenship(citizenship);
      } catch (err: unknown) {
        if (cancelled) return;
        if (isInsufficientAICreditsError(err)) {
          setFillError(formatInsufficientCreditsMessage(err));
        } else if (err instanceof Error && err.message) {
          setFillError(err.message);
        } else {
          setFillError("Could not load city tips.");
        }
      } finally {
        if (!cancelled) setFillingInfo(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, place?.id, place?.ai?.model, userId, previewTab, intelData]);

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

  if (!place) return null;

  const current = place;
  const images = current.images
    .filter((img) => {
      const url = img.url?.trim();
      if (!url) return false;
      if (!allowGooglePlacePhotos && isGoogleMapsPhotoUrl(url)) return false;
      return true;
    })
    .slice(0, 2);
  const confidenceValue =
    typeof current.confidence === "number" && Number.isFinite(current.confidence)
      ? current.confidence
      : 0;
  const confidence = formatConfidenceCopy(confidenceValue);
  const confidencePct = confidencePercent(confidenceValue);
  const CategoryIcon = current.category
    ? (PLACE_CATEGORY_ICONS[current.category] ?? MapPin)
    : null;
  const canFillTravelInfo = Boolean(userId && onSaveTravelInfo);
  const canManagePhotos = Boolean(userId && onSaveImages);

  async function handleAddPhoto(fileList: FileList | null) {
    if (!userId || !onSaveImages || !fileList?.[0] || photoBusy) return;
    const file = fileList[0];
    if (photoInputRef.current) photoInputRef.current.value = "";

    setUploadingPhoto(true);
    setPhotoError(null);
    try {
      // uploadLocationImage compresses to JPEG ≤ 300 KB (Storage rules enforce the same).
      const imageKey = crypto.randomUUID();
      const url = await uploadLocationImage(
        userId,
        current.id,
        imageKey,
        file
      );
      const next: LocationImage[] = [
        { url, source: "user" },
        ...current.images,
      ];
      await onSaveImages(next);
    } catch (err: unknown) {
      setPhotoError(imageUploadErrorMessage(err));
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleAddWikimediaPhoto() {
    if (!userId || !onSaveImages || photoBusy || removingPhotoUrl) return;

    setAddingStockPhoto(true);
    setPhotoError(null);
    try {
      const exclude = new Set(
        current.images.map((img) => wikimediaPhotoUrlExcludeId(img.url))
      );
      // Temporary: Wikimedia Commons instead of Pexels (always English query).
      const photo = await fetchSuggestedWikimediaPlacePhoto({
        title: current.title,
        cityName: current.city.name,
        countryName: current.country.name,
        lat: current.lat,
        lon: current.lon,
        excludePlaceIds: exclude,
      });
      if (!photo?.photoUrl) {
        setPhotoError("No Wikimedia Commons photo found for this place.");
        return;
      }
      const next: LocationImage[] = [
        { url: photo.photoUrl, source: "external" },
        ...current.images,
      ];
      await onSaveImages(next);
    } catch (err: unknown) {
      setPhotoError(
        err instanceof Error && err.message
          ? err.message
          : "Could not add a Wikimedia photo. Please try again."
      );
    } finally {
      setAddingStockPhoto(false);
    }
  }

  async function handleRemovePhoto(image: LocationImage) {
    if (
      !userId ||
      !onSaveImages ||
      (image.source !== "user" && image.source !== "external") ||
      removingPhotoUrl ||
      photoBusy
    ) {
      return;
    }

    setRemovingPhotoUrl(image.url);
    setPhotoError(null);
    try {
      const next = current.images.filter((img) => img.url !== image.url);
      await onSaveImages(next);
      if (image.source === "user") {
        await deleteStorageObjectByUrl(image.url);
      }
    } catch (err: unknown) {
      setPhotoError(
        err instanceof Error && err.message
          ? err.message
          : "Could not remove photo. Please try again."
      );
    } finally {
      setRemovingPhotoUrl(null);
    }
  }

  async function handleShare() {
    const text = [
      current.title,
      `${current.city.name}, ${current.country.name}`,
      current.description,
    ]
      .filter(Boolean)
      .join("\n");

    setShareBusy(true);
    try {
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function"
      ) {
        await navigator.share({
          title: current.title,
          text,
        });
        return;
      }
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      /* user cancelled share sheet or clipboard failed */
    } finally {
      setShareBusy(false);
    }
  }

  async function handleSaveNote() {
    if (!onSaveNote) return;
    setSavingNote(true);
    try {
      await onSaveNote(note.trim());
      setNoteOpen(false);
    } finally {
      setSavingNote(false);
    }
  }

  async function handleStatus(status: LocationStatus) {
    if (!onUpdateStatus || status === current.status) return;
    setStatusBusy(true);
    try {
      await onUpdateStatus(status);
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleConfirmDelete() {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
      setConfirmDeleteOpen(false);
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  async function handleFillAndSaveTravelInfo() {
    if (!userId || !onSaveTravelInfo || fillingInfo) return;

    setFillingInfo(true);
    setFillError(null);
    setFillSuccess(false);

    try {
      const profile = await getUserProfile(userId);
      const citizenship = profile?.citizenship?.trim() ?? "";
      if (!citizenship) {
        setFillError(
          "Add your citizenship in Profile first so we can personalize visa and entry tips."
        );
        return;
      }

      const language =
        profile?.preferences?.language ||
        (typeof navigator !== "undefined"
          ? navigator.language.split("-")[0] || "en"
          : "en");

      const intel = await getCityIntelligenceForPlace({
        city: current.city.name,
        country: current.country.name,
        lat: current.lat,
        lon: current.lon,
        cityId: current.city.id,
        countryId: current.country.id,
        userCountry: citizenship,
        userCurrency: profile?.currency,
        language,
      });

      const description = buildTravelInfoDescription(
        {
          cityName: current.city.name,
          countryName: current.country.name,
        },
        intel
      );

      await onSaveTravelInfo({
        description,
        note: "City travel tips from City Intelligence.",
        ai: {
          why: "City travel tips added from City Intelligence.",
          model: "city-intelligence",
          processedAt: Timestamp.now(),
        },
      });

      setIntelData(intel);
      setIntelCitizenship(citizenship);
      setFillSuccess(true);
      setPreviewTab("city");
    } catch (err: unknown) {
      if (isInsufficientAICreditsError(err)) {
        setFillError(formatInsufficientCreditsMessage(err));
      } else if (err instanceof Error && err.message) {
        setFillError(err.message);
      } else {
        setFillError("Could not get city tips. Please try again.");
      }
    } finally {
      setFillingInfo(false);
    }
  }

  const headerActions = (
    <>
      <span className="mr-auto flex min-w-0 items-center gap-1.5 pr-2 text-sm text-text-secondary">
        <MapPin className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
        <span className="truncate">
          {current.city.name}, {current.country.name}
        </span>
      </span>

      <button
        type="button"
        aria-label="Share"
        disabled={shareBusy}
        onClick={() => void handleShare()}
        className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-surface hover:text-text disabled:opacity-60"
      >
        <Share2 className="h-5 w-5" />
      </button>

      <div ref={menuRef} className="relative">
        <button
          type="button"
          aria-label="More options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => {
            setNoteOpen(false);
            setMenuOpen((v) => !v);
          }}
          className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-surface hover:text-text"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
        {menuOpen ? (
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 min-w-[11rem] overflow-hidden rounded-xl border border-border bg-surface-elevated py-1 shadow-lg"
          >
            {onSaveNote ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-surface"
                onClick={() => {
                  setMenuOpen(false);
                  setNoteOpen(true);
                }}
              >
                <NotebookPen className="h-3.5 w-3.5 text-text-muted" />
                {current.note?.trim() ? "Edit my note" : "Add my note"}
              </button>
            ) : null}
            {onViewOnMap ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-surface"
                onClick={() => {
                  setMenuOpen(false);
                  onViewOnMap(current);
                }}
              >
                <MapPinned className="h-3.5 w-3.5 text-text-muted" />
                View on map
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-error hover:bg-error-background"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmDeleteOpen(true);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <Sheet open={open} onClose={onClose} size="lg" actions={headerActions}>
      <DeleteConfirmModal
        open={confirmDeleteOpen}
        entity="place"
        description={
          <>
            <span className="font-medium text-text">{current.title}</span> will
            be removed from your map and places. This can’t be undone.
          </>
        }
        loading={deleting}
        onCancel={() => {
          if (!deleting) setConfirmDeleteOpen(false);
        }}
        onConfirm={() => void handleConfirmDelete()}
      />

      <div className="flex flex-col gap-5">
        <input
          ref={photoInputRef}
          type="file"
          accept={IMAGE_FILE_ACCEPT}
          className="hidden"
          onChange={(e) => void handleAddPhoto(e.target.files)}
        />

        {images.length > 0 ? (
          <div className="relative">
            <div
              className={cx(
                "grid gap-2",
                images.length > 1 ? "grid-cols-2" : "grid-cols-1"
              )}
            >
              {images.map((img) => {
                const canRemove =
                  canManagePhotos &&
                  (img.source === "user" || img.source === "external");
                const removing = removingPhotoUrl === img.url;
                return (
                  <div
                    key={img.url}
                    className="relative aspect-[4/3] overflow-hidden rounded-xl bg-surface"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={current.title}
                      className="h-full w-full object-cover"
                    />
                    {canRemove ? (
                      <button
                        type="button"
                        disabled={
                          removing || photoBusy || Boolean(removingPhotoUrl)
                        }
                        aria-label={
                          removing ? "Removing photo" : "Remove photo"
                        }
                        title="Remove photo"
                        onClick={() => void handleRemovePhoto(img)}
                        className="absolute top-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white shadow-sm transition-colors hover:bg-black/75 disabled:opacity-60"
                      >
                        {removing ? (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin"
                            aria-hidden
                          />
                        ) : (
                          <X className="h-3.5 w-3.5" aria-hidden />
                        )}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {canManagePhotos ? (
              <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={photoBusy || Boolean(removingPhotoUrl)}
                  aria-label={
                    addingStockPhoto
                      ? "Finding Wikimedia photo"
                      : "Add photo from Wikimedia Commons"
                  }
                  title="Add from Wikimedia Commons"
                  onClick={() => void handleAddWikimediaPhoto()}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-text shadow-md ring-1 ring-border/80 transition-colors hover:bg-white hover:text-primary disabled:opacity-60"
                >
                  {addingStockPhoto ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Images className="h-4 w-4" aria-hidden />
                  )}
                </button>
                <button
                  type="button"
                  disabled={photoBusy || Boolean(removingPhotoUrl)}
                  aria-label={uploadingPhoto ? "Uploading photo" : "Add photo"}
                  title="Add photo"
                  onClick={() => photoInputRef.current?.click()}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-text shadow-md ring-1 ring-border/80 transition-colors hover:bg-white hover:text-primary disabled:opacity-60"
                >
                  {uploadingPhoto ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <ImagePlus className="h-4 w-4" aria-hidden />
                  )}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="relative flex aspect-[16/10] items-center justify-center overflow-hidden rounded-xl bg-primary-tint">
            <p className="text-sm text-primary">
              {uploadingPhoto
                ? "Uploading photo…"
                : addingStockPhoto
                  ? "Finding Wikimedia photo…"
                  : "No photo yet"}
            </p>
            {canManagePhotos ? (
              <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={photoBusy || Boolean(removingPhotoUrl)}
                  aria-label={
                    addingStockPhoto
                      ? "Finding Wikimedia photo"
                      : "Add photo from Wikimedia Commons"
                  }
                  title="Add from Wikimedia Commons"
                  onClick={() => void handleAddWikimediaPhoto()}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-primary shadow-md ring-1 ring-primary/15 transition-colors hover:bg-primary-tint disabled:opacity-60"
                >
                  {addingStockPhoto ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Images className="h-4 w-4" aria-hidden />
                  )}
                </button>
                <button
                  type="button"
                  disabled={photoBusy || Boolean(removingPhotoUrl)}
                  aria-label={uploadingPhoto ? "Uploading photo" : "Add photo"}
                  title="Add photo"
                  onClick={() => photoInputRef.current?.click()}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-primary shadow-md ring-1 ring-primary/15 transition-colors hover:bg-primary-tint disabled:opacity-60"
                >
                  {uploadingPhoto ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <ImagePlus className="h-4 w-4" aria-hidden />
                  )}
                </button>
              </div>
            ) : null}
          </div>
        )}

        {photoError ? (
          <p className="rounded-xl bg-error-background px-3 py-2 text-xs text-error">
            {photoError}
          </p>
        ) : null}

        <div
          role="tablist"
          aria-label="Place details"
          className="grid grid-cols-2 gap-1 rounded-full bg-surface p-1"
        >
          {(
            [
              { id: "main" as const, label: "Main" },
              { id: "city" as const, label: "City info" },
            ] as const
          ).map((item) => {
            const selected = previewTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setPreviewTab(item.id)}
                className={cx(
                  "rounded-full px-3 py-2 text-sm font-medium transition-colors",
                  selected
                    ? "bg-surface-elevated text-text shadow-sm"
                    : "text-text-secondary hover:text-text"
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {previewTab === "main" ? (
          <>
            <div>
              <h2 className="text-base font-semibold tracking-tight text-text">
                {current.title}
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="inline-flex w-24 shrink-0 items-center gap-1.5 text-sm font-medium text-text-secondary">
                  <CircleDot
                    className="h-3.5 w-3.5 text-text-muted"
                    aria-hidden
                  />
                  Status
                </span>
                <StatusBadge status={current.status} />
              </div>
              {current.category && CategoryIcon ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="inline-flex w-24 shrink-0 items-center gap-1.5 text-sm font-medium text-text-secondary">
                    <Tag className="h-3.5 w-3.5 text-text-muted" aria-hidden />
                    Tags
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/45 bg-primary-tint px-2.5 py-1 text-xs font-medium text-primary">
                    <CategoryIcon
                      className="h-3.5 w-3.5 shrink-0"
                      aria-hidden
                    />
                    {PLACE_CATEGORY_LABELS[current.category] ??
                      current.category}
                  </span>
                </div>
              ) : null}
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="inline-flex w-24 shrink-0 items-center gap-1.5 text-sm font-medium text-text-secondary">
                  <Percent
                    className="h-3.5 w-3.5 text-text-muted"
                    aria-hidden
                  />
                  Confidence
                </span>
                <span
                  className={cx(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                    confidenceValue >= 0.85
                      ? "border-success/45 bg-success-background text-success"
                      : confidenceValue >= 0.7
                        ? "border-warning/45 bg-warning-background text-warning"
                        : "border-error/45 bg-error-background text-error"
                  )}
                >
                  {confidencePct}% · {confidence.label}
                </span>
              </div>
            </div>

            {current.ai?.why ? (
              <div className="rounded-xl bg-surface px-3 py-3">
                <p className="text-sm text-text-secondary">
                  <span className="font-medium text-text">
                    Why we think this:{" "}
                  </span>
                  {current.ai.why}
                </p>
                {confidence.detail ? (
                  <p className="mt-1 text-sm text-text-muted">
                    {confidence.detail}
                  </p>
                ) : null}
              </div>
            ) : confidence.detail ? (
              <div className="rounded-xl bg-surface px-3 py-3">
                <p className="text-sm text-text-muted">{confidence.detail}</p>
              </div>
            ) : null}

            {onUpdateStatus && current.status === "planned" ? (
              <Button
                color="primary"
                icon={Check}
                disabled={statusBusy}
                onClick={() => void handleStatus("visited")}
                className="w-full"
              >
                Mark as visited
              </Button>
            ) : onUpdateStatus && current.status === "visited" ? (
              <Button color="primary" icon={Check} disabled className="w-full">
                Visited
              </Button>
            ) : null}

            {noteOpen && onSaveNote ? (
              <div className="rounded-xl border border-border bg-surface p-3">
                <label className="mb-2 block text-sm font-medium text-text">
                  My note
                </label>
                <TextInput
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Go at sunset…"
                  autoFocus
                />
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setNote(current.note ?? "");
                      setNoteOpen(false);
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    color="primary"
                    loading={savingNote}
                    onClick={() => void handleSaveNote()}
                    className="flex-1"
                  >
                    Save note
                  </Button>
                </div>
              </div>
            ) : current.note?.trim() ? (
              <div className="rounded-xl bg-surface px-3 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  My note
                </p>
                <p className="mt-1 text-sm text-text">{current.note}</p>
              </div>
            ) : null}
          </>
        ) : (
          <>
            {canFillTravelInfo &&
            !intelData &&
            current.ai?.model !== "city-intelligence" ? (
              <div className="rounded-2xl border border-border bg-surface px-3.5 py-3.5">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
                    <Sparkles className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-text">
                      Get city travel tips
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
                      Add visa, budget, climate, and safety tips for{" "}
                      {current.city.name} to this place.
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={fillingInfo}
                        onClick={() => void handleFillAndSaveTravelInfo()}
                        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
                      >
                        {fillingInfo ? (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin"
                            aria-hidden
                          />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {fillingInfo ? "Getting tips…" : "Get tips"}
                      </button>
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning-background px-2 py-1 text-[11px] font-medium text-warning">
                        <Coins className="h-3 w-3" aria-hidden />
                        {CITY_INTEL_CREDITS} AI credits
                      </span>
                    </div>
                  </div>
                </div>
                {fillError ? (
                  <p className="mt-3 rounded-xl bg-error-background px-3 py-2 text-xs text-error">
                    {fillError}
                  </p>
                ) : null}
              </div>
            ) : null}

            {fillingInfo && !intelData ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface px-4 py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-sm text-text-secondary">
                  Loading city tips…
                </p>
              </div>
            ) : null}

            {fillError &&
            current.ai?.model === "city-intelligence" &&
            !intelData ? (
              <p className="rounded-xl bg-error-background px-3 py-2 text-xs text-error">
                {fillError}
              </p>
            ) : null}

            {fillSuccess && intelData ? (
              <p className="rounded-xl bg-success-background px-3 py-2 text-xs text-success">
                City tips saved to this place.
              </p>
            ) : null}

            {intelData ? (
              <CityIntelligenceResultsView
                data={intelData}
                citizenship={intelCitizenship}
                showDisclaimer
              />
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}
