"use client";

import { Button } from "@/components/ui";
import { MapPin } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { SavedLocation } from "@/hooks/useLocations";
import { groupLocationsByCountryCity } from "@/features/places/groupLocations";

interface CountriesListViewProps {
  locations: SavedLocation[];
  onExploreMap: () => void;
}

export function CountriesListView({
  locations,
  onExploreMap,
}: CountriesListViewProps) {
  const groups = groupLocationsByCountryCity(locations);

  if (groups.length === 0) {
    return (
      <EmptyTravel
        title="No countries yet"
        body="Start discovering places and save them to your map."
        onExploreMap={onExploreMap}
      />
    );
  }

  return (
    <div className="space-y-2">
      {groups.map((country) => {
        const placeCount = country.cities.reduce(
          (sum, city) => sum + city.places.length,
          0
        );
        return (
          <div
            key={country.countryId}
            className="flex items-center justify-between rounded-xl bg-surface px-4 py-3"
          >
            <div>
              <p className="text-sm font-medium text-text">
                {country.countryName}
              </p>
              <p className="mt-0.5 text-xs text-text-secondary">
                {country.cities.length}{" "}
                {country.cities.length === 1 ? "city" : "cities"} · {placeCount}{" "}
                {placeCount === 1 ? "place" : "places"}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface PlacesFilterViewProps {
  locations: SavedLocation[];
  emptyTitle: string;
  emptyBody: string;
  onExploreMap: () => void;
  onSelectPlace?: (place: SavedLocation) => void;
}

export function PlacesFilterView({
  locations,
  emptyTitle,
  emptyBody,
  onExploreMap,
  onSelectPlace,
}: PlacesFilterViewProps) {
  if (locations.length === 0) {
    return (
      <EmptyTravel
        title={emptyTitle}
        body={emptyBody}
        onExploreMap={onExploreMap}
      />
    );
  }

  return (
    <div className="space-y-2">
      {locations.map((place) => (
        <button
          key={place.id}
          type="button"
          onClick={() => onSelectPlace?.(place)}
          className="flex w-full items-center gap-3 rounded-xl bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-elevated"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
            <MapPin className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-text">
              {place.title}
            </span>
            <span className="mt-0.5 block truncate text-xs text-text-secondary">
              {place.city.name}, {place.country.name}
            </span>
          </span>
          <StatusBadge status={place.status} />
        </button>
      ))}
    </div>
  );
}

function EmptyTravel({
  title,
  body,
  onExploreMap,
}: {
  title: string;
  body: string;
  onExploreMap: () => void;
}) {
  return (
    <div className="flex flex-col items-center px-2 py-10 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-tint text-primary">
        <MapPin className="h-6 w-6" />
      </div>
      <h3 className="text-base font-semibold text-text">{title}</h3>
      <p className="mt-2 max-w-xs text-sm text-text-secondary">{body}</p>
      <Button
        onClick={onExploreMap}
        className="mt-6 !bg-primary hover:!bg-primary-hover !border-primary !text-white"
      >
        Explore Map
      </Button>
    </div>
  );
}
