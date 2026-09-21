"use client";

import { MapPin, Search } from "lucide-react";
import { TextInput } from "@/components/ui";
import { TravelMap } from "@/features/map/TravelMap";
import { cx } from "@/lib/utils";
import type { GeocodedPlace } from "./destinationSearch";

export type DestinationMode = "places" | "search" | "map";

export type CityGroupOption = {
  key: string;
  cityName: string;
  countryName: string;
  countryId: string;
  cityId: string;
  count: number;
  lat?: number;
  lon?: number;
  imageUrl?: string;
};

interface CreateTripDestinationPickerProps {
  cityGroups: CityGroupOption[];
  destinationMode: DestinationMode;
  onDestinationModeChange: (mode: DestinationMode) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  searchResults: GeocodedPlace[];
  searching: boolean;
  selectedLabel: string | null;
  selectedSavedKey: string | null;
  mapResolving: boolean;
  onPickSaved: (key: string) => void;
  onPickSearch: (place: GeocodedPlace) => void;
  onMapPick: (coords: { lat: number; lng: number }) => void;
}

export function CreateTripDestinationPicker({
  cityGroups,
  destinationMode,
  onDestinationModeChange,
  searchQuery,
  onSearchQueryChange,
  searchResults,
  searching,
  selectedLabel,
  selectedSavedKey,
  mapResolving,
  onPickSaved,
  onPickSearch,
  onMapPick,
}: CreateTripDestinationPickerProps) {
  const visibleSearchResults =
    searchQuery.trim().length < 2 ? [] : searchResults;

  return (
    <>
      <div className="relative mt-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <TextInput
          value={searchQuery}
          onChange={(e) => {
            onSearchQueryChange(e.target.value);
            if (destinationMode === "places") {
              onDestinationModeChange("search");
            }
          }}
          onFocus={() => {
            if (destinationMode === "places" && searchQuery.trim()) {
              onDestinationModeChange("search");
            }
          }}
          placeholder="Search a city, select from your places or choose on map"
          className="!pl-9"
        />
      </div>

      <div className="mt-3 flex gap-1 rounded-xl bg-surface p-1">
        {(
          [
            { id: "places", label: "My places" },
            { id: "search", label: "Search" },
            { id: "map", label: "On map" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onDestinationModeChange(tab.id)}
            className={cx(
              "flex-1 rounded-lg px-2.5 py-2 text-center text-sm font-medium transition-all",
              destinationMode === tab.id
                ? "bg-surface-elevated text-primary shadow-sm ring-1 ring-border/70"
                : "text-text-secondary hover:text-text"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {destinationMode === "places" ? (
          cityGroups.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-text-secondary">
              No saved cities yet. Use Search or On map.
            </p>
          ) : (
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
              {cityGroups.map((city) => {
                const selected = selectedSavedKey === city.key;
                return (
                  <button
                    key={city.key}
                    type="button"
                    onClick={() => onPickSaved(city.key)}
                    className={cx(
                      "w-[148px] shrink-0 overflow-hidden rounded-2xl border-2 bg-surface-elevated text-left transition-all",
                      selected
                        ? "border-primary shadow-md ring-2 ring-primary/15"
                        : "border-border hover:border-primary/35 hover:shadow-sm"
                    )}
                  >
                    <div className="relative aspect-[5/3.4] bg-surface">
                      {city.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={city.imageUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary-tint to-surface text-primary">
                          <MapPin className="h-6 w-6" />
                        </div>
                      )}
                      {selected ? (
                        <span className="absolute right-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                          Selected
                        </span>
                      ) : null}
                    </div>
                    <div className="px-3 py-2.5">
                      <p className="truncate text-sm font-semibold text-text">
                        {city.cityName}
                      </p>
                      <p className="truncate text-xs text-text-secondary">
                        {city.countryName}
                      </p>
                      <p className="mt-1 text-[11px] text-text-muted">
                        {city.count} saved place
                        {city.count === 1 ? "" : "s"}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )
        ) : null}

        {destinationMode === "search" ? (
          <div className="space-y-1">
            {searching ? (
              <p className="px-1 text-xs text-text-muted">Searching…</p>
            ) : null}
            {visibleSearchResults.length === 0 &&
            searchQuery.trim().length >= 2 &&
            !searching ? (
              <p className="rounded-2xl border border-dashed border-border bg-surface px-4 py-5 text-center text-sm text-text-secondary">
                No cities found. Try another search.
              </p>
            ) : null}
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {visibleSearchResults.map((result, i) => (
                <button
                  key={`${result.label}-${i}`}
                  type="button"
                  onClick={() => onPickSearch(result)}
                  className={cx(
                    "flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all",
                    selectedLabel === result.label
                      ? "border-primary bg-primary-tint shadow-sm ring-1 ring-primary/15"
                      : "border-transparent bg-surface-elevated hover:bg-surface"
                  )}
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-tint text-primary">
                    <MapPin className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 pt-0.5">
                    <span className="block truncate text-sm font-medium text-text">
                      {result.cityName}
                    </span>
                    <span className="text-xs text-text-secondary">
                      {result.countryName}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {destinationMode === "map" ? (
          <div className="overflow-hidden rounded-2xl border border-border shadow-sm">
            <div className="border-b border-divider bg-primary-tint px-3 py-2.5 text-xs font-medium text-primary">
              {mapResolving
                ? "Finding city…"
                : "Tap the map to choose your destination"}
            </div>
            <div className="h-48">
              <TravelMap
                className="h-full w-full"
                interactionMode="pick-city"
                fitToMarkers={false}
                centerOnCurrentLocation
                onMapClick={onMapPick}
              />
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
