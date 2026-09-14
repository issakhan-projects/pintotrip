"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  TextInput,
  type DateRangeValue,
} from "@/components/ui";
import {
  CircleDollarSign,
  MapPin,
  Plane,
  Search,
  Sparkles,
  Tag,
  X,
} from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { TravelMap } from "@/features/map/TravelMap";
import type { SavedLocation } from "@/hooks/useLocations";
import type { UserProfile } from "@/types/user";
import { CURRENCY_OPTIONS, resolveCurrencyCode } from "@/lib/currencies";
import { slugifyId, countryIdFromParts, cx, isAsciiId } from "@/lib/utils";
import { resolveCountryCode } from "@/lib/countries";
import { reverseGeocode, resolveEnglishPlaceIds, resolveEnglishPlaceIdsFromAddress } from "@/lib/maps";
import type { EnglishPlaceIds } from "@/lib/maps";
import {
  createTrip,
  timestampFromDate,
} from "@/services/trip-planner";
import { buildDefaultPreparationItems } from "./buildPreparation";
import {
  autocompleteDestinations,
  fetchDestinationPhotos,
  type GeocodedPlace,
} from "./destinationSearch";
import { currencySymbolForCode } from "./tripUtils";
import { groupLocationsByCountryCity } from "@/features/places/groupLocations";
import {
  TripDateRangeField,
  defaultTripDateRange,
} from "./TripDateRangeField";

interface CreateTripSheetProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  profile: UserProfile | null;
  locations: SavedLocation[];
  onCreated?: (tripId: string) => void;
}

type DestinationMode = "places" | "search" | "map";

type CityGroupOption = {
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

export function CreateTripSheet({
  open,
  onClose,
  userId,
  profile,
  locations,
  onCreated,
}: CreateTripSheetProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      showClose={false}
      size="lg"
      className="md:max-w-xl"
      bodyClassName="!px-0 !py-0"
    >
      {open ? (
        <CreateTripForm
          key={`${userId}-${profile?.updatedAt?.toMillis?.() ?? "new"}`}
          userId={userId}
          profile={profile}
          locations={locations}
          onClose={onClose}
          onCreated={onCreated}
        />
      ) : null}
    </Sheet>
  );
}

function CreateTripForm({
  userId,
  profile,
  locations,
  onClose,
  onCreated,
}: {
  userId: string;
  profile: UserProfile | null;
  locations: SavedLocation[];
  onClose: () => void;
  onCreated?: (tripId: string) => void;
}) {
  const router = useRouter();
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

  const [destinationMode, setDestinationMode] = useState<DestinationMode>(
    cityGroups.length > 0 ? "places" : "search"
  );
  const [selectedSavedKey, setSelectedSavedKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodedPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [destination, setDestination] = useState<GeocodedPlace | null>(null);
  const [fromValue, setFromValue] = useState(() => {
    const city = profile?.city?.trim() ?? "";
    const country = profile?.country?.trim() ?? "";
    return [city, country].filter(Boolean).join(", ");
  });
  const [dateRange, setDateRange] = useState<DateRangeValue>(defaultTripDateRange);
  const [currencyCode, setCurrencyCode] = useState(
    () => resolveCurrencyCode(profile?.currency) || "USD"
  );
  const [tripName, setTripName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameTouched, setNameTouched] = useState(false);
  const [mapResolving, setMapResolving] = useState(false);

  useEffect(() => {
    if (destinationMode !== "search") return;
    const q = searchQuery.trim();
    if (q.length < 2) return;

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
  }, [searchQuery, destinationMode]);

  const visibleSearchResults =
    searchQuery.trim().length < 2 ? [] : searchResults;

  const currencyOptions = useMemo(
    () =>
      CURRENCY_OPTIONS.map((c) => {
        const symbol = currencySymbolForCode(c.code);
        return {
          value: c.code,
          label: `${c.code} — ${c.name} (${symbol})`,
          description: c.name,
        };
      }),
    []
  );

  function applyDestination(place: GeocodedPlace, savedKey?: string | null) {
    setDestination(place);
    setSelectedSavedKey(savedKey ?? null);
    setSearchQuery(place.label);
    if (!nameTouched) {
      setTripName(`${place.cityName} Trip`);
    }
  }

  async function applyDestinationWithPhotos(
    place: GeocodedPlace,
    savedKey?: string | null
  ) {
    applyDestination(place, savedKey);
    const photos = await fetchDestinationPhotos(place);
    if (photos.length === 0) return;
    setDestination((prev) => {
      if (!prev) return prev;
      if (
        prev.cityName !== place.cityName ||
        prev.countryName !== place.countryName ||
        prev.lat !== place.lat ||
        prev.lon !== place.lon
      ) {
        return prev;
      }
      return { ...prev, photos };
    });
  }

  function pickSaved(key: string) {
    const city = cityGroups.find((c) => c.key === key);
    if (!city) return;
    const countryCode =
      resolveCountryCode(city.countryName) ||
      (isAsciiId(city.countryId) && city.countryId.length === 2
        ? city.countryId.toUpperCase()
        : "");
    applyDestination(
      {
        cityName: city.cityName,
        countryName: city.countryName,
        ...(typeof city.lat === "number" && typeof city.lon === "number"
          ? { lat: city.lat, lon: city.lon }
          : {}),
        label: `${city.cityName}, ${city.countryName}`,
        photos: city.imageUrl ? [city.imageUrl] : undefined,
        ...(countryCode ? { countryCode } : {}),
      },
      key
    );
  }

  async function handleMapPick(coords: { lat: number; lng: number }) {
    setMapResolving(true);
    setError(null);
    try {
      const place = await reverseGeocode(coords.lat, coords.lng);
      if (!place?.city && !place?.country) {
        setError("Couldn’t identify that location. Try another spot.");
        return;
      }
      await applyDestinationWithPhotos({
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

  function parseFrom(value: string): { city: string; country: string } {
    const parts = value
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return { city: "", country: "" };
    if (parts.length === 1) return { city: "", country: parts[0]! };
    return {
      city: parts.slice(0, -1).join(", "),
      country: parts[parts.length - 1]!,
    };
  }

  async function resolveFromIds(
    fromCity: string,
    fromCountry: string
  ): Promise<EnglishPlaceIds | null> {
    if (
      typeof profile?.lat === "number" &&
      typeof profile?.lon === "number" &&
      Number.isFinite(profile.lat) &&
      Number.isFinite(profile.lon)
    ) {
      const fromCoords = await resolveEnglishPlaceIds(profile.lat, profile.lon);
      if (fromCoords) return fromCoords;
    }

    const label = [fromCity, fromCountry].filter(Boolean).join(", ");
    return resolveEnglishPlaceIdsFromAddress(label);
  }

  async function resolveDestinationIds(
    savedCity: CityGroupOption | null
  ): Promise<EnglishPlaceIds | null> {
    if (
      savedCity &&
      isAsciiId(savedCity.cityId) &&
      isAsciiId(savedCity.countryId)
    ) {
      return {
        cityId: savedCity.cityId.trim().toLowerCase(),
        countryId: savedCity.countryId.trim().toLowerCase(),
        countryCode:
          resolveCountryCode(savedCity.countryName) ||
          (savedCity.countryId.length === 2
            ? savedCity.countryId.toUpperCase()
            : ""),
        cityNameEn: savedCity.cityName,
        countryNameEn: savedCity.countryName,
      };
    }

    if (
      destination &&
      typeof destination.lat === "number" &&
      typeof destination.lon === "number" &&
      Number.isFinite(destination.lat) &&
      Number.isFinite(destination.lon)
    ) {
      const fromCoords = await resolveEnglishPlaceIds(
        destination.lat,
        destination.lon
      );
      if (fromCoords) return fromCoords;
    }

    if (!destination) return null;
    return resolveEnglishPlaceIdsFromAddress(
      [destination.cityName, destination.countryName].filter(Boolean).join(", ")
    );
  }

  async function handleCreate() {
    if (!destination?.cityName || !destination.countryName) {
      setError("Choose a destination.");
      return;
    }
    if (!dateRange.from || !dateRange.to) {
      setError("Select start and end dates.");
      return;
    }
    if (dateRange.to < dateRange.from) {
      setError("End date must be after start date.");
      return;
    }
    if (!currencyCode) {
      setError("Select a currency.");
      return;
    }

    const { city: fromCity, country: fromCountry } = parseFrom(fromValue);
    if (!fromCountry) {
      setError("Enter where you’re traveling from.");
      return;
    }

    const name = tripName.trim() || `${destination.cityName} Trip`;
    const currencyMeta = CURRENCY_OPTIONS.find((c) => c.code === currencyCode);
    const startDate = timestampFromDate(dateRange.from);
    const endDate = timestampFromDate(dateRange.to);

    setSaving(true);
    setError(null);
    try {
      let destinationPhotos = destination.photos ?? [];
      if (destinationPhotos.length === 0 && selectedSavedKey == null) {
        destinationPhotos = await fetchDestinationPhotos(destination);
      }

      const savedCity =
        selectedSavedKey != null
          ? cityGroups.find((c) => c.key === selectedSavedKey) ?? null
          : null;

      const [englishDestIds, englishFromIds] = await Promise.all([
        resolveDestinationIds(savedCity),
        resolveFromIds(fromCity.trim(), fromCountry.trim()),
      ]);

      const preparationItems = buildDefaultPreparationItems({
        destinationCity: destination.cityName,
        destinationCountry: destination.countryName,
        fromCountry: fromCountry.trim(),
        citizenship: profile?.citizenship,
      });

      const matchingPlaceIds =
        selectedSavedKey != null
          ? locations
              .filter((l) => {
                const city = cityGroups.find((c) => c.key === selectedSavedKey);
                if (!city) return false;
                return (
                  (l.city.id || l.city.name) === city.cityId &&
                  (l.country.id || l.country.name) === city.countryId
                );
              })
              .map((l) => l.id)
          : [];

      const destCountryCode =
        englishDestIds?.countryCode ||
        destination.countryCode ||
        resolveCountryCode(
          englishDestIds?.countryNameEn || destination.countryName
        ) ||
        undefined;

      const destCountryId = countryIdFromParts(
        englishDestIds?.countryNameEn || destination.countryName,
        destCountryCode
      );
      const destCityId =
        (englishDestIds?.cityId && isAsciiId(englishDestIds.cityId)
          ? englishDestIds.cityId
          : null) ||
        (isAsciiId(slugifyId(englishDestIds?.cityNameEn || ""))
          ? slugifyId(englishDestIds!.cityNameEn)
          : null) ||
        (isAsciiId(slugifyId(destination.cityName))
          ? slugifyId(destination.cityName)
          : null);

      if (!isAsciiId(destCountryId) || !destCityId) {
        setError(
          "Couldn’t resolve destination city/country ids. Try search again or pick on the map."
        );
        return;
      }

      const fromCountryCode =
        englishFromIds?.countryCode ||
        resolveCountryCode(
          englishFromIds?.countryNameEn || fromCountry.trim()
        ) ||
        undefined;
      const fromCountryId = countryIdFromParts(
        englishFromIds?.countryNameEn || fromCountry.trim(),
        fromCountryCode
      );
      const fromCityName = fromCity.trim() || englishFromIds?.cityNameEn || "";
      const fromCityId = fromCityName
        ? (englishFromIds?.cityId && isAsciiId(englishFromIds.cityId)
            ? englishFromIds.cityId
            : null) ||
          (isAsciiId(slugifyId(englishFromIds?.cityNameEn || ""))
            ? slugifyId(englishFromIds!.cityNameEn)
            : null) ||
          (isAsciiId(slugifyId(fromCityName))
            ? slugifyId(fromCityName)
            : null)
        : undefined;

      if (!isAsciiId(fromCountryId)) {
        setError(
          "Couldn’t resolve where you’re traveling from. Use a city and country name."
        );
        return;
      }

      const tripId = await createTrip({
        userId,
        name,
        from: {
          countryName: fromCountry.trim(),
          countryId: fromCountryId,
          cityName: fromCityName || undefined,
          ...(fromCityId ? { cityId: fromCityId } : {}),
          lat: profile?.lat,
          lon: profile?.lon,
        },
        destination: {
          cityName: destination.cityName,
          cityId: destCityId,
          countryName: destination.countryName,
          countryId: destCountryId,
          lat:
            typeof destination.lat === "number" &&
            Number.isFinite(destination.lat)
              ? destination.lat
              : undefined,
          lon:
            typeof destination.lon === "number" &&
            Number.isFinite(destination.lon)
              ? destination.lon
              : undefined,
          ...(destinationPhotos.length ? { photos: destinationPhotos } : {}),
        },
        startDate,
        endDate,
        status: "planning",
        currency: {
          code: currencyCode,
          name: currencyMeta?.name ?? currencyCode,
          symbol: currencySymbolForCode(currencyCode),
        },
        preparation: { items: preparationItems },
        savedPlaceIds: matchingPlaceIds,
        cityIntelligence: { status: "pending" },
        itinerary: { status: "empty", days: [] },
      });

      onCreated?.(tripId);
      onClose();
      router.push(`/trip-planner/${tripId}?step=preparation&new=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create trip.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="relative shrink-0 border-b border-divider px-5 pb-4 pt-5">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text"
        >
          <X className="h-5 w-5" />
        </button>
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          Create a new trip
        </p>
        <h2 className="mt-1.5 pr-10 text-2xl font-semibold tracking-tight text-text">
          Where are you going?
        </h2>
        <p className="mt-1.5 max-w-md text-sm text-text-secondary">
          Add a few details to create your trip and start planning.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {/* Destination */}
        <section>
          <FieldLabel icon={MapPin} required>
            Destination
          </FieldLabel>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <TextInput
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (destinationMode === "places") {
                  setDestinationMode("search");
                }
              }}
              onFocus={() => {
                if (destinationMode === "places" && searchQuery.trim()) {
                  setDestinationMode("search");
                }
              }}
              placeholder="Search a city, select from your places or choose on map"
              className="!pl-9"
            />
          </div>

          <div className="mt-3 flex gap-4 border-b border-divider">
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
                onClick={() => setDestinationMode(tab.id)}
                className={cx(
                  "relative -mb-px pb-2.5 text-sm font-medium transition-colors",
                  destinationMode === tab.id
                    ? "text-primary"
                    : "text-text-secondary hover:text-text"
                )}
              >
                {tab.label}
                {destinationMode === tab.id ? (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />
                ) : null}
              </button>
            ))}
          </div>

          <div className="mt-3">
            {destinationMode === "places" ? (
              cityGroups.length === 0 ? (
                <p className="rounded-2xl bg-surface px-4 py-6 text-center text-sm text-text-secondary">
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
                        onClick={() => pickSaved(city.key)}
                        className={cx(
                          "w-[148px] shrink-0 overflow-hidden rounded-2xl border-2 bg-surface-elevated text-left transition-colors",
                          selected
                            ? "border-primary shadow-sm"
                            : "border-border hover:border-primary/35"
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
                            <div className="flex h-full w-full items-center justify-center bg-primary-tint text-primary">
                              <MapPin className="h-6 w-6" />
                            </div>
                          )}
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
                  <p className="rounded-2xl bg-surface px-4 py-5 text-center text-sm text-text-secondary">
                    No cities found. Try another search.
                  </p>
                ) : null}
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {visibleSearchResults.map((result, i) => (
                    <button
                      key={`${result.label}-${i}`}
                      type="button"
                      onClick={() => {
                        void applyDestinationWithPhotos(result);
                      }}
                      className={cx(
                        "flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
                        destination?.label === result.label
                          ? "border-primary bg-primary-tint"
                          : "border-transparent hover:bg-surface"
                      )}
                    >
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>
                        <span className="block text-sm font-medium text-text">
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
              <div className="overflow-hidden rounded-2xl border border-border">
                <div className="border-b border-divider bg-primary-tint px-3 py-2 text-xs font-medium text-primary">
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
                    onMapClick={(coords) => {
                      void handleMapPick(coords);
                    }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {/* From */}
        <section>
          <FieldLabel icon={Plane}>From</FieldLabel>
          <div className="relative mt-2">
            <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <TextInput
              value={fromValue}
              onChange={(e) => setFromValue(e.target.value)}
              placeholder="City, Country"
              className="!pl-9 !pr-9"
            />
            {fromValue ? (
              <button
                type="button"
                aria-label="Clear from"
                onClick={() => setFromValue("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-text-muted hover:bg-surface hover:text-text"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </section>

        {/* Dates */}
        <TripDateRangeField
          value={dateRange}
          onChange={setDateRange}
          disabled={saving}
        />

        {/* Currency */}
        <section>
          <FieldLabel icon={CircleDollarSign}>Currency</FieldLabel>
          <div className="mt-2">
            <SearchableSelect
              value={currencyCode}
              onChange={setCurrencyCode}
              options={currencyOptions}
              placeholder="Select currency…"
              searchPlaceholder="Search currencies…"
            />
          </div>
        </section>

        {/* Trip name */}
        <section>
          <FieldLabel icon={Tag} required>
            Trip name
          </FieldLabel>
          <div className="relative mt-2">
            <TextInput
              value={tripName}
              onChange={(e) => {
                setNameTouched(true);
                setTripName(e.target.value);
              }}
              placeholder="Istanbul Trip"
              className="!pr-9"
            />
            {tripName ? (
              <button
                type="button"
                aria-label="Clear trip name"
                onClick={() => {
                  setNameTouched(true);
                  setTripName("");
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-text-muted hover:bg-surface hover:text-text"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </section>

        {/* Info banner */}
        <div className="flex items-start gap-3 rounded-2xl bg-primary-tint px-4 py-3.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-primary shadow-sm">
            <Sparkles className="h-4 w-4" />
          </span>
          <p className="text-sm leading-relaxed text-text">
            After creating your trip, we&apos;ll fetch useful information about
            your destination, prepare a personalized checklist and help you
            plan your itinerary.
          </p>
        </div>

        {error ? (
          <p className="rounded-xl bg-error-background px-3 py-2 text-sm text-error">
            {error}
          </p>
        ) : null}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-divider bg-surface-elevated px-5 py-4">
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onClose} className="w-full">
            Cancel
          </Button>
          <Button
            loading={saving}
            icon={Sparkles}
            onClick={() => void handleCreate()}
            className="w-full"
          >
            Create trip
          </Button>
        </div>
      </div>
    </div>
  );
}

function FieldLabel({
  icon: Icon,
  required,
  children,
}: {
  icon: typeof MapPin;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 text-sm font-medium text-text">
      <Icon className="h-3.5 w-3.5 text-text-muted" aria-hidden />
      <span>{children}</span>
      {required ? (
        <span className="text-error" aria-hidden>
          *
        </span>
      ) : null}
    </div>
  );
}
