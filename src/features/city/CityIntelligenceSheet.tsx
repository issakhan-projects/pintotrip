"use client";

import { useEffect, useState } from "react";
import { Button, TextInput } from "@/components/ui";
import {
  AlertTriangle,
  BookOpen,
  Bookmark,
  Bus,
  CalendarDays,
  Car,
  Clock,
  Coins,
  CreditCard,
  ExternalLink,
  Globe2,
  Languages,
  Loader2,
  Map,
  MapPin,
  ShieldCheck,
  Smartphone,
  Sun,
  Thermometer,
  Ticket,
  TrendingUp,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { getCityIntelligence } from "@/services/functions";
import { createUserLocation, listUserLocations } from "@/services/locations";
import { getUserProfile, updateUserProfile } from "@/services/users";
import { resolveCountryCode } from "@/lib/countries";
import { countryIdFromParts, isAsciiId, slugifyId } from "@/lib/utils";
import { resolveCityGooglePlaceId, resolveEnglishPlaceIds, withCityGooglePlaceId } from "@/lib/maps";
import { fetchPlacePhotoUrl } from "@/features/add-place/placeSearch";
import { Timestamp } from "firebase/firestore";
import {
  CITY_INTELLIGENCE_DISCLAIMER,
  type CityIntelligenceDetails,
  type CityIntelligenceResult,
  type UsefulApp,
  type UsefulAppCategory,
} from "@/types/city-intelligence";
import {
  formatInsufficientCreditsMessage,
  isInsufficientAICreditsError,
} from "@/types/credits";

interface CityIntelligenceSheetProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  city: {
    cityName: string;
    countryName: string;
    lat: number;
    lon: number;
  } | null;
  /** Whether this city is already in the user's favorites. */
  isFavorite?: boolean;
  /** Toggle favorite; parent owns persistence so the map can refresh pins. */
  onToggleFavorite?: () => Promise<void> | void;
  /** Called after a city is written to users/{uid}/locations. */
  onPlaceSaved?: () => void;
}

type SheetPhase = "loading-profile" | "ask-citizenship" | "loading" | "ready";

export function CityIntelligenceSheet({
  open,
  onClose,
  userId,
  city,
  isFavorite = false,
  onToggleFavorite,
  onPlaceSaved,
}: CityIntelligenceSheetProps) {
  const [phase, setPhase] = useState<SheetPhase>("loading-profile");
  const [citizenship, setCitizenship] = useState("");
  const [citizenshipDraft, setCitizenshipDraft] = useState("");
  const [userCurrency, setUserCurrency] = useState<string | undefined>();
  const [language, setLanguage] = useState("en");
  const [data, setData] = useState<CityIntelligenceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingCitizenship, setSavingCitizenship] = useState(false);
  const [visaExpanded, setVisaExpanded] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  // Load a Google Maps city photo for the sheet header.
  useEffect(() => {
    if (!open || !city) {
      setPhotoUrl(null);
      return;
    }

    let cancelled = false;
    setPhotoUrl(null);

    void (async () => {
      try {
        const placeId = await resolveCityGooglePlaceId({
          key: `${city.cityName}:${city.countryName}:${city.lat},${city.lon}`,
          cityName: city.cityName,
          countryName: city.countryName,
          lat: city.lat,
          lon: city.lon,
        });
        if (!placeId || cancelled) return;
        const url = await fetchPlacePhotoUrl(placeId);
        if (!cancelled) setPhotoUrl(url);
      } catch {
        if (!cancelled) setPhotoUrl(null);
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
    setVisaExpanded(false);
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
        setUserCurrency(profile?.currency);

        if (saved) {
          setCitizenship(saved);
          setCitizenshipDraft(saved);
          setPhase("loading");
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

  // Fetch intelligence only after citizenship is known.
  useEffect(() => {
    if (!open || !city || phase !== "loading" || !citizenship.trim()) return;

    let cancelled = false;
    setError(null);
    setData(null);
    setVisaExpanded(false);

    getCityIntelligence({
      city: city.cityName,
      country: city.countryName,
      lat: city.lat,
      lon: city.lon,
      language,
      userCountry: citizenship.trim(),
      userCurrency,
    })
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setPhase("ready");
        }
      })
      .catch((err: unknown) => {
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
      });

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
      setPhase("loading");
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
    setVisaExpanded(false);
    setPhase("ask-citizenship");
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

  const details = data?.details;
  const currencyParts = data
    ? getCurrencyParts(data, details)
    : { primary: "" as string, symbol: undefined as string | undefined };
  const bestTimePrimary = data ? formatBestTimePrimary(data, details) : "";
  const bestTimeHint = data ? formatBestTimeHint(data, details) : undefined;
  const visaSummary = data ? formatVisaSummary(data, details) : "";
  const visaExtra = data ? formatVisaExtra(data, details) : null;
  const climateTemp = formatTemperature(details?.climate?.averageTemperature);
  const hasPractical = Boolean(
    details?.practicalInfo &&
      (details.practicalInfo.transport ||
        details.practicalInfo.walkability ||
        details.practicalInfo.payment ||
        details.practicalInfo.safety ||
        details.practicalInfo.tips?.length)
  );
  const usefulApps = getUsefulApps(data, details);

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
                className={
                  isFavorite
                    ? "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-primary-hover disabled:opacity-50"
                    : "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text transition-colors hover:border-primary hover:bg-primary-tint hover:text-primary disabled:opacity-50"
                }
              >
                {favoriteBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Bookmark
                    className="h-3.5 w-3.5"
                    fill={isFavorite ? "currentColor" : "none"}
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

      {phase === "ready" && error ? (
        <div className="rounded-2xl bg-error-background px-4 py-3 text-sm text-error">
          {error}
        </div>
      ) : null}

      {phase === "ready" && data ? (
        <div className="space-y-3">
          {/* Personalization banner */}
          <div className="flex items-start gap-3 rounded-2xl bg-sky-50 px-4 py-3.5">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/80 text-sky-700">
              <Globe2 className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text">
                Recommendations personalized for{" "}
                <span className="font-semibold">{citizenship} citizenship</span>
              </p>
              <p className="mt-0.5 text-xs text-text-secondary">
                This may affect visa, entry rules and other travel information.
              </p>
            </div>
            <button
              type="button"
              onClick={changeCitizenship}
              className="shrink-0 pt-0.5 text-sm font-medium text-sky-700 hover:underline"
            >
              Update ›
            </button>
          </div>

          {/* Currency + Exchange */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MetricCard
              icon={Coins}
              label="Currency"
              value={currencyParts.primary}
              hint={currencyParts.symbol}
            />
            {data.exchangeRate ? (
              <MetricCard
                icon={TrendingUp}
                label="Exchange rate"
                value={`1 ${data.exchangeRate.from} ≈ ${data.exchangeRate.rate} ${data.exchangeRate.to}`}
                hint={`Source: ${data.exchangeRate.source}. Confirm before exchanging money.`}
              />
            ) : (
              <MetricCard
                icon={TrendingUp}
                label="Exchange rate"
                value="Not available"
                hint="Confirm rates with a bank or exchange office."
              />
            )}
          </div>

          {/* Safety */}
          {(data.safeRate || details?.practicalInfo?.safeRate) && (
            <SafeRateCard data={data} details={details} />
          )}

          {/* Best time + Budget */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {bestTimePrimary ? (
              <MetricCard
                icon={CalendarDays}
                label="Best time to visit"
                value={bestTimePrimary}
                hint={bestTimeHint}
              />
            ) : null}
            {(data.approximateDailyBudget || details?.dailyBudget) && (
              <MetricCard
                icon={Wallet}
                label="Estimated daily budget"
                value={formatBudget(data, details)}
                hint={
                  data.approximateDailyBudget?.summary ||
                  details?.dailyBudget?.description
                }
              />
            )}
          </div>

          {/* Visa + Climate */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {visaSummary ? (
              <div className="flex flex-col rounded-2xl bg-surface px-4 py-3.5">
                <SectionHeader icon={BookOpen} label="Visa" />
                <p className="mt-2.5 text-sm leading-relaxed text-text">
                  {visaSummary}
                </p>
                {visaExpanded && visaExtra ? (
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                    {visaExtra}
                  </p>
                ) : null}
                <div className="mt-auto flex items-end justify-between gap-2 pt-3">
                  {visaExtra ? (
                    <button
                      type="button"
                      onClick={() => setVisaExpanded((v) => !v)}
                      className="text-sm font-medium text-sky-700 hover:underline"
                    >
                      {visaExpanded ? "Hide details ‹" : "Show details ›"}
                    </button>
                  ) : (
                    <span />
                  )}
                  <span className="inline-flex shrink-0 items-center rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-medium text-orange-700">
                    Requires verification
                  </span>
                </div>
              </div>
            ) : null}

            {details?.climate?.description ? (
              <div className="flex flex-col rounded-2xl bg-surface px-4 py-3.5">
                <SectionHeader icon={Sun} label="Climate" />
                <p className="mt-2.5 text-sm leading-relaxed text-text">
                  {details.climate.description}
                </p>
                {climateTemp ? (
                  <div className="mt-auto pt-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-800">
                      <Thermometer className="h-3 w-3" strokeWidth={2} />
                      {climateTemp}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Practical info */}
          {hasPractical && details?.practicalInfo ? (
            <div className="rounded-2xl bg-surface px-4 py-3.5">
              <SectionHeader icon={Car} label="Practical info" />
              <div className="mt-3 overflow-hidden rounded-xl ring-1 ring-border/70">
                <table className="w-full border-collapse text-left text-sm">
                  <tbody>
                    {details.practicalInfo.transport ? (
                      <PracticalRow
                        label="Transport"
                        value={details.practicalInfo.transport}
                      />
                    ) : null}
                    {details.practicalInfo.walkability ? (
                      <PracticalRow
                        label="Walkability"
                        value={details.practicalInfo.walkability}
                      />
                    ) : null}
                    {details.practicalInfo.payment ? (
                      <PracticalRow
                        label="Payment"
                        value={details.practicalInfo.payment}
                      />
                    ) : null}
                    {details.practicalInfo.safety ? (
                      <PracticalRow
                        label="Safety"
                        value={details.practicalInfo.safety}
                      />
                    ) : null}
                    {details.practicalInfo.tips?.length ? (
                      <tr className="border-t border-border/70 bg-white/50 first:border-t-0">
                        <th
                          scope="row"
                          className="w-[34%] align-top px-3 py-2.5 font-semibold text-text sm:w-36"
                        >
                          Travel tips
                        </th>
                        <td className="px-3 py-2.5 text-text-secondary">
                          <ul className="list-disc space-y-1 pl-4 leading-relaxed">
                            {details.practicalInfo.tips.map((tip) => (
                              <li key={tip}>{tip}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Useful apps — destination-specific traveler prep */}
          {usefulApps.length > 0 ? (
            <div className="rounded-2xl bg-surface px-4 py-3.5">
              <SectionHeader icon={Smartphone} label="Useful apps" />
              <ul className="mt-3 divide-y divide-border/70 overflow-hidden rounded-xl ring-1 ring-border/70">
                {usefulApps.map((app) => (
                  <UsefulAppRow key={`${app.category}-${app.name}`} app={app} />
                ))}
              </ul>
            </div>
          ) : null}

          <p className="flex items-center gap-1.5 pt-1 text-xs text-text-muted">
            <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
            Last checked:{" "}
            {new Date(data.generatedAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        </div>
      ) : null}

      {phase !== "ask-citizenship" ? (
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

function SectionHeader({
  icon: Icon,
  label,
}: {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-text-secondary ring-1 ring-border/80">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      </span>
      <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </p>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}) {
  if (!value) return null;
  return (
    <div className="rounded-2xl bg-surface px-4 py-3.5">
      <SectionHeader icon={icon} label={label} />
      <p className="mt-2.5 text-sm font-semibold leading-snug text-text">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs leading-relaxed text-text-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function PracticalRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-t border-border/70 bg-white/50 first:border-t-0">
      <th
        scope="row"
        className="w-[34%] align-top px-3 py-2.5 font-semibold text-text sm:w-36"
      >
        {label}
      </th>
      <td className="px-3 py-2.5 leading-relaxed text-text-secondary">
        {value}
      </td>
    </tr>
  );
}

const USEFUL_APP_META: Record<
  UsefulAppCategory,
  { label: string; icon: LucideIcon }
> = {
  taxi: { label: "Taxi", icon: Car },
  transport: { label: "Transport", icon: Bus },
  maps: { label: "Maps", icon: Map },
  food: { label: "Food", icon: UtensilsCrossed },
  booking: { label: "Booking", icon: Ticket },
  payments: { label: "Payments", icon: CreditCard },
  translation: { label: "Translation", icon: Languages },
  local: { label: "Local", icon: Smartphone },
};

function getUsefulApps(
  data: CityIntelligenceResult | null,
  details?: CityIntelligenceDetails
): UsefulApp[] {
  const apps = data?.usefulApps ?? details?.usefulApps;
  if (!apps?.length) return [];
  return apps.filter((app) => app.isRecommended !== false).slice(0, 8);
}

function UsefulAppRow({ app }: { app: UsefulApp }) {
  const meta = USEFUL_APP_META[app.category] ?? USEFUL_APP_META.local;
  const Icon = meta.icon;
  const blurb = app.description || app.whyUseful;

  return (
    <li className="flex items-start gap-3 bg-white/50 px-3 py-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-text-secondary ring-1 ring-border/80">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
          {meta.label}
        </p>
        <p className="text-sm font-semibold text-text">{app.name}</p>
        {blurb ? (
          <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
            {blurb}
          </p>
        ) : null}
        {app.officialUrl ? (
          <a
            href={app.officialUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline"
          >
            Open app
            <ExternalLink className="h-3 w-3" strokeWidth={2} aria-hidden />
          </a>
        ) : null}
      </div>
    </li>
  );
}

function buildCityPlaceDescription(
  city: { cityName: string; countryName: string },
  data: CityIntelligenceResult | null
): string {
  const lines: string[] = [
    `Saved from City Intelligence — ${city.cityName}, ${city.countryName}.`,
  ];

  if (!data) {
    lines.push("Travel info was not loaded yet when this place was saved.");
    return lines.join("\n");
  }

  const details = data.details;
  const currency = details?.currency
    ? [details.currency.name, details.currency.code && `(${details.currency.code})`]
        .filter(Boolean)
        .join(" ")
    : data.currency;
  if (currency) lines.push(`Currency: ${currency}`);

  if (data.exchangeRate) {
    lines.push(
      `Exchange: 1 ${data.exchangeRate.from} ≈ ${data.exchangeRate.rate} ${data.exchangeRate.to}`
    );
  }

  const bestTime =
    data.bestTimeToVisit?.summary ||
    details?.bestTimeToVisit?.description ||
    details?.bestTimeToVisit?.months?.join(", ");
  if (bestTime) lines.push(`Best time: ${bestTime}`);

  const visa =
    data.visaRequirements?.summary || details?.visa?.description;
  if (visa) lines.push(`Visa: ${visa}`);

  const budget = formatBudget(data, details);
  if (budget) lines.push(`Daily budget: ${budget}`);

  if (details?.climate?.description) {
    lines.push(`Climate: ${details.climate.description}`);
  }

  if (details?.practicalInfo?.transport) {
    lines.push(`Transport: ${details.practicalInfo.transport}`);
  }
  if (details?.practicalInfo?.safety) {
    lines.push(`Safety: ${details.practicalInfo.safety}`);
  }

  lines.push(CITY_INTELLIGENCE_DISCLAIMER);
  return lines.join("\n");
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
  const description = buildCityPlaceDescription(city, data);
  // Localized display names slugify to "unknown" — resolve English/ASCII ids from coords.
  const englishIds = await resolveEnglishPlaceIds(city.lat, city.lon);
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
    (cityData.googlePlaceId
      ? await fetchPlacePhotoUrl(cityData.googlePlaceId)
      : null);

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

function getCurrencyParts(
  data: CityIntelligenceResult,
  details?: CityIntelligenceDetails
): { primary: string; symbol?: string } {
  if (details?.currency) {
    const { name, code, symbol } = details.currency;
    const primary = [name, code && `(${code})`].filter(Boolean).join(" ");
    return {
      primary: primary || data.currency,
      symbol: symbol || undefined,
    };
  }
  return { primary: data.currency };
}

function formatBestTimePrimary(
  data: CityIntelligenceResult,
  details?: CityIntelligenceDetails
): string {
  if (data.bestTimeToVisit?.months?.length) {
    return data.bestTimeToVisit.months.join(", ");
  }
  if (details?.bestTimeToVisit?.months?.length) {
    return details.bestTimeToVisit.months.join(", ");
  }
  return (
    data.bestTimeToVisit?.summary ||
    details?.bestTimeToVisit?.season ||
    details?.bestTimeToVisit?.description ||
    ""
  );
}

function formatBestTimeHint(
  data: CityIntelligenceResult,
  details?: CityIntelligenceDetails
): string | undefined {
  const monthsShown =
    Boolean(data.bestTimeToVisit?.months?.length) ||
    Boolean(details?.bestTimeToVisit?.months?.length);
  if (!monthsShown) return undefined;
  return (
    data.bestTimeToVisit?.summary ||
    details?.bestTimeToVisit?.description ||
    details?.bestTimeToVisit?.season
  );
}

function formatVisaSummary(
  data: CityIntelligenceResult,
  details?: CityIntelligenceDetails
): string {
  return (
    data.visaRequirements?.summary ||
    details?.visa?.description ||
    (details?.visa?.required === true
      ? "Visa required"
      : details?.visa?.required === false
        ? "Visa not required"
        : details?.visa
          ? "Visa status unknown"
          : "")
  );
}

function formatVisaExtra(
  data: CityIntelligenceResult,
  details?: CityIntelligenceDetails
): string | null {
  const visa = details?.visa;
  const parts: string[] = [];
  if (visa?.type) parts.push(`Type: ${visa.type}`);
  if (visa?.cost?.amount != null) {
    const cur = visa.cost.currency ? ` ${visa.cost.currency}` : "";
    parts.push(`Approx. cost: ${visa.cost.amount}${cur}`);
  }
  const source = data.visaRequirements?.source;
  if (source) parts.push(`Source: ${source}`);
  return parts.length ? parts.join(" · ") : null;
}

function getSafeRateValues(
  data: CityIntelligenceResult,
  details?: CityIntelligenceDetails
): { score: number; outOf: number; summary?: string } | null {
  if (data.safeRate) {
    return {
      score: data.safeRate.score,
      outOf: data.safeRate.outOf,
      summary: data.safeRate.summary,
    };
  }
  const nested = details?.practicalInfo?.safeRate;
  if (nested?.score != null && Number.isFinite(nested.score)) {
    return {
      score: nested.score,
      outOf: nested.outOf || 10,
      summary: nested.summary || details?.practicalInfo?.safety,
    };
  }
  return null;
}

function safeRateTone(normalized: number): {
  label: string;
  soft: string;
  text: string;
  badge: string;
} {
  if (normalized >= 0.8) {
    return {
      label: "Very safe",
      soft: "bg-success-background",
      text: "text-success",
      badge: "bg-success/15 text-success",
    };
  }
  if (normalized >= 0.6) {
    return {
      label: "Generally safe",
      soft: "bg-emerald-50",
      text: "text-emerald-700",
      badge: "bg-emerald-100 text-emerald-800",
    };
  }
  if (normalized >= 0.4) {
    return {
      label: "Moderate",
      soft: "bg-warning-background",
      text: "text-warning",
      badge: "bg-amber-100 text-amber-800",
    };
  }
  if (normalized >= 0.2) {
    return {
      label: "Use caution",
      soft: "bg-orange-50",
      text: "text-orange-700",
      badge: "bg-orange-100 text-orange-800",
    };
  }
  return {
    label: "Higher risk",
    soft: "bg-error-background",
    text: "text-error",
    badge: "bg-red-100 text-red-800",
  };
}

function SafeRateCard({
  data,
  details,
}: {
  data: CityIntelligenceResult;
  details?: CityIntelligenceDetails;
}) {
  const values = getSafeRateValues(data, details);
  if (!values) return null;

  const { score, outOf, summary } = values;
  const normalized = outOf > 0 ? Math.min(1, Math.max(0, score / outOf)) : 0;
  const percent = Math.round(normalized * 100);
  const tone = safeRateTone(normalized);
  const hint =
    summary ||
    details?.practicalInfo?.safeRate?.summary ||
    details?.practicalInfo?.safety;
  const scoreLabel = score % 1 === 0 ? score.toFixed(0) : score.toFixed(1);

  return (
    <div className={`relative overflow-hidden rounded-2xl ${tone.soft} px-4 py-4`}>
      <CityscapeSilhouette />

      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <SectionHeader icon={ShieldCheck} label="Safety rate" />
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
            <p className="text-3xl font-semibold leading-none tracking-tight text-text">
              {scoreLabel}
              <span className="ml-1 text-base font-medium text-text-secondary">
                / {outOf}
              </span>
            </p>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${tone.badge}`}
            >
              {tone.label}
            </span>
          </div>
        </div>
        {hint ? (
          <p className="max-w-sm text-sm leading-relaxed text-text-secondary sm:pt-6 sm:text-right">
            {hint}
          </p>
        ) : null}
      </div>

      <div className="relative mt-4">
        <div
          className="relative h-2.5 rounded-full"
          style={{
            background:
              "linear-gradient(90deg, #ef4444 0%, #f59e0b 28%, #22c55e 62%, #86efac 100%)",
          }}
        >
          <span
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-emerald-600 shadow-sm"
            style={{ left: `${percent}%` }}
            aria-hidden
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] font-medium text-text-muted">
          <span>Higher risk</span>
          <span>More safe</span>
        </div>
      </div>
    </div>
  );
}

function CityscapeSilhouette() {
  return (
    <svg
      className="pointer-events-none absolute inset-y-0 right-0 h-full w-[55%] text-emerald-900/10"
      viewBox="0 0 320 160"
      fill="currentColor"
      aria-hidden
      preserveAspectRatio="xMaxYMid meet"
    >
      <path d="M40 160V95h18v65H40zm22 0V78h14l8-18h10l8 18h12v82H62zm48 0V88h20v72H110zm24 0V70h16v-22h12v22h10v90H134zm42 0V82h28v78H176zm32 0V60h18V38l16-20 16 20v22h14v100H208zm68 0V90h24v70H276z" />
      <path d="M250 38c0-14 10-26 22-30 2 8 6 14 12 18-8 2-14 8-16 16h-18z" />
    </svg>
  );
}

function formatBudget(
  data: CityIntelligenceResult,
  details?: CityIntelligenceDetails
): string {
  if (data.approximateDailyBudget) {
    return `${data.approximateDailyBudget.amount} ${data.approximateDailyBudget.currency} / day`;
  }
  const mid = details?.dailyBudget?.midRange?.local;
  const currency = details?.dailyBudget?.currency;
  if (mid != null && currency) {
    return `~${mid} ${currency} / day (mid-range)`;
  }
  return details?.dailyBudget?.description ?? "";
}

function formatTemperature(avg?: {
  min?: number | null;
  max?: number | null;
  unit?: string;
}): string | undefined {
  if (!avg) return undefined;
  const { min, max, unit } = avg;
  if (min == null && max == null) return undefined;
  const u = unit ?? "°C";
  if (min != null && max != null) return `Avg ${min}–${max}${u}`;
  if (min != null) return `Avg from ${min}${u}`;
  return `Avg up to ${max}${u}`;
}
