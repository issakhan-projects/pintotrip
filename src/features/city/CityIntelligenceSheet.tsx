"use client";

import { useEffect, useState } from "react";
import { Button, TextInput } from "@/components/ui";
import {
  AlertTriangle,
  Bookmark,
  Coins,
  Loader2,
  MapPin,
  Sparkles,
} from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { getCityIntelligenceForPlace } from "@/services/functions";
import { createUserLocation, listUserLocations } from "@/services/locations";
import { getUserProfile, updateUserProfile } from "@/services/users";
import { isSameCountry, resolveCountryCode } from "@/lib/countries";
import { countryIdFromParts, isAsciiId, slugifyId } from "@/lib/utils";
import { resolveEnglishPlaceIds, withCityGooglePlaceId, englishPlaceIdsFromNames } from "@/lib/maps";
import { fetchPexelsCityPhoto } from "@/lib/pexels";
import { Timestamp } from "firebase/firestore";
import {
  CITY_INTELLIGENCE_DISCLAIMER,
  type CityIntelligenceResult,
} from "@/types/city-intelligence";
import {
  AI_CREDIT_COSTS,
  formatInsufficientCreditsMessage,
  isInsufficientAICreditsError,
} from "@/types/credits";
import { CityIntelligenceResultsView } from "@/features/city/CityIntelligenceResultsView";
import { buildTravelInfoDescription } from "@/features/city/travelInfoDescription";

interface CityIntelligenceSheetProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  city: {
    cityName: string;
    countryName: string;
    lat: number;
    lon: number;
    cityId?: string;
    countryId?: string;
  } | null;
  /** Whether this city is already in the user's favorites. */
  isFavorite?: boolean;
  /** Toggle favorite; parent owns persistence so the map can refresh pins. */
  onToggleFavorite?: () => Promise<void> | void;
  /** Called after a city is written to users/{uid}/locations. */
  onPlaceSaved?: () => void;
  /** Current AI credit balance for the cost button affordance. */
  aiCreditsBalance?: number | null;
}

type SheetPhase =
  | "loading-profile"
  | "ask-citizenship"
  | "confirm"
  | "loading"
  | "ready";

export function CityIntelligenceSheet({
  open,
  onClose,
  userId,
  city,
  isFavorite = false,
  onToggleFavorite,
  onPlaceSaved,
  aiCreditsBalance = null,
}: CityIntelligenceSheetProps) {
  const [phase, setPhase] = useState<SheetPhase>("loading-profile");
  const [citizenship, setCitizenship] = useState("");
  const [citizenshipDraft, setCitizenshipDraft] = useState("");
  const [userCountry, setUserCountry] = useState("");
  const [userCurrency, setUserCurrency] = useState<string | undefined>();
  const [language, setLanguage] = useState("en");
  const [data, setData] = useState<CityIntelligenceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingCitizenship, setSavingCitizenship] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoCredit, setPhotoCredit] = useState<{
    photographer: string;
    photographerUrl?: string | null;
    pexelsUrl?: string | null;
  } | null>(null);

  // Load a Pexels city photo for the sheet header.
  useEffect(() => {
    if (!open || !city) {
      setPhotoUrl(null);
      setPhotoCredit(null);
      return;
    }

    let cancelled = false;
    setPhotoUrl(null);
    setPhotoCredit(null);

    void (async () => {
      try {
        const photo = await fetchPexelsCityPhoto({
          cityName: city.cityName,
          countryName: city.countryName,
        });
        if (cancelled || !photo) return;
        setPhotoUrl(photo.url);
        if (photo.photographer) {
          setPhotoCredit({
            photographer: photo.photographer,
            photographerUrl: photo.photographerUrl,
            pexelsUrl: photo.pexelsUrl,
          });
        }
      } catch {
        if (!cancelled) {
          setPhotoUrl(null);
          setPhotoCredit(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, city]);

  // Load profile — never infer citizenship from browser locale.
  useEffect(() => {
    if (!open || !city) return;

    let cancelled = false;
    setPhase("loading-profile");
    setError(null);
    setData(null);
    setCitizenship("");
    setCitizenshipDraft("");
    setFavoriteError(null);

    const uiLanguage =
      typeof navigator !== "undefined"
        ? navigator.language.split("-")[0] || "en"
        : "en";

    void getUserProfile(userId)
      .then((profile) => {
        if (cancelled) return;

        const saved = profile?.citizenship?.trim() ?? "";
        setLanguage(profile?.preferences?.language || uiLanguage);
        setUserCountry(profile?.country?.trim() ?? "");
        setUserCurrency(profile?.currency);

        if (saved) {
          setCitizenship(saved);
          setCitizenshipDraft(saved);
          setPhase("confirm");
        } else {
          setPhase("ask-citizenship");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setPhase("ask-citizenship");
      });

    return () => {
      cancelled = true;
    };
  }, [open, city, userId]);

  // Fetch intelligence only after the user confirms (cost shown first).
  useEffect(() => {
    if (!open || !city || phase !== "loading" || !citizenship.trim()) return;

    let cancelled = false;
    setError(null);
    setData(null);

    void (async () => {
      try {
        // Prefer ids from the selection (map pick / list), then English resolve.
        const englishIds =
          englishPlaceIdsFromNames(
            city.cityName,
            city.countryName,
            resolveCountryCode(city.countryName) || undefined
          ) ?? (await resolveEnglishPlaceIds(city.lat, city.lon));
        if (cancelled) return;

        const countryCode =
          englishIds?.countryCode ||
          resolveCountryCode(city.countryName) ||
          undefined;
        const countryId =
          (city.countryId &&
          isAsciiId(city.countryId) &&
          /^[a-z]{2}$/.test(city.countryId.trim().toLowerCase())
            ? city.countryId.trim().toLowerCase()
            : null) ||
          countryIdFromParts(
            englishIds?.countryNameEn || city.countryName,
            countryCode
          );
        const cityId =
          (city.cityId && isAsciiId(city.cityId)
            ? city.cityId.trim().toLowerCase()
            : null) ||
          (englishIds?.cityId && isAsciiId(englishIds.cityId)
            ? englishIds.cityId
            : null) ||
          (isAsciiId(slugifyId(englishIds?.cityNameEn || ""))
            ? slugifyId(englishIds!.cityNameEn)
            : null) ||
          (isAsciiId(slugifyId(city.cityName))
            ? slugifyId(city.cityName)
            : undefined);

        const result = await getCityIntelligenceForPlace({
          city: city.cityName,
          country: city.countryName,
          lat: city.lat,
          lon: city.lon,
          ...(isAsciiId(cityId) ? { cityId } : {}),
          // Only ISO alpha-2 — never long slugs or the "xx" sentinel.
          ...(countryId !== "xx" && /^[a-z]{2}$/.test(countryId)
            ? { countryId }
            : {}),
          language,
          userCountry: citizenship.trim(),
          userCurrency,
        });
        if (cancelled) return;
        setData(result);
        setPhase("ready");
      } catch (err: unknown) {
        if (cancelled) return;
        let message = "Failed to load city information.";
        if (isInsufficientAICreditsError(err)) {
          message = formatInsufficientCreditsMessage(err);
        } else if (err && typeof err === "object" && "code" in err) {
          const code = String((err as { code: string }).code);
          if (code.includes("unimplemented")) {
            message =
              "City intelligence is not available yet for this project.";
          } else if (code.includes("failed-precondition")) {
            message =
              "City intelligence is not configured (missing API key).";
          } else if (
            "message" in err &&
            typeof (err as { message: unknown }).message === "string"
          ) {
            message = (err as { message: string }).message;
          }
        } else if (err instanceof Error && err.message) {
          message = err.message;
        }
        setError(message);
        setPhase("ready");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, city, phase, citizenship, language, userCurrency]);

  async function confirmCitizenship() {
    const value = citizenshipDraft.trim();
    if (!value) return;

    setSavingCitizenship(true);
    setError(null);
    try {
      await updateUserProfile(userId, { citizenship: value });
      setCitizenship(value);
      setPhase("confirm");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not save citizenship. Please try again."
      );
    } finally {
      setSavingCitizenship(false);
    }
  }

  function changeCitizenship() {
    setData(null);
    setError(null);
    setCitizenshipDraft(citizenship);
    setPhase("ask-citizenship");
  }

  const creditCost = AI_CREDIT_COSTS.getCityIntelligence;
  const canAfford =
    aiCreditsBalance === null || aiCreditsBalance >= creditCost;

  function startCityIntelligence() {
    if (!canAfford) {
      setError(
        `Not enough AI credits. Need ${creditCost}, you have ${aiCreditsBalance ?? 0}.`
      );
      return;
    }
    setError(null);
    setData(null);
    setPhase("loading");
  }

  async function handleToggleFavorite() {
    if (!city || !onToggleFavorite || favoriteBusy) return;
    setFavoriteBusy(true);
    setFavoriteError(null);
    const saving = !isFavorite;
    try {
      await onToggleFavorite();

      if (saving) {
        await saveCityAsPlace(userId, city, data, photoUrl);
        onPlaceSaved?.();
      }
    } catch (err) {
      setFavoriteError(
        err instanceof Error
          ? err.message
          : saving
            ? "Could not save place."
            : "Could not update saved place."
      );
    } finally {
      setFavoriteBusy(false);
    }
  }

  const showStandaloneDisclaimer =
    phase !== "ask-citizenship" &&
    phase !== "confirm" &&
    !(phase === "ready" && data);
  const showCurrencyAndExchange = !isSameCountry(
    city?.countryId || city?.countryName,
    userCountry || citizenship
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={city?.cityName ?? "City"}
      size="lg"
    >
      {city ? (
        <div className="mb-4 space-y-3">
          {photoUrl ? (
            <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl}
                alt={city.cityName}
                className="h-full w-full object-cover"
              />
              {photoCredit ? (
                <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-3 pb-2 pt-6 text-[11px] text-white/90">
                  Photo by{" "}
                  {photoCredit.photographerUrl ? (
                    <a
                      href={photoCredit.photographerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2"
                    >
                      {photoCredit.photographer}
                    </a>
                  ) : (
                    photoCredit.photographer
                  )}{" "}
                  on{" "}
                  <a
                    href={photoCredit.pexelsUrl || "https://www.pexels.com"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2"
                  >
                    Pexels
                  </a>
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-text-secondary">{city.countryName}</p>
              {isFavorite ? (
                <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary">
                  <MapPin className="h-3 w-3" aria-hidden />
                  Pinned on your map
                </p>
              ) : null}
            </div>
            {onToggleFavorite ? (
              <button
                type="button"
                onClick={() => void handleToggleFavorite()}
                disabled={favoriteBusy}
                aria-pressed={isFavorite}
                aria-label={
                  isFavorite ? "Remove saved place" : "Save place"
                }
                title={isFavorite ? "Saved" : "Save place"}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                {favoriteBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Bookmark
                    className="h-3.5 w-3.5"
                    fill="currentColor"
                    aria-hidden
                  />
                )}
                {isFavorite ? "Saved" : "Save place"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {favoriteError ? (
        <div className="mb-4 rounded-2xl bg-error-background px-4 py-3 text-sm text-error">
          {favoriteError}
        </div>
      ) : null}

      {phase === "loading-profile" || phase === "loading" ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-text-secondary">
            {phase === "loading-profile"
              ? "Loading your profile…"
              : "Loading travel info…"}
          </p>
        </div>
      ) : null}

      {phase === "ask-citizenship" ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-surface px-4 py-3.5">
            <p className="text-sm font-medium text-text">
              One quick question
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              What is your citizenship? We ask this once and save it only to give
              you better recommendations (like visa guidance). We never guess it
              from your language or location.
            </p>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm text-text-secondary">
              Citizenship (passport country)
            </span>
            <TextInput
              value={citizenshipDraft}
              onChange={(e) => setCitizenshipDraft(e.target.value)}
              placeholder="e.g. Uzbekistan, Germany, Japan"
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmCitizenship();
              }}
            />
          </label>
          {error ? (
            <div className="rounded-2xl bg-error-background px-4 py-3 text-sm text-error">
              {error}
            </div>
          ) : null}
          <Button
            loading={savingCitizenship}
            disabled={!citizenshipDraft.trim()}
            onClick={() => void confirmCitizenship()}
            className="w-full !bg-primary hover:!bg-primary-hover !border-primary !text-white disabled:!opacity-40"
          >
            Save & continue
          </Button>
        </div>
      ) : null}

      {phase === "confirm" && city ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-surface px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Location
            </p>
            <div className="mt-2 flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
                <MapPin className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-base font-semibold text-text">
                  {city.cityName}
                </p>
                <p className="mt-0.5 text-sm text-text-secondary">
                  {city.countryName}
                </p>
              </div>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-text-secondary">
            Get travel info for this city — visas, money, safety tips, and more
            personalized for your citizenship.
          </p>

          <div className="flex items-center justify-between gap-2 text-xs text-text-secondary">
            <span className="inline-flex items-center gap-1.5">
              <Coins className="h-3.5 w-3.5 text-warning" aria-hidden />
              Uses {creditCost} AI credit{creditCost === 1 ? "" : "s"}
            </span>
            {aiCreditsBalance !== null ? (
              <span className="tabular-nums">
                Balance {aiCreditsBalance}
              </span>
            ) : null}
          </div>

          {!canAfford ? (
            <p className="text-center text-xs text-error">
              Not enough AI credits. Need {creditCost}, you have{" "}
              {aiCreditsBalance ?? 0}.
            </p>
          ) : null}

          {error ? (
            <div className="rounded-2xl bg-error-background px-4 py-3 text-sm text-error">
              {error}
            </div>
          ) : null}

          <Button
            icon={Sparkles}
            disabled={!canAfford}
            onClick={startCityIntelligence}
            className="w-full !h-11 !bg-primary hover:!bg-primary-hover !border-primary !text-white disabled:!opacity-40"
          >
            <span className="inline-flex items-center gap-2">
              Get travel info
              <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
                <Coins className="h-3 w-3" aria-hidden />
                {creditCost}
              </span>
            </span>
          </Button>
        </div>
      ) : null}

      {phase === "ready" && error ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-error-background px-4 py-3 text-sm text-error">
            {error}
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              setError(null);
              setPhase("confirm");
            }}
            className="w-full"
          >
            Try again
          </Button>
        </div>
      ) : null}

      {phase === "ready" && data ? (
        <CityIntelligenceResultsView
          data={data}
          citizenship={citizenship}
          onChangeCitizenship={changeCitizenship}
          showDisclaimer
          showCurrencyAndExchange={showCurrencyAndExchange}
        />
      ) : null}

      {showStandaloneDisclaimer ? (
        <div className="mt-5 flex gap-3 rounded-2xl bg-warning-background px-4 py-3.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="min-w-0 text-sm text-warning">
            <p className="font-semibold">Travel information can change.</p>
            <p className="mt-0.5 font-normal opacity-90">
              {data?.disclaimer
                ? data.disclaimer.replace(/^Travel information can change\.\s*/i, "")
                : CITY_INTELLIGENCE_DISCLAIMER.replace(
                    /^Travel information can change\.\s*/i,
                    ""
                  )}
            </p>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

async function saveCityAsPlace(
  userId: string,
  city: {
    cityName: string;
    countryName: string;
    lat: number;
    lon: number;
  },
  data: CityIntelligenceResult | null,
  existingPhotoUrl?: string | null
): Promise<void> {
  // listUserLocations is cache-first / deduped — no extra reads when AppShell warm.
  const existing = await listUserLocations(userId);
  const alreadySaved = existing.some(
    (place) =>
      place.source.type === "city" &&
      place.city.name.toLowerCase() === city.cityName.toLowerCase() &&
      place.country.name.toLowerCase() === city.countryName.toLowerCase()
  );
  if (alreadySaved) return;

  const countryName = city.countryName;
  const cityName = city.cityName;
  const description = buildTravelInfoDescription(city, data);
  // Localized display names slugify to "unknown" — resolve English/ASCII ids from coords.
  const englishIds =
    englishPlaceIdsFromNames(
      cityName,
      countryName,
      resolveCountryCode(countryName) || undefined
    ) ?? (await resolveEnglishPlaceIds(city.lat, city.lon));
  const countryCode =
    englishIds?.countryCode ||
    resolveCountryCode(countryName) ||
    undefined;
  const country = {
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
  if (!isAsciiId(country.id) || !cityId) {
    throw new Error(
      "Could not resolve English city/country ids for this place. Try again."
    );
  }
  const cityData = await withCityGooglePlaceId(
    { id: cityId, name: cityName },
    country,
    { lat: city.lat, lon: city.lon }
  );
  const photoUrl =
    existingPhotoUrl ||
    (
      await fetchPexelsCityPhoto({
        cityName: city.cityName,
        countryName: city.countryName,
      })
    )?.url ||
    null;

  await createUserLocation(userId, {
    title: cityName,
    description,
    note: data
      ? "Saved from City Intelligence with travel info."
      : "Saved from City Intelligence.",
    lat: city.lat,
    lon: city.lon,
    country,
    city: cityData,
    status: "planned",
    images: photoUrl ? [{ url: photoUrl, source: "external" }] : [],
    confidence: 1,
    ai: {
      why: "City saved by the user from City Intelligence.",
      model: data ? "city-intelligence" : "city-intelligence-pending",
      processedAt: Timestamp.now(),
    },
    source: { type: "city" },
  });
}
