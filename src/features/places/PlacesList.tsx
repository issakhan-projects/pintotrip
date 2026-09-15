"use client";

import { Button, StatusBadge } from "@/components/ui";
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
  Camera,
  ChevronDown,
  ChevronRight,
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
  Trees,
  UtensilsCrossed,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState, type MouseEvent, type PointerEvent } from "react";
import { groupLocationsByCountryCity } from "./groupLocations";

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

function countryThumb(places: SavedLocation[]) {
  for (const place of places) {
    const url = place.images[0]?.url;
    if (url) return url;
  }
  return undefined;
}

export function PlacesList({
  locations,
  loading,
  onSelectPlace,
  onAddPlace,
  onSelectCity,
}: PlacesListProps) {
  const groups = useMemo(
    () => groupLocationsByCountryCity(locations),
    [locations]
  );
  const [openCountries, setOpenCountries] = useState<Record<string, boolean>>(
    {}
  );
  const [openCities, setOpenCities] = useState<Record<string, boolean>>({});

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
    <div className="h-full overflow-y-auto bg-surface px-4 pb-28 pt-4">
      <h2 className="mb-4 text-lg font-semibold text-text">Places</h2>
      <div className="space-y-3">
        {groups.map((country) => {
          const countryOpen = openCountries[country.countryId] ?? true;
          const countryCode =
            resolveCountryCode(country.countryId) ||
            resolveCountryCode(country.countryName);
          const flag = countryCode ? getFlagEmoji(countryCode) : "";
          const allPlaces = country.cities.flatMap((city) => city.places);
          const thumb = countryThumb(allPlaces);

          return (
            <div key={country.countryId} className="space-y-2">
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-2xl bg-white px-3 py-3 text-left shadow-sm ring-1 ring-black/[0.03] transition-colors hover:bg-white"
                onClick={() =>
                  setOpenCountries((prev) => ({
                    ...prev,
                    [country.countryId]: !countryOpen,
                  }))
                }
              >
                {countryOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
                )}
                <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface text-xl leading-none">
                  {flag || <MapPin className="h-4 w-4 text-text-muted" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-text">
                    {country.countryName}
                  </span>
                  <span className="mt-0.5 block text-xs text-text-muted">
                    {placeCountLabel(country.total)}
                  </span>
                </span>
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumb}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface text-text-muted">
                    <Camera className="h-4 w-4" />
                  </span>
                )}
                <CountPill visited={country.visited} total={country.total} />
              </button>

              {countryOpen
                ? country.cities.map((city) => {
                    const cityKey = `${country.countryId}:${city.cityId}`;
                    const cityOpen = openCities[cityKey] ?? true;
                    const first = city.places[0];

                    function openCityInfo(
                      event: MouseEvent | PointerEvent
                    ) {
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
                      <div key={cityKey} className="space-y-2 pl-1 sm:pl-2">
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
                              onPointerDown={(event) =>
                                event.stopPropagation()
                              }
                              className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary-hover"
                            >
                              <MapPin className="h-3.5 w-3.5" />
                              Show on map
                            </button>
                          ) : null}

                          <CountPill
                            visited={city.visited}
                            total={city.total}
                          />
                        </div>

                        {cityOpen
                          ? city.places.map((place) => {
                              const image = place.images[0]?.url;
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
                  })
                : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
