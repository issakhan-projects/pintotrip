"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  TextInput,
  type DateRangeValue,
} from "@/components/ui";
import {
  CircleDollarSign,
  Compass,
  MapPin,
  Plane,
  Tag,
  X,
} from "lucide-react";
import type { SavedLocation } from "@/hooks/useLocations";
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
  englishPlaceIdsFromNames,
  resolveTimezoneFromCoords,
} from "@/lib/maps";
import { timestampFromDate } from "@/services/trip-planner";
import type {
  TripDestinationStop,
  TripPlannerDoc,
  TripPlannerUpdateInput,
} from "@/types/trip-planner";
import {
  LEISURE_CUSTOM_MAX_LENGTH,
  LEISURE_TYPES,
  LEISURE_TYPE_OPTIONS,
  type LeisureType,
} from "@/types/trip-plan";
import { type GeocodedPlace } from "./destinationSearch";
import { currencySymbolForCode } from "./tripUtils";
import { TripDateRangeField } from "./TripDateRangeField";
import {
  EditTripDestinationsEditor,
  stopToEditDraft,
  type EditDestDraft,
} from "./EditTripDestinationsEditor";
import {
  isSaudiArabiaCountry,
  listTripDestinations,
  primaryTripDestination,
} from "./tripDestinations";

function leisureTypeFromTrip(trip: TripPlannerDoc): LeisureType {
  const value = trip.leisureType;
  if (value && (LEISURE_TYPES as readonly string[]).includes(value)) {
    return value;
  }
  return "mixed";
}

interface EditTripSheetProps {
  open: boolean;
  onClose: () => void;
  trip: TripPlannerDoc;
  locations?: SavedLocation[];
  onSave: (input: TripPlannerUpdateInput) => Promise<void>;
}

function destinationChanged(
  trip: TripPlannerDoc,
  next: GeocodedPlace
): boolean {
  const primary = primaryTripDestination(trip);
  const sameCity =
    primary.cityName.trim().toLowerCase() ===
    next.cityName.trim().toLowerCase();
  const sameCountry =
    primary.countryName.trim().toLowerCase() ===
    next.countryName.trim().toLowerCase();
  return !(sameCity && sameCountry);
}

/**
 * Edit trip fields. Origin is always fixed after create.
 * Ordinary: destination is fixed. Advanced: destinations can be added or removed.
 */
export function EditTripSheet({
  open,
  onClose,
  trip,
  locations = [],
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
          locations={locations}
          onClose={onClose}
          onSave={onSave}
        />
      ) : null}
    </Sheet>
  );
}

function EditTripForm({
  trip,
  locations,
  onClose,
  onSave,
}: {
  trip: TripPlannerDoc;
  locations: SavedLocation[];
  onClose: () => void;
  onSave: (input: TripPlannerUpdateInput) => Promise<void>;
}) {
  const [tripName, setTripName] = useState(trip.name);
  const [fromValue] = useState(() =>
    [trip.from.cityName, trip.from.countryName].filter(Boolean).join(", ")
  );
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => ({
    from: trip.startDate.toDate(),
    to: trip.endDate.toDate(),
  }));
  const [currencyCode, setCurrencyCode] = useState(
    () => resolveCurrencyCode(trip.currency.code) || trip.currency.code || "USD"
  );
  const [leisureType, setLeisureType] = useState<LeisureType>(() =>
    leisureTypeFromTrip(trip)
  );
  const [leisureCustom, setLeisureCustom] = useState(
    () => trip.leisureCustom?.trim() ?? ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdvanced = trip.createMode === "advanced";
  const initialCities = listTripDestinations(trip);
  const [destinations, setDestinations] = useState<EditDestDraft[]>(() =>
    isAdvanced ? initialCities.map(stopToEditDraft) : []
  );
  const [addingDestination, setAddingDestination] = useState(false);

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

  const hasSaudiDestination = useMemo(() => {
    if (isAdvanced) {
      return destinations.some((item) =>
        isSaudiArabiaCountry({
          countryCode: item.place.countryCode,
          countryName: item.place.countryName,
        })
      );
    }
    return listTripDestinations(trip).some((stop) =>
      isSaudiArabiaCountry({
        countryId: stop.countryId,
        countryName: stop.countryName,
      })
    );
  }, [isAdvanced, destinations, trip]);

  const leisureOptions = useMemo(
    () =>
      LEISURE_TYPE_OPTIONS.filter(
        (option) => option.value !== "umrah" || hasSaudiDestination
      ).map((option) => ({
        value: option.value,
        label: option.label,
        description: option.description,
      })),
    [hasSaudiDestination]
  );

  useEffect(() => {
    if (leisureType === "umrah" && !hasSaudiDestination) {
      setLeisureType("mixed");
    }
  }, [leisureType, hasSaudiDestination]);

  async function resolveTimezoneForCoords(
    lat?: number,
    lon?: number
  ): Promise<string | undefined> {
    if (
      typeof lat !== "number" ||
      typeof lon !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      return undefined;
    }
    try {
      return (await resolveTimezoneFromCoords(lat, lon))?.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  async function resolvePlaceToStop(
    place: GeocodedPlace,
    original?: TripDestinationStop
  ): Promise<TripDestinationStop | null> {
    const sameOriginal =
      original &&
      original.cityName.trim().toLowerCase() ===
        place.cityName.trim().toLowerCase() &&
      original.countryName.trim().toLowerCase() ===
        place.countryName.trim().toLowerCase();
    if (sameOriginal && original) {
      const { startDate: _s, endDate: _e, ...rest } = original;
      const lat =
        typeof place.lat === "number" && Number.isFinite(place.lat)
          ? place.lat
          : original.lat;
      const lon =
        typeof place.lon === "number" && Number.isFinite(place.lon)
          ? place.lon
          : original.lon;
      const timezone =
        original.timezone?.trim() ||
        (await resolveTimezoneForCoords(lat, lon));
      return {
        ...rest,
        photos: place.photos?.length ? place.photos : original.photos,
        lat,
        lon,
        ...(timezone ? { timezone } : {}),
      };
    }

    let englishDestIds = null as Awaited<
      ReturnType<typeof resolveEnglishPlaceIds>
    >;
    englishDestIds = englishPlaceIdsFromNames(
      place.cityName,
      place.countryName,
      place.countryCode || resolveCountryCode(place.countryName) || undefined
    );
    if (
      !englishDestIds &&
      typeof place.lat === "number" &&
      typeof place.lon === "number" &&
      Number.isFinite(place.lat) &&
      Number.isFinite(place.lon)
    ) {
      englishDestIds = await resolveEnglishPlaceIds(place.lat, place.lon);
    }
    if (!englishDestIds) {
      englishDestIds = await resolveEnglishPlaceIdsFromAddress(
        [place.cityName, place.countryName].filter(Boolean).join(", ")
      );
    }

    const destCountryCode =
      englishDestIds?.countryCode ||
      place.countryCode ||
      resolveCountryCode(
        englishDestIds?.countryNameEn || place.countryName
      ) ||
      undefined;
    const destCountryId = countryIdFromParts(
      englishDestIds?.countryNameEn || place.countryName,
      destCountryCode
    );
    const destCityId =
      (englishDestIds?.cityId && isAsciiId(englishDestIds.cityId)
        ? englishDestIds.cityId
        : null) ||
      (isAsciiId(slugifyId(englishDestIds?.cityNameEn || ""))
        ? slugifyId(englishDestIds!.cityNameEn)
        : null) ||
      (isAsciiId(slugifyId(place.cityName))
        ? slugifyId(place.cityName)
        : null) ||
      (isAsciiId(original?.cityId) ? original!.cityId : null);

    if (!isAsciiId(destCountryId) || !destCityId) return null;

    const lat =
      typeof place.lat === "number" && Number.isFinite(place.lat)
        ? place.lat
        : original?.lat;
    const lon =
      typeof place.lon === "number" && Number.isFinite(place.lon)
        ? place.lon
        : original?.lon;
    const timezone =
      original?.timezone?.trim() ||
      (await resolveTimezoneForCoords(lat, lon));

    return {
      cityName: place.cityName,
      cityId: destCityId,
      countryName: place.countryName,
      countryId: destCountryId,
      lat,
      lon,
      ...(timezone ? { timezone } : {}),
      ...(place.photos?.length
        ? { photos: place.photos }
        : original?.photos?.length
          ? { photos: original.photos }
          : {}),
    };
  }

  async function handleSave() {
    const primaryPlace = isAdvanced
      ? destinations[0]?.place
      : {
          cityName: primaryTripDestination(trip).cityName,
          countryName: primaryTripDestination(trip).countryName,
        };
    if (!primaryPlace?.cityName || !primaryPlace.countryName) {
      setError(
        isAdvanced ? "Keep at least one destination." : "Missing destination."
      );
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
    if (leisureType === "custom" && !leisureCustom.trim()) {
      setError("Describe the activities you want for Custom leisure.");
      return;
    }

    if (isAdvanced) {
      for (const item of destinations) {
        if (!item.dateRange.from && !item.dateRange.to) continue;
        if (!item.dateRange.from || !item.dateRange.to) {
          setError(
            `Select both dates for ${item.place.cityName}, or leave them unset.`
          );
          return;
        }
      }
    }

    if (!trip.from.countryName?.trim()) {
      setError("This trip is missing an origin city.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const name = tripName.trim() || `${primaryPlace.cityName} Trip`;
      const currencyMeta = CURRENCY_OPTIONS.find((c) => c.code === currencyCode);
      const startDate = timestampFromDate(dateRange.from);
      const endDate = timestampFromDate(dateRange.to);

      let nextDestinations: TripDestinationStop[];

      if (!isAdvanced) {
        // Ordinary trips: destination cities stay fixed.
        nextDestinations = listTripDestinations(trip);
      } else {
        const resolved = await Promise.all(
          destinations.map(async (draft) => {
            const stop = await resolvePlaceToStop(draft.place, draft.original);
            if (!stop) return null;
            const from = draft.dateRange.from;
            const to = draft.dateRange.to;
            const { startDate: _s, endDate: _e, ...rest } = stop;
            return {
              ...rest,
              stopType: draft.stopType,
              ...(from ? { startDate: timestampFromDate(from) } : {}),
              ...(to ? { endDate: timestampFromDate(to) } : {}),
            };
          })
        );
        if (resolved.some((row) => !row)) {
          setError("Couldn’t resolve destination. Try again.");
          return;
        }
        nextDestinations = resolved as TripDestinationStop[];
        if (!nextDestinations.some((stop) => stop.stopType === "destination")) {
          setError("Keep at least one Destination city (not only Transit).");
          return;
        }
      }

      const primaryStop =
        nextDestinations.find((stop) => stop.stopType === "destination") ??
        nextDestinations[0]!;

      const destChanged = destinationChanged(trip, {
        cityName: primaryStop.cityName,
        countryName: primaryStop.countryName,
        label: `${primaryStop.cityName}, ${primaryStop.countryName}`,
      });

      const patch: TripPlannerUpdateInput = {
        name,
        // Origin is never editable after create — keep transport enrichment.
        from: trip.from,
        destinations: nextDestinations,
        startDate,
        endDate,
        currency: {
          code: currencyCode,
          name: currencyMeta?.name ?? currencyCode,
          symbol: currencySymbolForCode(currencyCode),
        },
        leisureType,
        ...(leisureType === "custom" && leisureCustom.trim()
          ? {
              leisureCustom: leisureCustom
                .trim()
                .slice(0, LEISURE_CUSTOM_MAX_LENGTH),
            }
          : {}),
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
          {isAdvanced
            ? "Update name, dates, leisure type, or currency. Add or remove destinations; origin stays fixed."
            : "Update name, dates, leisure type, or currency. Origin and destination stay fixed for ordinary trips."}
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
            {isAdvanced || listTripDestinations(trip).length > 1
              ? "Destinations"
              : "Destination"}
            <span className="text-error" aria-hidden>
              *
            </span>
          </span>
          {isAdvanced ? (
            <EditTripDestinationsEditor
              destinations={destinations}
              onChange={setDestinations}
              adding={addingDestination}
              onAddingChange={setAddingDestination}
              locations={locations}
              tripDateRange={dateRange}
              disabled={saving}
              allowAdd
              onError={setError}
            />
          ) : (
            <ul className="space-y-2">
              {listTripDestinations(trip).map((stop) => (
                <li
                  key={`${stop.cityId}-${stop.countryId}-${stop.cityName}`}
                  className="rounded-xl bg-primary-tint px-3 py-2 text-sm text-primary"
                >
                  <span className="font-semibold">
                    {stop.cityName}, {stop.countryName}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <span className="flex items-center gap-1.5 text-sm font-medium text-text">
            <Plane className="h-3.5 w-3.5 text-text-muted" aria-hidden />
            From
            <span className="text-error" aria-hidden>
              *
            </span>
          </span>
          <TextInput
            value={fromValue}
            disabled
            readOnly
            placeholder="City, Country"
          />
        </div>

        <TripDateRangeField
          value={dateRange}
          onChange={setDateRange}
          minDate={null}
        />

        <div className="space-y-2">
          <span className="flex items-center gap-1.5 text-sm font-medium text-text">
            <Compass className="h-3.5 w-3.5 text-text-muted" aria-hidden />
            Type of leisure
          </span>
          <SearchableSelect
            value={leisureType}
            onChange={(value) => {
              if ((LEISURE_TYPES as readonly string[]).includes(value)) {
                setLeisureType(value as LeisureType);
              }
            }}
            options={leisureOptions}
            placeholder="Select leisure type…"
            searchPlaceholder="Search leisure types…"
            clearable={false}
          />
          {leisureType === "custom" ? (
            <div className="space-y-1.5">
              <TextInput
                value={leisureCustom}
                onChange={(e) =>
                  setLeisureCustom(
                    e.target.value.slice(0, LEISURE_CUSTOM_MAX_LENGTH)
                  )
                }
                placeholder="e.g. surfing, diving, parachute jump"
                maxLength={LEISURE_CUSTOM_MAX_LENGTH}
                disabled={saving}
              />
              <p className="text-xs text-text-muted">
                Tell us what you want to do — we’ll prioritize those activities.
              </p>
            </div>
          ) : null}
        </div>

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
