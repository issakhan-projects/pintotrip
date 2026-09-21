"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { getFlagEmoji } from "country-flag-select";
import {
  DateRangePicker,
  type DateRangeValue,
} from "@/components/ui";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import type { SavedLocation } from "@/hooks/useLocations";
import type {
  TripDestinationStop,
  TripStopType,
} from "@/types/trip-planner";
import { TRIP_STOP_TYPE_OPTIONS } from "@/types/trip-planner";
import { cx, isAsciiId } from "@/lib/utils";
import { resolveCountryCode } from "@/lib/countries";
import { reverseGeocode } from "@/lib/maps";
import { groupLocationsByCountryCity } from "@/features/places/groupLocations";
import {
  autocompleteDestinations,
  fetchDestinationPhotos,
  type GeocodedPlace,
} from "./destinationSearch";
import {
  CreateTripDestinationPicker,
  type CityGroupOption,
  type DestinationMode,
} from "./CreateTripDestinationPicker";
import { destinationCountryKey } from "./tripDestinations";

export type EditDestDraft = {
  id: string;
  place: GeocodedPlace;
  savedKey: string | null;
  dateRange: DateRangeValue;
  stopType: TripStopType;
  original?: TripDestinationStop;
};

export function newEditDestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `d-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function placeFingerprint(place: GeocodedPlace): string {
  return `${place.countryName.trim().toLowerCase()}::${place.cityName.trim().toLowerCase()}`;
}

export function stopToEditDraft(
  stop: TripDestinationStop,
  index: number
): EditDestDraft {
  const countryCode =
    (stop.countryId && stop.countryId.length === 2
      ? stop.countryId.toUpperCase()
      : "") ||
    resolveCountryCode(stop.countryName) ||
    undefined;
  return {
    id: `${stop.cityId || stop.cityName}-${index}-${stop.countryId ?? ""}`,
    place: {
      cityName: stop.cityName,
      countryName: stop.countryName,
      label: [stop.cityName, stop.countryName].filter(Boolean).join(", "),
      lat: stop.lat,
      lon: stop.lon,
      photos: stop.photos,
      ...(countryCode ? { countryCode } : {}),
    },
    savedKey: null,
    dateRange: {
      ...(stop.startDate ? { from: stop.startDate.toDate() } : {}),
      ...(stop.endDate ? { to: stop.endDate.toDate() } : {}),
    },
    stopType: stop.stopType === "transit" ? "transit" : "destination",
    original: stop,
  };
}

function geocodedFromSaved(city: CityGroupOption): GeocodedPlace {
  const countryCode =
    resolveCountryCode(city.countryName) ||
    (isAsciiId(city.countryId) && city.countryId.length === 2
      ? city.countryId.toUpperCase()
      : "");
  return {
    cityName: city.cityName,
    countryName: city.countryName,
    ...(typeof city.lat === "number" && typeof city.lon === "number"
      ? { lat: city.lat, lon: city.lon }
      : {}),
    label: `${city.cityName}, ${city.countryName}`,
    photos: city.imageUrl ? [city.imageUrl] : undefined,
    ...(countryCode ? { countryCode } : {}),
  };
}

function formatCityDates(range: DateRangeValue): string {
  if (!range.from || !range.to) return "Dates not set";
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  });
  return `${fmt.format(range.from)} – ${fmt.format(range.to)}`;
}

function groupDraftsByCountry(items: EditDestDraft[]) {
  const groups: Array<{
    countryKey: string;
    countryName: string;
    countryCode: string;
    cities: EditDestDraft[];
  }> = [];
  const index = new Map<string, number>();

  for (const item of items) {
    const code =
      item.place.countryCode?.trim().toUpperCase() ||
      resolveCountryCode(item.place.countryName) ||
      "";
    const key = destinationCountryKey(
      item.place.countryName,
      item.original?.countryId
    );
    let i = index.get(key);
    if (i === undefined) {
      i = groups.length;
      index.set(key, i);
      groups.push({
        countryKey: key,
        countryName: item.place.countryName,
        countryCode: code,
        cities: [],
      });
    }
    groups[i]!.cities.push(item);
  }

  return groups;
}

interface EditTripDestinationsEditorProps {
  destinations: EditDestDraft[];
  onChange: Dispatch<SetStateAction<EditDestDraft[]>>;
  adding: boolean;
  onAddingChange: (value: boolean) => void;
  locations: SavedLocation[];
  tripDateRange: DateRangeValue;
  disabled?: boolean;
  /** When false, hide add/picker — remove existing cities only. */
  allowAdd?: boolean;
  onError: (message: string | null) => void;
}

export function EditTripDestinationsEditor({
  destinations,
  onChange,
  adding,
  onAddingChange,
  locations,
  tripDateRange,
  disabled,
  allowAdd = true,
  onError,
}: EditTripDestinationsEditorProps) {
  const [destinationMode, setDestinationMode] = useState<DestinationMode>(
    () => (locations.length > 0 ? "places" : "search")
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodedPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [mapResolving, setMapResolving] = useState(false);
  const [openCityDateId, setOpenCityDateId] = useState<string | null>(null);
  const [pendingStopType, setPendingStopType] = useState<TripStopType | null>(
    null
  );

  const cityGroups = useMemo<CityGroupOption[]>(() => {
    const countries = groupLocationsByCountryCity(locations);
    return countries.flatMap((country) =>
      country.cities.map((city) => {
        const sample = city.places[0];
        const withImage = city.places.find((p) => p.images[0]?.url);
        return {
          key: `${country.countryId}:${city.cityId}`,
          cityName: city.cityName,
          countryName: country.countryName,
          countryId: country.countryId,
          cityId: city.cityId,
          count: city.places.length,
          lat: sample?.lat,
          lon: sample?.lon,
          imageUrl: withImage?.images[0]?.url,
        };
      })
    );
  }, [locations]);

  const groups = useMemo(
    () => groupDraftsByCountry(destinations),
    [destinations]
  );

  const showPicker = allowAdd && (adding || destinations.length === 0);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!showPicker || q.length < 2) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void autocompleteDestinations(q)
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
  }, [searchQuery, showPicker]);

  function addDestination(place: GeocodedPlace, savedKey?: string | null) {
    if (!pendingStopType) {
      onError("Choose Destination or Transit before adding a city.");
      return;
    }
    if (destinations.some((d) => placeFingerprint(d.place) === placeFingerprint(place))) {
      onError("That city is already added.");
      return;
    }
    const id = newEditDestId();
    const next: EditDestDraft[] = [
      ...destinations,
      {
        id,
        place,
        savedKey: savedKey ?? null,
        dateRange: {},
        stopType: pendingStopType,
      },
    ];
    onChange(next);
    onAddingChange(false);
    setPendingStopType(null);
    setSearchQuery("");
    setSearchResults([]);
    onError(null);

    if (!place.photos?.length && savedKey == null) {
      void fetchDestinationPhotos(place).then((photos) => {
        if (photos.length === 0) return;
        onChange((prev) =>
          prev.map((d) =>
            d.id === id ? { ...d, place: { ...d.place, photos } } : d
          )
        );
      });
    }
  }

  function removeDestination(id: string) {
    if (destinations.length <= 1) return;
    const next = destinations.filter((d) => d.id !== id);
    onChange(next);
    if (allowAdd && next.length === 0) onAddingChange(true);
    setOpenCityDateId((current) => (current === id ? null : current));
  }

  function moveDestination(id: string, direction: -1 | 1) {
    const i = destinations.findIndex((d) => d.id === id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= destinations.length) return;
    const next = [...destinations];
    const current = next[i]!;
    next[i] = next[j]!;
    next[j] = current;
    onChange(next);
  }

  function pickSaved(key: string) {
    const city = cityGroups.find((c) => c.key === key);
    if (!city) return;
    addDestination(geocodedFromSaved(city), key);
  }

  async function handleMapPick(coords: { lat: number; lng: number }) {
    setMapResolving(true);
    onError(null);
    try {
      const place = await reverseGeocode(coords.lat, coords.lng);
      if (!place?.city && !place?.country) {
        onError("Couldn’t identify that location. Try another spot.");
        return;
      }
      addDestination({
        cityName: place.city || place.country,
        countryName: place.country || place.city,
        lat: place.lat,
        lon: place.lon,
        label: [place.city, place.country].filter(Boolean).join(", "),
        ...(place.countryCode ? { countryCode: place.countryCode } : {}),
      });
    } finally {
      setMapResolving(false);
    }
  }

  return (
    <div className="space-y-3">
      {groups.length > 0 ? (
        <div className="space-y-3">
          {groups.map((group) => {
            const flag = group.countryCode
              ? getFlagEmoji(group.countryCode)
              : "";
            return (
              <div
                key={group.countryKey}
                className="rounded-2xl border border-border bg-surface-elevated px-3 py-3"
              >
                <p className="text-sm font-semibold text-text">
                  {flag ? `${flag} ` : ""}
                  {group.countryName}
                </p>
                <ul className="mt-2 space-y-2 pl-2">
                  {group.cities.map((city) => {
                    const datesLabel = formatCityDates(city.dateRange);
                    const datesSet = Boolean(
                      city.dateRange.from && city.dateRange.to
                    );
                    const dateOpen = openCityDateId === city.id;
                    const flatIndex = destinations.findIndex(
                      (d) => d.id === city.id
                    );
                    return (
                      <li key={city.id}>
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-text">
                              {city.place.cityName}
                            </p>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {TRIP_STOP_TYPE_OPTIONS.map((option) => {
                                const selected = city.stopType === option.id;
                                return (
                                  <button
                                    key={option.id}
                                    type="button"
                                    disabled={disabled}
                                    aria-label={`${city.place.cityName}: ${option.label}`}
                                    onClick={() =>
                                      onChange(
                                        destinations.map((d) =>
                                          d.id === city.id
                                            ? { ...d, stopType: option.id }
                                            : d
                                        )
                                      )
                                    }
                                    className={cx(
                                      "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                                      selected
                                        ? option.id === "transit"
                                          ? "bg-text text-white"
                                          : "bg-primary text-white"
                                        : "bg-surface text-text-secondary hover:bg-divider hover:text-text"
                                    )}
                                  >
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="mt-1 flex items-center gap-1">
                              <button
                                type="button"
                                disabled={disabled}
                                onClick={() =>
                                  setOpenCityDateId(dateOpen ? null : city.id)
                                }
                                className={cx(
                                  "text-xs",
                                  datesSet
                                    ? "text-text-secondary hover:text-text"
                                    : "text-text-muted hover:text-text-secondary"
                                )}
                              >
                                {datesLabel}
                              </button>
                              {datesSet ? (
                                <button
                                  type="button"
                                  disabled={disabled}
                                  aria-label={`Clear dates for ${city.place.cityName}`}
                                  onClick={() =>
                                    onChange(
                                      destinations.map((d) =>
                                        d.id === city.id
                                          ? { ...d, dateRange: {} }
                                          : d
                                      )
                                    )
                                  }
                                  className="rounded p-0.5 text-text-muted hover:bg-surface hover:text-text"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              disabled={disabled || flatIndex <= 0}
                              aria-label={`Move ${city.place.cityName} earlier`}
                              onClick={() => moveDestination(city.id, -1)}
                              className="rounded-md p-1 text-text-muted hover:bg-surface hover:text-text disabled:opacity-30"
                            >
                              <ChevronUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={
                                disabled ||
                                flatIndex < 0 ||
                                flatIndex >= destinations.length - 1
                              }
                              aria-label={`Move ${city.place.cityName} later`}
                              onClick={() => moveDestination(city.id, 1)}
                              className="rounded-md p-1 text-text-muted hover:bg-surface hover:text-text disabled:opacity-30"
                            >
                              <ChevronDown className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={disabled || destinations.length <= 1}
                              aria-label={`Remove ${city.place.cityName}`}
                              onClick={() => removeDestination(city.id)}
                              className="rounded-md p-1 text-text-muted hover:bg-surface hover:text-text disabled:opacity-30"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        {dateOpen ? (
                          <div className="mt-2">
                            <DateRangePicker
                              key={`${city.id}-${city.dateRange.from?.getTime() ?? 0}-${city.dateRange.to?.getTime() ?? 0}`}
                              value={city.dateRange}
                              disabled={disabled}
                              minDate={tripDateRange.from ?? null}
                              onCancel={() => setOpenCityDateId(null)}
                              onApply={(next) => {
                                onChange(
                                  destinations.map((d) =>
                                    d.id === city.id
                                      ? { ...d, dateRange: next }
                                      : d
                                  )
                                );
                                setOpenCityDateId(null);
                              }}
                            />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}

      {showPicker ? (
        <div
          className={cx(
            destinations.length > 0 &&
              "rounded-2xl border border-border px-3 pb-3 pt-2"
          )}
        >
          {destinations.length > 0 ? (
            <div className="mb-1 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setPendingStopType(null);
                  onAddingChange(false);
                }}
                className="text-xs font-medium text-text-secondary hover:text-text"
              >
                Cancel
              </button>
            </div>
          ) : null}

          <div className="mb-3">
            <p className="text-xs font-medium text-text-secondary">
              City type <span className="text-error">*</span>
            </p>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {TRIP_STOP_TYPE_OPTIONS.map((option) => {
                const selected = pendingStopType === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setPendingStopType(option.id);
                      onError(null);
                    }}
                    className={cx(
                      "rounded-xl border px-3 py-2.5 text-left transition-colors",
                      selected
                        ? "border-primary bg-primary-tint text-primary"
                        : "border-border bg-surface-elevated text-text hover:border-primary/30"
                    )}
                  >
                    <span className="block text-sm font-medium">
                      {option.label}
                    </span>
                    <span
                      className={cx(
                        "mt-0.5 block text-[11px] leading-snug",
                        selected ? "text-primary/80" : "text-text-muted"
                      )}
                    >
                      {option.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {pendingStopType ? (
            <CreateTripDestinationPicker
              cityGroups={cityGroups}
              destinationMode={destinationMode}
              onDestinationModeChange={setDestinationMode}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              searchResults={searchResults}
              searching={searching}
              selectedLabel={null}
              selectedSavedKey={null}
              mapResolving={mapResolving}
              onPickSaved={pickSaved}
              onPickSearch={(place) => addDestination(place)}
              onMapPick={(coords) => void handleMapPick(coords)}
            />
          ) : (
            <p className="rounded-xl bg-surface px-3 py-2.5 text-sm text-text-secondary">
              Select Destination or Transit, then choose a city.
            </p>
          )}
        </div>
      ) : allowAdd ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setPendingStopType(null);
            onAddingChange(true);
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2.5 text-sm font-medium text-primary hover:border-primary/40 hover:bg-primary-tint"
        >
          <Plus className="h-4 w-4" />
          Add destination
        </button>
      ) : null}
    </div>
  );
}
