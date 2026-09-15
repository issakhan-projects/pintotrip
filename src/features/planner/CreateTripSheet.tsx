"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getFlagEmoji } from "country-flag-select";
import {
  Button,
  DateRangePicker,
  TextInput,
  type DateRangeValue,
} from "@/components/ui";
import {
  CircleDollarSign,
  Compass,
  MapPin,
  Plane,
  Plus,
  Tag,
  Wallet,
  X,
} from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import type { SavedLocation } from "@/hooks/useLocations";
import type { UserProfile } from "@/types/user";
import {
  SPEND_MONEY_OPTIONS,
  type SpendMoneyLevel,
  type TripCreateMode,
  type TripDestination,
  type TripDestinationStop,
} from "@/types/trip-planner";
import {
  LEISURE_TYPES,
  LEISURE_TYPE_OPTIONS,
  type LeisureType,
} from "@/types/trip-plan";
import { CURRENCY_OPTIONS, resolveCurrencyCode } from "@/lib/currencies";
import { slugifyId, countryIdFromParts, cx, isAsciiId } from "@/lib/utils";
import { resolveCountryCode } from "@/lib/countries";
import {
  reverseGeocode,
  resolveEnglishPlaceIds,
  resolveEnglishPlaceIdsFromAddress,
} from "@/lib/maps";
import type { EnglishPlaceIds } from "@/lib/maps";
import {
  createTrip,
  deleteTrip,
  timestampFromDate,
} from "@/services/trip-planner";
import { chargeCreateTrip } from "@/services/functions";
import {
  AI_CREDIT_COSTS,
  formatInsufficientCreditsMessage,
  isInsufficientAICreditsError,
} from "@/types/credits";
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
import {
  CreateTripDestinationPicker,
  type CityGroupOption,
  type DestinationMode,
} from "./CreateTripDestinationPicker";

interface CreateTripSheetProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  profile: UserProfile | null;
  locations: SavedLocation[];
  onCreated?: (tripId: string) => void;
}

type DestDraft = {
  id: string;
  place: GeocodedPlace;
  savedKey: string | null;
  dateRange: DateRangeValue;
};

const CREATE_MODE_TABS: Array<{ id: TripCreateMode; label: string }> = [
  { id: "ordinary", label: "Ordinary" },
  { id: "advanced", label: "Advanced" },
];

function newDestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `d-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function placeFingerprint(place: GeocodedPlace): string {
  return `${place.countryName.trim().toLowerCase()}::${place.cityName.trim().toLowerCase()}`;
}

function countryGroupKey(place: GeocodedPlace): string {
  const code =
    place.countryCode?.trim().toUpperCase() ||
    resolveCountryCode(place.countryName);
  if (code) return code.toLowerCase();
  return place.countryName.trim().toLowerCase();
}

function formatCityDates(range: DateRangeValue): string {
  if (!range.from || !range.to) return "Dates not set";
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  });
  return `${fmt.format(range.from)} – ${fmt.format(range.to)}`;
}

function suggestTripName(places: GeocodedPlace[]): string {
  if (places.length === 0) return "";
  if (places.length === 1) return `${places[0]!.cityName} Trip`;
  const countries = new Set(places.map((p) => countryGroupKey(p)));
  if (countries.size === 1) {
    return `${places[0]!.countryName} Trip`;
  }
  return `${places[0]!.cityName} Trip`;
}

function groupDestinationsByCountry(items: DestDraft[]): Array<{
  countryKey: string;
  countryName: string;
  countryCode: string;
  cities: DestDraft[];
}> {
  const groups: Array<{
    countryKey: string;
    countryName: string;
    countryCode: string;
    cities: DestDraft[];
  }> = [];
  const index = new Map<string, number>();

  for (const item of items) {
    const code =
      item.place.countryCode?.trim().toUpperCase() ||
      resolveCountryCode(item.place.countryName);
    const key = countryGroupKey(item.place);
    let i = index.get(key);
    if (i === undefined) {
      i = groups.length;
      index.set(key, i);
      groups.push({
        countryKey: key,
        countryName: item.place.countryName,
        countryCode: code || "",
        cities: [],
      });
    }
    groups[i]!.cities.push(item);
  }

  return groups;
}

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

  const [createMode, setCreateMode] = useState<TripCreateMode>("ordinary");
  const [destinationMode, setDestinationMode] = useState<DestinationMode>(
    cityGroups.length > 0 ? "places" : "search"
  );
  const [selectedSavedKey, setSelectedSavedKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodedPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [destination, setDestination] = useState<GeocodedPlace | null>(null);
  const [destinations, setDestinations] = useState<DestDraft[]>([]);
  const [addingDestination, setAddingDestination] = useState(true);
  const [openCityDateId, setOpenCityDateId] = useState<string | null>(null);
  const [fromValue, setFromValue] = useState(() => {
    const city = profile?.city?.trim() ?? "";
    const country = profile?.country?.trim() ?? "";
    return [city, country].filter(Boolean).join(", ");
  });
  const [dateRange, setDateRange] = useState<DateRangeValue>(defaultTripDateRange);
  const [currencyCode, setCurrencyCode] = useState(
    () => resolveCurrencyCode(profile?.currency) || "USD"
  );
  const [leisureType, setLeisureType] = useState<LeisureType>("mixed");
  const [spendMoney, setSpendMoney] = useState<SpendMoneyLevel>("medium");
  const [tripName, setTripName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameTouched, setNameTouched] = useState(false);
  const [mapResolving, setMapResolving] = useState(false);

  const showAdvancedPicker =
    createMode === "advanced" &&
    (addingDestination || destinations.length === 0);
  const createCost =
    createMode === "advanced"
      ? AI_CREDIT_COSTS.createTripAdvanced
      : AI_CREDIT_COSTS.createTripOrdinary;
  const aiCreditsBalance = profile?.aiCreditsBalance ?? 0;

  useEffect(() => {
    const pickerOpen =
      createMode === "ordinary" || showAdvancedPicker;
    if (!pickerOpen || destinationMode !== "search") return;
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
  }, [searchQuery, destinationMode, createMode, showAdvancedPicker]);

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

  const leisureOptions = useMemo(
    () =>
      LEISURE_TYPE_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
        description: option.description,
      })),
    []
  );

  const destinationGroups = useMemo(
    () => groupDestinationsByCountry(destinations),
    [destinations]
  );

  function applyOrdinaryDestination(place: GeocodedPlace, savedKey?: string | null) {
    setDestination(place);
    setSelectedSavedKey(savedKey ?? null);
    setSearchQuery(place.label);
    if (!nameTouched) {
      setTripName(`${place.cityName} Trip`);
    }
  }

  async function applyOrdinaryDestinationWithPhotos(
    place: GeocodedPlace,
    savedKey?: string | null
  ) {
    applyOrdinaryDestination(place, savedKey);
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

  function addAdvancedDestination(place: GeocodedPlace, savedKey?: string | null) {
    const fingerprint = placeFingerprint(place);
    if (destinations.some((d) => placeFingerprint(d.place) === fingerprint)) {
      setError("That city is already added.");
      return;
    }

    const id = newDestId();
    const next: DestDraft[] = [
      ...destinations,
      {
        id,
        place,
        savedKey: savedKey ?? null,
        dateRange: {},
      },
    ];
    setDestinations(next);
    setAddingDestination(false);
    setSearchQuery("");
    setSearchResults([]);
    setError(null);
    if (!nameTouched) {
      setTripName(suggestTripName(next.map((d) => d.place)));
    }

    if (!place.photos?.length && savedKey == null) {
      void fetchDestinationPhotos(place).then((photos) => {
        if (photos.length === 0) return;
        setDestinations((prev) =>
          prev.map((d) =>
            d.id === id ? { ...d, place: { ...d.place, photos } } : d
          )
        );
      });
    }
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

  function pickSaved(key: string) {
    const city = cityGroups.find((c) => c.key === key);
    if (!city) return;
    const place = geocodedFromSaved(city);
    if (createMode === "advanced") {
      addAdvancedDestination(place, key);
      return;
    }
    applyOrdinaryDestination(place, key);
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
      const geocoded: GeocodedPlace = {
        cityName: place.city || place.country,
        countryName: place.country || place.city,
        lat: place.lat,
        lon: place.lon,
        label: [place.city, place.country].filter(Boolean).join(", "),
        ...(place.countryCode ? { countryCode: place.countryCode } : {}),
      };
      if (createMode === "advanced") {
        addAdvancedDestination(geocoded);
        return;
      }
      await applyOrdinaryDestinationWithPhotos(geocoded);
    } finally {
      setMapResolving(false);
    }
  }

  function switchCreateMode(next: TripCreateMode) {
    if (next === createMode) return;
    setError(null);
    setOpenCityDateId(null);
    if (next === "advanced") {
      if (destinations.length === 0 && destination) {
        setDestinations([
          {
            id: newDestId(),
            place: destination,
            savedKey: selectedSavedKey,
            dateRange: {},
          },
        ]);
        setAddingDestination(false);
      } else if (destinations.length === 0) {
        setAddingDestination(true);
      }
    } else if (!destination && destinations[0]) {
      applyOrdinaryDestination(
        destinations[0].place,
        destinations[0].savedKey
      );
    }
    setCreateMode(next);
  }

  function removeDestination(id: string) {
    setDestinations((prev) => {
      const next = prev.filter((d) => d.id !== id);
      if (next.length === 0) setAddingDestination(true);
      if (!nameTouched) {
        setTripName(suggestTripName(next.map((d) => d.place)));
      }
      return next;
    });
    setOpenCityDateId((current) => (current === id ? null : current));
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
    place: GeocodedPlace,
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
      typeof place.lat === "number" &&
      typeof place.lon === "number" &&
      Number.isFinite(place.lat) &&
      Number.isFinite(place.lon)
    ) {
      const fromCoords = await resolveEnglishPlaceIds(place.lat, place.lon);
      if (fromCoords) return fromCoords;
    }

    return resolveEnglishPlaceIdsFromAddress(
      [place.cityName, place.countryName].filter(Boolean).join(", ")
    );
  }

  async function buildDestinationPayload(
    place: GeocodedPlace,
    savedCity: CityGroupOption | null
  ): Promise<TripDestination | null> {
    const englishDestIds = await resolveDestinationIds(place, savedCity);
    const destCountryCode =
      englishDestIds?.countryCode ||
      place.countryCode ||
      resolveCountryCode(englishDestIds?.countryNameEn || place.countryName) ||
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
        : null);

    if (!isAsciiId(destCountryId) || !destCityId) return null;

    const photos = place.photos ?? [];
    return {
      cityName: place.cityName,
      cityId: destCityId,
      countryName: place.countryName,
      countryId: destCountryId,
      ...(typeof place.lat === "number" && Number.isFinite(place.lat)
        ? { lat: place.lat }
        : {}),
      ...(typeof place.lon === "number" && Number.isFinite(place.lon)
        ? { lon: place.lon }
        : {}),
      ...(photos.length ? { photos } : {}),
    };
  }

  function matchingPlaceIdsForCity(savedKey: string | null): string[] {
    if (savedKey == null) return [];
    const city = cityGroups.find((c) => c.key === savedKey);
    if (!city) return [];
    return locations
      .filter(
        (l) =>
          (l.city.id || l.city.name) === city.cityId &&
          (l.country.id || l.country.name) === city.countryId
      )
      .map((l) => l.id);
  }

  async function handleCreate() {
    const selectedPlaces: DestDraft[] =
      createMode === "advanced"
        ? destinations
        : destination
          ? [
              {
                id: "ordinary",
                place: destination,
                savedKey: selectedSavedKey,
                dateRange: {},
              },
            ]
          : [];

    if (selectedPlaces.length === 0) {
      setError(
        createMode === "advanced"
          ? "Add at least one destination."
          : "Choose a destination."
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

    const tripStart = startOfLocalDay(dateRange.from);
    const tripEnd = startOfLocalDay(dateRange.to);
    for (const item of selectedPlaces) {
      if (!item.dateRange.from && !item.dateRange.to) continue;
      if (!item.dateRange.from || !item.dateRange.to) {
        setError(`Select both dates for ${item.place.cityName}, or leave them unset.`);
        return;
      }
      const cityStart = startOfLocalDay(item.dateRange.from);
      const cityEnd = startOfLocalDay(item.dateRange.to);
      if (cityEnd < cityStart) {
        setError(`End date must be after start date for ${item.place.cityName}.`);
        return;
      }
      if (cityStart < tripStart || cityEnd > tripEnd) {
        setError(
          `Dates for ${item.place.cityName} must fall within the trip dates.`
        );
        return;
      }
    }

    const { city: fromCity, country: fromCountry } = parseFrom(fromValue);
    if (!fromCountry) {
      setError("Enter where you’re traveling from.");
      return;
    }

    if (aiCreditsBalance < createCost) {
      setError(
        `Not enough AI credits. Need ${createCost}, you have ${aiCreditsBalance}.`
      );
      return;
    }

    const name =
      tripName.trim() ||
      suggestTripName(selectedPlaces.map((d) => d.place));
    const currencyMeta = CURRENCY_OPTIONS.find((c) => c.code === currencyCode);
    const startDate = timestampFromDate(dateRange.from);
    const endDate = timestampFromDate(dateRange.to);

    setSaving(true);
    setError(null);
    try {
      const resolved = await Promise.all(
        selectedPlaces.map(async (item) => {
          let place = item.place;
          if (
            (!place.photos || place.photos.length === 0) &&
            item.savedKey == null
          ) {
            const photos = await fetchDestinationPhotos(place);
            if (photos.length > 0) place = { ...place, photos };
          }
          const savedCity =
            item.savedKey != null
              ? cityGroups.find((c) => c.key === item.savedKey) ?? null
              : null;
          const payload = await buildDestinationPayload(place, savedCity);
          return { item: { ...item, place }, payload };
        })
      );

      if (resolved.some((row) => !row.payload)) {
        setError(
          "Couldn’t resolve destination city/country ids. Try search again or pick on the map."
        );
        return;
      }

      const destinationStops: TripDestinationStop[] = resolved.map((row) => {
        const base = row.payload!;
        const from = row.item.dateRange.from;
        const to = row.item.dateRange.to;
        return {
          ...base,
          ...(from ? { startDate: timestampFromDate(from) } : {}),
          ...(to ? { endDate: timestampFromDate(to) } : {}),
        };
      });
      const primary = destinationStops[0]!;

      const englishFromIds = await resolveFromIds(
        fromCity.trim(),
        fromCountry.trim()
      );
      const fromCountryCode =
        englishFromIds?.countryCode ||
        resolveCountryCode(englishFromIds?.countryNameEn || fromCountry.trim()) ||
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

      const preparationItems = buildDefaultPreparationItems({
        destinations: destinationStops.map((stop) => ({
          cityName: stop.cityName,
          countryName: stop.countryName,
          countryId: stop.countryId,
        })),
        fromCountry: fromCountry.trim(),
        fromCountryId,
        citizenship: profile?.citizenship,
        leisureType,
        spendMoney,
        startDate: dateRange.from,
      });

      const matchingPlaceIds = [
        ...new Set(
          selectedPlaces.flatMap((item) =>
            matchingPlaceIdsForCity(item.savedKey)
          )
        ),
      ];

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
          cityName: primary.cityName,
          cityId: primary.cityId,
          countryName: primary.countryName,
          countryId: primary.countryId,
          ...(typeof primary.lat === "number" ? { lat: primary.lat } : {}),
          ...(typeof primary.lon === "number" ? { lon: primary.lon } : {}),
          ...(primary.photos?.length ? { photos: primary.photos } : {}),
        },
        ...(createMode === "advanced" ? { destinations: destinationStops } : {}),
        startDate,
        endDate,
        status: "planning",
        currency: {
          code: currencyCode,
          name: currencyMeta?.name ?? currencyCode,
          symbol: currencySymbolForCode(currencyCode),
        },
        leisureType,
        spendMoney,
        createMode,
        preparation: { items: preparationItems },
        tripEssentials: { flights: [], accommodation: [], documents: [] },
        savedPlaceIds: matchingPlaceIds,
        cityIntelligence: { status: "pending" },
        itinerary: { status: "empty", days: [] },
      });

      try {
        await chargeCreateTrip({ tripId, mode: createMode });
      } catch (chargeErr) {
        try {
          await deleteTrip(userId, tripId);
        } catch {
          // Trip remains; chargeCreateTrip is idempotent on retry.
        }
        throw chargeErr;
      }

      onCreated?.(tripId);
      onClose();
      router.push(`/trip-planner/${tripId}?step=preparation&new=1`);
    } catch (err) {
      if (isInsufficientAICreditsError(err)) {
        setError(formatInsufficientCreditsMessage(err));
      } else {
        setError(err instanceof Error ? err.message : "Could not create trip.");
      }
    } finally {
      setSaving(false);
    }
  }

  const picker = (
    <CreateTripDestinationPicker
      cityGroups={cityGroups}
      destinationMode={destinationMode}
      onDestinationModeChange={setDestinationMode}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      searchResults={searchResults}
      searching={searching}
      selectedLabel={
        createMode === "ordinary" ? destination?.label ?? null : null
      }
      selectedSavedKey={
        createMode === "ordinary" ? selectedSavedKey : null
      }
      mapResolving={mapResolving}
      onPickSaved={pickSaved}
      onPickSearch={(place) => {
        if (createMode === "advanced") {
          addAdvancedDestination(place);
          return;
        }
        void applyOrdinaryDestinationWithPhotos(place);
      }}
      onMapPick={(coords) => {
        void handleMapPick(coords);
      }}
    />
  );

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
          Create a new trip
        </p>
        <h2 className="mt-1.5 pr-10 text-2xl font-semibold tracking-tight text-text">
          Where are you going?
        </h2>
        <p className="mt-1.5 max-w-md text-sm text-text-secondary">
          Add a few details to create your trip and start planning.
        </p>
        <div
          role="tablist"
          aria-label="Create trip mode"
          className="mt-4 flex gap-1 rounded-full bg-surface p-1"
        >
          {CREATE_MODE_TABS.map((item) => {
            const selected = createMode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => switchCreateMode(item.id)}
                className={cx(
                  "flex-1 rounded-full px-3 py-2 text-sm font-medium transition-colors",
                  selected
                    ? "bg-surface-elevated text-text shadow-sm"
                    : "text-text-secondary hover:text-text"
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
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

        {createMode === "ordinary" ? (
          <section>
            <FieldLabel icon={MapPin} required>
              Destination
            </FieldLabel>
            {picker}
          </section>
        ) : (
          <section>
            <FieldLabel icon={MapPin} required>
              Destinations
            </FieldLabel>
            {destinationGroups.length > 0 ? (
              <div className="mt-2 space-y-3">
                {destinationGroups.map((group) => {
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
                          return (
                            <li key={city.id}>
                              <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm text-text">
                                    {city.place.cityName}
                                  </p>
                                  <div className="mt-0.5 flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setOpenCityDateId(
                                          dateOpen ? null : city.id
                                        )
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
                                        aria-label={`Clear dates for ${city.place.cityName}`}
                                        onClick={() =>
                                          setDestinations((prev) =>
                                            prev.map((d) =>
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
                                <button
                                  type="button"
                                  aria-label={`Remove ${city.place.cityName}`}
                                  onClick={() => removeDestination(city.id)}
                                  className="rounded-md p-1 text-text-muted hover:bg-surface hover:text-text"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              {dateOpen ? (
                                <div className="mt-2">
                                  <DateRangePicker
                                    key={`${city.id}-${city.dateRange.from?.getTime() ?? 0}-${city.dateRange.to?.getTime() ?? 0}`}
                                    value={city.dateRange}
                                    disabled={saving}
                                    minDate={dateRange.from ?? null}
                                    onCancel={() => setOpenCityDateId(null)}
                                    onApply={(next) => {
                                      setDestinations((prev) =>
                                        prev.map((d) =>
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

            {showAdvancedPicker ? (
              <div
                className={cx(
                  destinations.length > 0 &&
                    "mt-3 rounded-2xl border border-border px-3 pb-3 pt-2"
                )}
              >
                {destinations.length > 0 ? (
                  <div className="mb-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setAddingDestination(false)}
                      className="text-xs font-medium text-text-secondary hover:text-text"
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}
                {picker}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSearchResults([]);
                  setAddingDestination(true);
                }}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2.5 text-sm font-medium text-primary hover:border-primary/40 hover:bg-primary-tint"
              >
                <Plus className="h-4 w-4" />
                Add destination
              </button>
            )}
          </section>
        )}

        <TripDateRangeField
          label="Trip dates"
          value={dateRange}
          onChange={setDateRange}
          disabled={saving}
        />

        <section>
          <FieldLabel icon={Compass}>Type of leisure</FieldLabel>
          <div className="mt-2">
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
          </div>
        </section>

        <section>
          <FieldLabel icon={Wallet}>Spend money</FieldLabel>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {SPEND_MONEY_OPTIONS.map((option) => {
              const selected = spendMoney === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSpendMoney(option.id)}
                  className={cx(
                    "rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors",
                    selected
                      ? "border-primary bg-primary-tint text-primary"
                      : "border-border text-text-secondary hover:border-primary/30 hover:text-text"
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>

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

        {error ? (
          <p className="rounded-xl bg-error-background px-3 py-2 text-sm text-error">
            {error}
          </p>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-divider bg-surface-elevated px-5 py-4">
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onClose} className="w-full">
            Cancel
          </Button>
          <Button
            loading={saving}
            onClick={() => void handleCreate()}
            className="w-full"
          >
            Create trip ({createCost} AI credits)
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
