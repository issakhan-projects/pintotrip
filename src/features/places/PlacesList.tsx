"use client";

import { Button, DeleteConfirmModal, StatusBadge } from "@/components/ui";
import { resolveCountryCode } from "@/lib/countries";
import { cx } from "@/lib/utils";
import type { SavedLocation } from "@/hooks/useLocations";
import {
  PLACE_CATEGORY_LABELS,
  type PlaceCategory,
} from "@/types/trip-plan";
import { getFlagEmoji } from "country-flag-select";
import {
  Binoculars,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Coffee,
  FerrisWheel,
  Landmark,
  MapPin,
  Moon,
  MoreHorizontal,
  Mountain,
  Plus,
  ShoppingBag,
  Store,
  TrainFront,
  Trash2,
  Trees,
  UtensilsCrossed,
  Waves,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import {
  groupLocationsByCountryCity,
  type CountryGroup,
} from "./groupLocations";

const SELECTED_COUNTRY_STORAGE_KEY = "pintototrip.places.selectedCountryId";

function readStoredCountryId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(SELECTED_COUNTRY_STORAGE_KEY);
    return value?.trim() || null;
  } catch {
    return null;
  }
}

function writeStoredCountryId(countryId: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (countryId) {
      window.localStorage.setItem(SELECTED_COUNTRY_STORAGE_KEY, countryId);
    } else {
      window.localStorage.removeItem(SELECTED_COUNTRY_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }
}

interface PlacesListProps {
  locations: SavedLocation[];
  loading?: boolean;
  onSelectPlace: (place: SavedLocation) => void;
  onAddPlace: () => void;
  onSelectCity?: (city: {
    cityName: string;
    countryName: string;
    lat: number;
    lon: number;
  }) => void;
  /** Delete every saved place under a city group. */
  onDeleteCity?: (places: SavedLocation[]) => Promise<void>;
  /**
   * When false (Free / Plus), skip Google Places / Maps photo URLs so list
   * thumbs do not trigger Place Photos billing. User uploads and Pexels stay.
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

function placeCoverUrl(
  place: SavedLocation,
  allowGooglePlacePhotos: boolean
): string | undefined {
  for (const image of place.images) {
    const url = image.url?.trim();
    if (!url) continue;
    if (!allowGooglePlacePhotos && isGoogleMapsPhotoUrl(url)) continue;
    return url;
  }
  return undefined;
}

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

const CATEGORY_TAG_TONES: Record<PlaceCategory, string> = {
  attraction: "bg-primary-tint text-primary",
  beach: "bg-sky-50 text-sky-700",
  museum: "bg-violet-50 text-violet-700",
  landmark: "bg-amber-50 text-amber-700",
  food: "bg-orange-50 text-orange-700",
  cafe: "bg-orange-50 text-orange-700",
  park: "bg-success-background text-success",
  viewpoint: "bg-sky-50 text-sky-700",
  nightlife: "bg-violet-50 text-violet-700",
  shopping: "bg-pink-50 text-pink-700",
  market: "bg-pink-50 text-pink-700",
  nature: "bg-success-background text-success",
  adventure: "bg-warning-background text-warning",
  wellness: "bg-sky-50 text-sky-700",
  neighborhood: "bg-primary-tint text-primary",
  transport: "bg-surface text-text-secondary",
  other: "bg-surface text-text-secondary",
};

function placeCountLabel(count: number) {
  return count === 1 ? "1 place" : `${count} places`;
}

function CountPill({ visited, total }: { visited: number; total: number }) {
  return (
    <span className="shrink-0 rounded-full bg-surface px-2.5 py-1 text-xs font-medium tabular-nums text-text-secondary">
      {visited}/{total}
    </span>
  );
}

function countryFlag(country: CountryGroup) {
  const countryCode =
    resolveCountryCode(country.countryId) ||
    resolveCountryCode(country.countryName);
  return countryCode ? getFlagEmoji(countryCode) : "";
}

export function PlacesList({
  locations,
  loading,
  onSelectPlace,
  onAddPlace,
  onSelectCity,
  onDeleteCity,
  allowGooglePlacePhotos = false,
}: PlacesListProps) {
  const groups = useMemo(
    () => groupLocationsByCountryCity(locations),
    [locations]
  );
  const [selectedCountryId, setSelectedCountryId] = useState<string | null>(
    null
  );
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const countryMenuRef = useRef<HTMLDivElement>(null);
  const [openCities, setOpenCities] = useState<Record<string, boolean>>({});
  const [cityPendingDelete, setCityPendingDelete] = useState<{
    cityName: string;
    places: SavedLocation[];
  } | null>(null);
  const [deletingCity, setDeletingCity] = useState(false);
  const [deleteCityError, setDeleteCityError] = useState<string | null>(null);

  // Restore last selected country once groups are available; stay empty if none.
  useEffect(() => {
    if (groups.length === 0) {
      setSelectedCountryId(null);
      return;
    }
    setSelectedCountryId((prev) => {
      if (prev && groups.some((g) => g.countryId === prev)) return prev;
      const stored = readStoredCountryId();
      if (stored && groups.some((g) => g.countryId === stored)) return stored;
      return null;
    });
  }, [groups]);

  useEffect(() => {
    if (!countryMenuOpen) return;

    function handlePointerDown(event: Event) {
      const target = event.target as Node | null;
      if (
        countryMenuRef.current &&
        target &&
        !countryMenuRef.current.contains(target)
      ) {
        setCountryMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setCountryMenuOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [countryMenuOpen]);

  const selectedCountry =
    groups.find((g) => g.countryId === selectedCountryId) ?? null;
  const selectedFlag = selectedCountry ? countryFlag(selectedCountry) : "";

  function selectCountry(countryId: string) {
    setSelectedCountryId(countryId);
    writeStoredCountryId(countryId);
    setCountryMenuOpen(false);
  }

  async function handleConfirmDeleteCity() {
    if (!onDeleteCity || !cityPendingDelete) return;
    setDeletingCity(true);
    setDeleteCityError(null);
    try {
      await onDeleteCity(cityPendingDelete.places);
      setCityPendingDelete(null);
    } catch (err) {
      const message =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: string }).code) === "permission-denied"
            ? "Could not delete this city (permission denied). Deploy Firestore rules, then try again."
            : `Could not delete this city (${String((err as { code: string }).code)}).`
          : err instanceof Error
            ? err.message
            : "Could not delete this city. Please try again.";
      setDeleteCityError(message);
    } finally {
      setDeletingCity(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3 bg-surface p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-2xl bg-white" />
        ))}
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-surface px-6 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-tint text-primary">
          <MapPin className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold text-text">
          Your travel map is empty.
        </h2>
        <p className="mt-2 max-w-xs text-sm text-text-secondary">
          Save places you discover and they&apos;ll appear here.
        </p>
        <Button
          onClick={onAddPlace}
          icon={Plus}
          className="mt-6 !bg-primary hover:!bg-primary-hover !border-primary !text-white"
        >
          Add your first place
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 pb-28 pt-4 mt-14">
      <DeleteConfirmModal
        open={Boolean(cityPendingDelete)}
        entity="city"
        description={
          cityPendingDelete ? (
            <>
              All {placeCountLabel(cityPendingDelete.places.length)} in{" "}
              <span className="font-medium text-text">
                {cityPendingDelete.cityName}
              </span>{" "}
              will be removed from your map and places. This can’t be undone.
              {deleteCityError ? (
                <span className="mt-3 block text-sm text-error">
                  {deleteCityError}
                </span>
              ) : null}
            </>
          ) : undefined
        }
        loading={deletingCity}
        onCancel={() => {
          if (!deletingCity) {
            setCityPendingDelete(null);
            setDeleteCityError(null);
          }
        }}
        onConfirm={() => void handleConfirmDeleteCity()}
      />

      <div
        ref={countryMenuRef}
        className="relative z-20 mb-4 flex items-center gap-2"
      >
        <span className="shrink-0 text-sm font-semibold text-text">
          Select country:
        </span>
        <div className="relative min-w-0 flex-1">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={countryMenuOpen}
            className="flex min-w-0 items-center gap-2 rounded-lg border border-primary bg-white px-3 py-2 text-left transition-colors hover:bg-primary-tint/40"
            onClick={() => setCountryMenuOpen((open) => !open)}
          >
            {selectedCountry ? (
              <>
                <span className="text-base leading-none">{selectedFlag}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">
                  {selectedCountry.countryName}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-primary/80">
                  {selectedCountry.total}
                </span>
              </>
            ) : (
              <span className="min-w-0 flex-1 truncate text-sm text-text-muted">
                Choose a country
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-primary" />
          </button>

          {countryMenuOpen ? (
            <div
              role="listbox"
              aria-label="Select country"
              className="absolute inset-x-0 top-[calc(100%+0.35rem)] max-h-72 overflow-y-auto rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-black/[0.06]"
            >
              {groups.map((country) => {
                const flag = countryFlag(country);
                const selected = country.countryId === selectedCountryId;

                return (
                  <button
                    key={country.countryId}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={cx(
                      "flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors",
                      selected
                        ? "bg-primary-tint/60"
                        : "hover:bg-surface"
                    )}
                    onClick={() => selectCountry(country.countryId)}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface text-base leading-none">
                      {flag || (
                        <MapPin className="h-4 w-4 text-text-muted" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-text">
                        {country.countryName}
                      </span>
                      <span className="mt-0.5 block text-xs text-text-muted">
                        {placeCountLabel(country.total)}
                      </span>
                    </span>
                    <CountPill
                      visited={country.visited}
                      total={country.total}
                    />
                    {selected ? (
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <span className="h-4 w-4 shrink-0" aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
        {!selectedCountry ? (
          <p className="px-1 py-6 text-center text-sm text-text-muted">
            Select a country to see your cities and places.
          </p>
        ) : null}
        {selectedCountry
          ? (() => {
              const country = selectedCountry;
              return country.cities.map((city) => {
              const cityKey = `${country.countryId}:${city.cityId}`;
              const cityOpen = openCities[cityKey] ?? true;
              const first = city.places[0];

              function openCityInfo(event: MouseEvent | PointerEvent) {
                event.preventDefault();
                event.stopPropagation();
                if (!onSelectCity || !first) return;
                onSelectCity({
                  cityName: city.cityName,
                  countryName: country.countryName,
                  lat: first.lat,
                  lon: first.lon,
                });
              }

              return (
                <div key={cityKey} className="space-y-2">
                  <div className="flex items-center gap-2 rounded-2xl bg-white px-3 py-3 shadow-sm ring-1 ring-black/[0.03]">
                    <button
                      type="button"
                      aria-label={
                        cityOpen
                          ? `Collapse ${city.cityName}`
                          : `Expand ${city.cityName}`
                      }
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() =>
                        setOpenCities((prev) => ({
                          ...prev,
                          [cityKey]: !cityOpen,
                        }))
                      }
                    >
                      {cityOpen ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
                      )}
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
                        <Building2 className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-text">
                          {city.cityName}
                        </span>
                        <span className="mt-0.5 block text-xs text-text-muted">
                          {placeCountLabel(city.total)}
                        </span>
                      </span>
                    </button>

                    {onSelectCity ? (
                      <button
                        type="button"
                        onClick={openCityInfo}
                        onPointerDown={(event) => event.stopPropagation()}
                        className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary-hover"
                      >
                        <MapPin className="h-3.5 w-3.5" />
                        Show on map
                      </button>
                    ) : null}

                    {onDeleteCity ? (
                      <button
                        type="button"
                        aria-label={`Delete ${city.cityName}`}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setCityPendingDelete({
                            cityName: city.cityName,
                            places: city.places,
                          });
                          setDeleteCityError(null);
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-error-background hover:text-error"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}

                    <CountPill visited={city.visited} total={city.total} />
                  </div>

                  {cityOpen
                    ? city.places.map((place) => {
                        const image = placeCoverUrl(
                          place,
                          allowGooglePlacePhotos
                        );
                        const category = place.category;
                        const CategoryIcon = category
                          ? PLACE_CATEGORY_ICONS[category]
                          : null;
                        const description =
                          place.description?.trim() ||
                          place.note?.trim() ||
                          "";

                        return (
                          <button
                            key={place.id}
                            type="button"
                            onClick={() => onSelectPlace(place)}
                            className="flex w-full gap-3 rounded-2xl bg-white p-3 text-left shadow-sm ring-1 ring-black/[0.03] transition-colors hover:bg-primary-tint/30"
                          >
                            <div className="h-28 w-28 shrink-0 overflow-hidden rounded-2xl bg-surface sm:h-32 sm:w-32">
                              {image ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={image}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full items-center justify-center text-text-muted">
                                  <MapPin className="h-6 w-6" />
                                </div>
                              )}
                            </div>

                            <div className="flex min-w-0 flex-1 flex-col">
                              <div className="flex items-start gap-2">
                                <p className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-text">
                                  {place.title}
                                </p>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  <StatusBadge
                                    status={place.status}
                                    iconOnly="mobile"
                                  />
                                  <span
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-surface text-text-muted"
                                    aria-hidden
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </span>
                                </div>
                              </div>

                              <p className="mt-1.5 flex items-center gap-1 text-xs text-text-secondary">
                                <MapPin className="h-3 w-3 shrink-0" />
                                <span className="truncate">
                                  {place.city.name}, {place.country.name}
                                </span>
                              </p>

                              {description ? (
                                <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-text-muted">
                                  {description}
                                </p>
                              ) : null}

                              <div className="mt-auto flex flex-wrap gap-1.5 pt-2.5">
                                <span className="inline-flex items-center gap-1 rounded-full bg-primary-tint px-2 py-0.5 text-[11px] font-medium text-primary">
                                  <Building2 className="h-3 w-3" />
                                  <span className="max-w-[7rem] truncate">
                                    {place.city.name}
                                  </span>
                                </span>
                                {category && CategoryIcon ? (
                                  <span
                                    className={cx(
                                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                                      CATEGORY_TAG_TONES[category]
                                    )}
                                  >
                                    <CategoryIcon className="h-3 w-3" />
                                    {PLACE_CATEGORY_LABELS[category]}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </button>
                        );
                      })
                    : null}
                </div>
              );
            });
            })()
          : null}
      </div>
    </div>
  );
}
