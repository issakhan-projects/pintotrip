"use client";

import { useEffect, useMemo, useState } from "react";
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
  Tag,
  X,
} from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { CURRENCY_OPTIONS, resolveCurrencyCode } from "@/lib/currencies";
import {
  countryIdFromParts,
  isAsciiId,
  slugifyId,
} from "@/lib/utils";
import { resolveCountryCode } from "@/lib/countries";
import {
  resolveEnglishPlaceIds,
  resolveEnglishPlaceIdsFromAddress,
} from "@/lib/maps";
import { timestampFromDate } from "@/services/trip-planner";
import type { TripPlannerDoc, TripPlannerUpdateInput } from "@/types/trip-planner";
import {
  autocompleteDestinations,
  fetchDestinationPhotos,
  type GeocodedPlace,
} from "./destinationSearch";
import { currencySymbolForCode } from "./tripUtils";
import { TripDateRangeField } from "./TripDateRangeField";

interface EditTripSheetProps {
  open: boolean;
  onClose: () => void;
  trip: TripPlannerDoc;
  onSave: (input: TripPlannerUpdateInput) => Promise<void>;
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

function destinationChanged(
  trip: TripPlannerDoc,
  next: GeocodedPlace
): boolean {
  const sameCity =
    trip.destination.cityName.trim().toLowerCase() ===
    next.cityName.trim().toLowerCase();
  const sameCountry =
    trip.destination.countryName.trim().toLowerCase() ===
    next.countryName.trim().toLowerCase();
  return !(sameCity && sameCountry);
}

/**
 * Edit basic trip fields (name, from, destination, dates, currency).
 */
export function EditTripSheet({
  open,
  onClose,
  trip,
  onSave,
}: EditTripSheetProps) {
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
        <EditTripForm
          key={trip.id}
          trip={trip}
          onClose={onClose}
          onSave={onSave}
        />
      ) : null}
    </Sheet>
  );
}

function EditTripForm({
  trip,
  onClose,
  onSave,
}: {
  trip: TripPlannerDoc;
  onClose: () => void;
  onSave: (input: TripPlannerUpdateInput) => Promise<void>;
}) {
  const [tripName, setTripName] = useState(trip.name);
  const [fromValue, setFromValue] = useState(() =>
    [trip.from.cityName, trip.from.countryName].filter(Boolean).join(", ")
  );
  const [destination, setDestination] = useState<GeocodedPlace>(() => ({
    cityName: trip.destination.cityName,
    countryName: trip.destination.countryName,
    label: [trip.destination.cityName, trip.destination.countryName]
      .filter(Boolean)
      .join(", "),
    lat: trip.destination.lat,
    lon: trip.destination.lon,
    photos: trip.destination.photos,
  }));
  const [searchQuery, setSearchQuery] = useState(
    () =>
      [trip.destination.cityName, trip.destination.countryName]
        .filter(Boolean)
        .join(", ")
  );
  const [searchResults, setSearchResults] = useState<GeocodedPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => ({
    from: trip.startDate.toDate(),
    to: trip.endDate.toDate(),
  }));
  const [currencyCode, setCurrencyCode] = useState(
    () => resolveCurrencyCode(trip.currency.code) || trip.currency.code || "USD"
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }

    // Don't search while the query still matches the selected destination label.
    if (
      destination &&
      q.toLowerCase() === destination.label.trim().toLowerCase()
    ) {
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
  }, [searchQuery, destination]);

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

  async function applyDestination(place: GeocodedPlace) {
    setDestination(place);
    setSearchQuery(place.label);
    setSearchResults([]);
    const photos = await fetchDestinationPhotos(place);
    if (photos.length === 0) return;
    setDestination((prev) => {
      if (!prev) return prev;
      if (
        prev.cityName !== place.cityName ||
        prev.countryName !== place.countryName
      ) {
        return prev;
      }
      return { ...prev, photos };
    });
  }

  async function handleSave() {
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

    setSaving(true);
    setError(null);

    try {
      const name = tripName.trim() || `${destination.cityName} Trip`;
      const currencyMeta = CURRENCY_OPTIONS.find((c) => c.code === currencyCode);
      const startDate = timestampFromDate(dateRange.from);
      const endDate = timestampFromDate(dateRange.to);
      const destChanged = destinationChanged(trip, destination);

      let englishDestIds = null as Awaited<
        ReturnType<typeof resolveEnglishPlaceIds>
      >;
      if (
        typeof destination.lat === "number" &&
        typeof destination.lon === "number" &&
        Number.isFinite(destination.lat) &&
        Number.isFinite(destination.lon)
      ) {
        englishDestIds = await resolveEnglishPlaceIds(
          destination.lat,
          destination.lon
        );
      }
      if (!englishDestIds) {
        englishDestIds = await resolveEnglishPlaceIdsFromAddress(
          [destination.cityName, destination.countryName]
            .filter(Boolean)
            .join(", ")
        );
      }

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
          : null) ||
        (isAsciiId(trip.destination.cityId)
          ? trip.destination.cityId
          : null);

      if (!isAsciiId(destCountryId) || !destCityId) {
        setError(
          "Couldn’t resolve destination. Try searching again."
        );
        return;
      }

      const englishFromIds = await resolveEnglishPlaceIdsFromAddress(
        [fromCity.trim(), fromCountry.trim()].filter(Boolean).join(", ")
      );
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

      const patch: TripPlannerUpdateInput = {
        name,
        from: {
          countryName: fromCountry.trim(),
          countryId: fromCountryId,
          cityName: fromCityName || undefined,
          ...(fromCityId ? { cityId: fromCityId } : {}),
          lat: trip.from.lat,
          lon: trip.from.lon,
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
              : trip.destination.lat,
          lon:
            typeof destination.lon === "number" &&
            Number.isFinite(destination.lon)
              ? destination.lon
              : trip.destination.lon,
          photos:
            destination.photos?.length
              ? destination.photos
              : trip.destination.photos,
        },
        startDate,
        endDate,
        currency: {
          code: currencyCode,
          name: currencyMeta?.name ?? currencyCode,
          symbol: currencySymbolForCode(currencyCode),
        },
      };

      if (destChanged) {
        patch.cityIntelligence = { status: "pending" };
      }

      await onSave(patch);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save trip.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
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
          Edit trip
        </p>
        <h2 className="mt-1.5 pr-10 text-2xl font-semibold tracking-tight text-text">
          Update trip details
        </h2>
        <p className="mt-1.5 max-w-md text-sm text-text-secondary">
          Change name, route, dates, or currency for this trip.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <label className="block space-y-2">
          <span className="flex items-center gap-1.5 text-sm font-medium text-text">
            <Tag className="h-3.5 w-3.5 text-text-muted" aria-hidden />
            Trip name
          </span>
          <TextInput
            value={tripName}
            onChange={(e) => setTripName(e.target.value)}
            placeholder="e.g. Istanbul weekend"
          />
        </label>

        <div className="space-y-2">
          <span className="flex items-center gap-1.5 text-sm font-medium text-text">
            <MapPin className="h-3.5 w-3.5 text-text-muted" aria-hidden />
            Destination
            <span className="text-error" aria-hidden>
              *
            </span>
          </span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <TextInput
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search a city"
              className="!pl-9"
            />
          </div>
          {searching ? (
            <p className="text-xs text-text-muted">Searching…</p>
          ) : null}
          {searchResults.length > 0 ? (
            <ul className="overflow-hidden rounded-xl border border-border bg-surface-elevated">
              {searchResults.slice(0, 6).map((place) => (
                <li key={`${place.label}-${place.lat}-${place.lon}`}>
                  <button
                    type="button"
                    onClick={() => void applyDestination(place)}
                    className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm hover:bg-surface"
                  >
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                    <span>
                      <span className="block font-medium text-text">
                        {place.cityName}
                      </span>
                      <span className="block text-xs text-text-secondary">
                        {place.countryName}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {destination ? (
            <p className="rounded-xl bg-primary-tint px-3 py-2 text-sm text-primary">
              Selected:{" "}
              <span className="font-semibold">
                {destination.cityName}, {destination.countryName}
              </span>
            </p>
          ) : null}
        </div>

        <label className="block space-y-2">
          <span className="flex items-center gap-1.5 text-sm font-medium text-text">
            <Plane className="h-3.5 w-3.5 text-text-muted" aria-hidden />
            From
            <span className="text-error" aria-hidden>
              *
            </span>
          </span>
          <TextInput
            value={fromValue}
            onChange={(e) => setFromValue(e.target.value)}
            placeholder="City, Country"
          />
        </label>

        <TripDateRangeField
          value={dateRange}
          onChange={setDateRange}
          minDate={null}
        />

        <div className="space-y-2">
          <span className="flex items-center gap-1.5 text-sm font-medium text-text">
            <CircleDollarSign className="h-3.5 w-3.5 text-text-muted" aria-hidden />
            Currency
          </span>
          <SearchableSelect
            value={currencyCode}
            onChange={setCurrencyCode}
            options={currencyOptions}
            placeholder="Select currency"
          />
        </div>

        {error ? (
          <p className="rounded-xl bg-error-background px-3 py-2.5 text-sm text-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-divider px-5 py-4">
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={saving}
            onClick={onClose}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            loading={saving}
            disabled={saving}
            onClick={() => void handleSave()}
            className="flex-1"
          >
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}
