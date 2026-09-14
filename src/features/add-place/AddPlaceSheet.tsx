"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, TextInput } from "@/components/ui";
import {
  Check,
  ChevronRight,
  ImageIcon,
  Info,
  Link2,
  Loader2,
  Lock,
  Search,
} from "lucide-react";
import { Timestamp } from "firebase/firestore";
import { Sheet } from "@/components/ui/Sheet";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { findPlace } from "@/services/functions";
import { uploadLocationDraftImage } from "@/services/storage";
import { createUserLocation } from "@/services/locations";
import { resolveUserLanguage } from "@/services/users";
import {
  formatInsufficientCreditsMessage,
  isInsufficientAICreditsError,
} from "@/types/credits";
import type { AnalyzeLocationResult } from "@/types/ai";
import { PLACE_CATEGORY_LABELS } from "@/types/trip-plan";
import { slugifyId, countryIdFromParts, isAsciiId, formatConfidenceCopy, cx } from "@/lib/utils";
import { resolveCountryCode } from "@/lib/countries";
import { withCityGooglePlaceId, resolveEnglishPlaceIds } from "@/lib/maps";
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

interface AddPlaceSheetProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  onSaved: () => void;
  /** Google Maps name search is Pro-only. */
  isPro?: boolean;
}

const ANALYZE_MESSAGES = [
  "Analyzing your photo…",
  "Looking for visual clues…",
  "Checking possible locations…",
  "Verifying when needed…",
];

export function AddPlaceSheet({
  open,
  onClose,
  userId,
  onSaved,
  isPro = false,
}: AddPlaceSheetProps) {
  const router = useRouter();
  const [step, setStep] = useState<AddStep>("menu");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
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
      setFile(null);
      setPreviewUrl(null);
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

  useEffect(() => {
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
      setMessageIndex((i) => (i + 1) % ANALYZE_MESSAGES.length);
    }, 2200);
    return () => window.clearInterval(id);
  }, [step]);

  function handleClose() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    onClose();
  }

  function onPickFile(next: File | null) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(next);
    setPreviewUrl(next ? URL.createObjectURL(next) : null);
  }

  async function runAnalyze(
    request:
      | { type: "image"; imageUrl: string }
      | { type: "link"; link: string }
  ) {
    setStep("analyzing");
    setError(null);
    setMessageIndex(0);
    try {
      const language = await resolveUserLanguage(userId);
      const data = await findPlace({ ...request, language });
      setResult(data);
      setStep("result");
    } catch (err) {
      const message = parseAnalyzeError(err);
      setError(message);
      setStep("error");
    }
  }

  async function analyzePhoto() {
    if (!file) return;
    try {
      setStep("analyzing");
      const draftId = crypto.randomUUID();
      const url = await uploadLocationDraftImage(userId, draftId, file);
      setImageUrl(url);
      await runAnalyze({ type: "image", imageUrl: url });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Image upload failed."
      );
      setStep("error");
    }
  }

  async function analyzeLink() {
    const trimmed = link.trim();
    if (!trimmed) return;
    setImageUrl(null);
    await runAnalyze({ type: "link", link: trimmed });
  }

  async function savePlace() {
    if (!result?.identified) return;
    setSaving(true);
    try {
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
        name: countryName || countryCode || "Unknown",
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
        throw new Error(
          "Could not resolve English city/country ids for this place. Try again."
        );
      }
      const city = await withCityGooglePlaceId(
        {
          id: cityId,
          name: cityName || "Unknown",
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
        status: "planned",
        ...(result.category ? { category: result.category } : {}),
        images: imageUrl
          ? [{ url: imageUrl, source: "user" }]
          : [],
        confidence: result.confidence,
        locationConfidence: result.locationConfidence,
        exactCoordinatesConfidence: result.exactCoordinatesConfidence,
        ai: {
          why: result.why,
          model: "findPlace",
          processedAt: Timestamp.now(),
        },
        source: imageUrl
          ? { type: "image", url: imageUrl }
          : { type: "link", url: link.trim() },
      };
      await createUserLocation(userId, input);
      onSaved();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save place.");
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
    void fetchPlacePhotoUrl(place.placeId).then((photoUrl) => {
      if (!photoUrl) return;
      setSelectedPlace((prev) =>
        prev?.placeId === place.placeId ? { ...prev, photoUrl } : prev
      );
    });
  }

  async function saveSearchedPlace() {
    if (!selectedPlace || !isPro) return;
    if (!manualTitle.trim() || !manualCity.trim() || !manualCountry.trim()) {
      setError("Title, city, and country are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const countryName = manualCountry.trim();
      const cityName = manualCity.trim();
      const [englishIds, photoUrl] = await Promise.all([
        resolveEnglishPlaceIds(selectedPlace.lat, selectedPlace.lon),
        selectedPlace.photoUrl
          ? Promise.resolve(selectedPlace.photoUrl)
          : fetchPlacePhotoUrl(selectedPlace.placeId),
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
        throw new Error(
          "Could not resolve English city/country ids for this place. Try again."
        );
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
          note || selectedPlace.address || "Added from Google Maps search.",
        ...(note ? { note } : {}),
        lat: selectedPlace.lat,
        lon: selectedPlace.lon,
        country: countryData,
        city: cityData,
        status: "planned",
        images: photoUrl
          ? [{ url: photoUrl, source: "external" }]
          : [],
        confidence: 1,
        ai: {
          why: `Matched from Google Maps search: ${selectedPlace.address}`,
          model: "manual",
          processedAt: Timestamp.now(),
        },
        source: { type: "manual" },
      });
      onSaved();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save place.");
    } finally {
      setSaving(false);
    }
  }

  const title =
    step === "menu"
      ? "Add a place"
      : step === "photo"
        ? "Add from photo"
        : step === "link"
          ? "Add from link"
          : step === "analyzing"
            ? "Finding location"
            : step === "result"
              ? result?.identified
                ? "Found it"
                : "Couldn't identify"
              : step === "search"
                ? "Search by name"
                : step === "search-confirm"
                  ? "Save place"
                  : "Couldn't identify";

  return (
    <Sheet open={open} onClose={handleClose} title={title} size="lg">
      {step === "menu" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-secondary">
            Where did you discover it?
          </p>
          <div className="flex gap-2 rounded-xl border border-primary/15 bg-primary-tint px-3 py-2.5 text-xs text-primary">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">Hint</p>
              <p className="mt-0.5 text-primary/80">
                Prefer uploading a photo or screenshot. Some websites block
                reading their images from another source, so links may fail to
                analyze.
              </p>
            </div>
          </div>
          <MenuOptionCard
            variant="photo"
            icon={<ImageIcon className="h-5 w-5" />}
            title="Add from photo"
            subtitle="Best for Instagram & TikTok screenshots"
            tags={[
              { label: "Landmarks", checked: true },
              { label: "Buildings", checked: true },
              { label: "Landscapes", checked: true },
            ]}
            visual={<PhotoStackVisual />}
            onClick={() => setStep("photo")}
          />
          <MenuOptionCard
            variant="link"
            icon={<Link2 className="h-5 w-5" />}
            title="Add from link"
            subtitle="Paste a post or place URL"
            tags={[
              { label: "Instagram" },
              { label: "TikTok" },
              { label: "Google Maps" },
              { label: "Blog" },
              { label: "Other" },
            ]}
            visual={<LinkInputVisual />}
            onClick={() => setStep("link")}
          />
          <MenuOptionCard
            variant="link"
            icon={
              isPro ? (
                <Search className="h-5 w-5" />
              ) : (
                <Lock className="h-5 w-5" />
              )
            }
            title="Search by name"
            subtitle={
              isPro
                ? "Find a place on Google Maps"
                : "Pro plan — find places on Google Maps"
            }
            tags={
              isPro
                ? [
                    { label: "Landmarks" },
                    { label: "Cities" },
                    { label: "Restaurants" },
                  ]
                : [{ label: "Pro" }]
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
        </div>
      ) : null}

      {step === "photo" ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">
            Upload a screenshot or photo of the place.
          </p>
          <label
            className={cx(
              "flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface px-4 py-10 text-center transition-colors hover:border-primary hover:bg-primary-tint/40"
            )}
          >
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Selected"
                className="mb-3 max-h-56 rounded-xl object-cover"
              />
            ) : (
              <ImageIcon className="mb-3 h-8 w-8 text-primary" />
            )}
            <span className="text-sm font-medium text-text">
              {previewUrl ? "Change photo" : "Upload photo"}
            </span>
            <span className="mt-1 text-xs text-text-muted">
              or drag and drop on desktop
            </span>
          </label>
          <div className="rounded-xl bg-surface px-3 py-3 text-xs text-text-secondary">
            <p className="font-medium text-text">
              Choose a clear photo of the place
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              <li>
                Best results with visible landmarks, buildings, streets, or
                distinctive surroundings.
              </li>
              <li>
                Avoid blurry photos, selfies, and images with little context.
              </li>
            </ul>
          </div>
          <Button
            icon={Search}
            disabled={!file}
            color="neutral"
            onClick={() => void analyzePhoto()}
            className="w-full disabled:!opacity-40"
          >
            Analyze location
          </Button>
          <button
            type="button"
            className="text-sm text-text-secondary"
            onClick={() => setStep("menu")}
          >
            Back
          </button>
        </div>
      ) : null}

      {step === "link" ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">
            Paste a link to a post or place.
          </p>
          <TextInput
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://…"
          />
          <Button
            icon={Search}
            disabled={!link.trim()}
            onClick={() => void analyzeLink()}
            className="w-full disabled:!opacity-40"
            color="neutral"
          >
            Analyze location
          </Button>
          <button
            type="button"
            className="text-sm text-text-secondary"
            onClick={() => setStep("menu")}
          >
            Back
          </button>
        </div>
      ) : null}

      {step === "analyzing" ? (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-base font-medium text-text">
            {ANALYZE_MESSAGES[messageIndex]}
          </p>
          <p className="text-sm text-text-muted">This usually takes a moment.</p>
        </div>
      ) : null}

      {step === "result" && result ? (
        <AiResultView
          result={result}
          imageUrl={imageUrl ?? previewUrl}
          saving={saving}
          onSave={() => void savePlace()}
          onReject={() => {
            setResult(null);
            setStep("photo");
          }}
        />
      ) : null}

      {step === "error" ? (
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <p className="text-base font-medium text-text">
            We couldn&apos;t identify this place.
          </p>
          <p className="text-sm text-text-secondary">{error}</p>
          <Button
            onClick={() => setStep("photo")}
            className="w-full"
            color="neutral"
          >
            Try another photo
          </Button>
          <button
            type="button"
            className="text-sm text-text-secondary"
            onClick={() => setStep("menu")}
          >
            Back to options
          </button>
        </div>
      ) : null}

      {step === "search" ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">
            Type a place name and we&apos;ll look it up on Google Maps.
          </p>
          <TextInput
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Eiffel Tower, Paris…"
            autoFocus
          />
          {searching ? (
            <div className="flex items-center gap-2 py-2 text-sm text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching…
            </div>
          ) : null}
          {!searching &&
          searchQuery.trim().length >= 2 &&
          searchResults.length === 0 ? (
            <p className="text-sm text-text-muted">
              No matches yet. Try a more specific name.
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
            Back
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
            placeholder="Place title"
            value={manualTitle}
            onChange={(e) => setManualTitle(e.target.value)}
          />
          <TextInput
            placeholder="City"
            value={manualCity}
            onChange={(e) => setManualCity(e.target.value)}
          />
          <TextInput
            placeholder="Country"
            value={manualCountry}
            onChange={(e) => setManualCountry(e.target.value)}
          />
          <TextInput
            placeholder="Note (optional)"
            value={manualNote}
            onChange={(e) => setManualNote(e.target.value)}
          />
          {error ? <p className="text-sm text-error">{error}</p> : null}
          <Button
            loading={saving}
            onClick={() => void saveSearchedPlace()}
            className="w-full"
            color="neutral"
          >
            Save place
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
            Back
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
  return (
    <span className="flex h-[56px] w-[108px] items-center justify-center rounded-xl bg-[#eef0f3] p-2 shadow-sm">
      <span className="flex w-full items-center gap-1.5 rounded-lg border border-border bg-white px-2 py-2 shadow-sm">
        <Link2 className="h-3 w-3 shrink-0 text-text-muted" aria-hidden />
        <span className="truncate text-[10px] text-text-muted">https://…</span>
      </span>
    </span>
  );
}

function SearchInputVisual() {
  return (
    <span className="flex h-[56px] w-[108px] items-center justify-center rounded-xl bg-[#eef0f3] p-2 shadow-sm">
      <span className="flex w-full items-center gap-1.5 rounded-lg border border-border bg-white px-2 py-2 shadow-sm">
        <Search className="h-3 w-3 shrink-0 text-text-muted" aria-hidden />
        <span className="truncate text-[10px] text-text-muted">Search…</span>
      </span>
    </span>
  );
}

function AiResultView({
  result,
  imageUrl,
  saving,
  onSave,
  onReject,
}: {
  result: AnalyzeLocationResult;
  imageUrl: string | null;
  saving: boolean;
  onSave: () => void;
  onReject: () => void;
}) {
  if (!result.identified) {
    const alternatives = (result.alternatives ?? []).slice(0, 3);
    return (
      <div className="flex flex-col gap-4">
        {imageUrl ? (
          <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt="Uploaded place"
              className="h-full w-full object-cover"
            />
          </div>
        ) : null}

        <div>
          <h3 className="text-xl font-semibold text-text">
            We couldn&apos;t confidently identify this place.
          </h3>
          {result.why ? (
            <p className="mt-2 text-sm text-text-secondary">{result.why}</p>
          ) : null}
        </div>

        {alternatives.length > 0 ? (
          <div className="rounded-xl bg-surface px-3 py-3">
            <p className="text-sm font-medium text-text">Possible matches</p>
            <ul className="mt-2 space-y-2">
              {alternatives.map((alt) => (
                <li
                  key={`${alt.title}-${alt.country}`}
                  className="text-sm text-text-secondary"
                >
                  <span className="font-medium text-text">{alt.title}</span>
                  {alt.city || alt.country ? (
                    <span>
                      {" "}
                      — {[alt.city, alt.country].filter(Boolean).join(", ")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <Button
          variant="secondary"
          onClick={onReject}
          className="btn-secondary w-full"
        >
          Try another photo
        </Button>
      </div>
    );
  }

  const confidence = formatConfidenceCopy(result.confidence);
  const showConfidenceDetail =
    result.confidenceLevel !== "high" || Boolean(confidence.detail);

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
        <p className="text-sm font-medium text-primary">{confidence.label}</p>
        <h3 className="mt-1 text-xl font-semibold text-text">{result.title}</h3>
        <p className="mt-1 text-sm text-text-secondary">
          {[result.city, result.country].filter(Boolean).join(", ")}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge status="planned" />
          {result.category ? (
            <span className="rounded-full bg-primary-tint px-2.5 py-0.5 text-[11px] font-medium text-primary">
              {PLACE_CATEGORY_LABELS[result.category] ?? result.category}
            </span>
          ) : null}
        </div>
        {showConfidenceDetail && confidence.detail ? (
          <p className="mt-1 text-sm text-warning">{confidence.detail}</p>
        ) : null}
      </div>

      <p className="text-sm leading-relaxed text-text">{result.description}</p>

      <div className="rounded-xl bg-surface px-3 py-3">
        <p className="text-sm font-medium text-text">
          Why we think this is the place
        </p>
        <p className="mt-1 text-sm text-text-secondary">{result.why}</p>
      </div>

      <Button
        loading={saving}
        onClick={onSave}
        className="btn-primary w-full"
      >
        Save place
      </Button>
      <Button
        variant="secondary"
        onClick={onReject}
        className="btn-secondary w-full"
      >
        Not this place
      </Button>
    </div>
  );
}

function parseAnalyzeError(err: unknown): string {
  if (isInsufficientAICreditsError(err)) {
    return formatInsufficientCreditsMessage(err);
  }
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code: string }).code);
    if (code.includes("unimplemented")) {
      return "AI location analysis is not enabled yet on this project. Try again once the Cloud Function is deployed.";
    }
    if (code.includes("unauthenticated")) {
      return "Please sign in again and retry.";
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong while analyzing. Try another photo.";
}
