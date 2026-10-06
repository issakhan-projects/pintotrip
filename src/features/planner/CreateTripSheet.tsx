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
  Baby,
  CalendarDays,
  CircleDollarSign,
  Coins,
  Compass,
  Gem,
  Landmark,
  Layers,
  Leaf,
  MapPin,
  Mosque,
  MoonStar,
  Mountain,
  Palmtree,
  PencilLine,
  Plane,
  Plus,
  Route,
  ShoppingBag,
  Sparkles,
  Star,
  Tag,
  Trees,
  Utensils,
  UtensilsCrossed,
  Wallet,
  Wine,
  X,
  type LucideIcon,
} from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useI18n, type TranslateFn } from "@/i18n";
import type { SavedLocation } from "@/hooks/useLocations";
import { useTrips } from "@/hooks/useTrips";
import type { UserProfile } from "@/types/user";
import type { BusyDateRange } from "@/components/ui";
import {
  MAX_TRIP_DAYS,
  MAX_TRIP_DESTINATIONS,
  MEAL_CUSTOM_MAX_LENGTH,
  MEAL_TYPES,
  MEAL_TYPE_OPTIONS,
  SPEND_MONEY_LEVELS,
  SPEND_MONEY_OPTIONS,
  TRIP_STOP_TYPE_OPTIONS,
  type MealType,
  type SpendMoneyLevel,
  type TripCreateMode,
  type TripDestination,
  type TripDestinationStop,
  type TripStopType,
} from "@/types/trip-planner";
import {
  LEISURE_CUSTOM_MAX_LENGTH,
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
  englishPlaceIdsFromNames,
  resolveTimezoneFromCoords,
  geocodeByAddress,
} from "@/lib/maps";
import type { EnglishPlaceIds } from "@/lib/maps";
import {
  createTrip,
  timestampFromDate,
  tripDayCount,
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
import {
  CreateTripDestinationPicker,
  type CityGroupOption,
  type DestinationMode,
} from "./CreateTripDestinationPicker";
import { isSaudiArabiaCountry, primaryTripDestination } from "./tripDestinations";

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
  stopType: TripStopType;
};

const CREATE_MODE_TABS: Array<{
  id: TripCreateMode;
  icon: typeof MapPin;
}> = [
  { id: "ordinary", icon: MapPin },
  { id: "advanced", icon: Route },
];

const LEISURE_TYPE_ICONS: Record<LeisureType, LucideIcon> = {
  sightseeing: Landmark,
  food: UtensilsCrossed,
  nature: Trees,
  nightlife: Wine,
  shopping: ShoppingBag,
  relaxation: Palmtree,
  adventure: Mountain,
  family: Baby,
  mixed: Layers,
  custom: PencilLine,
  umrah: Mosque,
};

const MEAL_TYPE_ICONS: Record<MealType, LucideIcon> = {
  default: Utensils,
  halal: MoonStar,
  vegetarian: Leaf,
  kosher: Star,
  other: PencilLine,
};

const SPEND_MONEY_ICONS: Record<SpendMoneyLevel, LucideIcon> = {
  low: Coins,
  medium: CircleDollarSign,
  high: Gem,
};

function intlLocale(locale: string): string {
  return locale === "kz" ? "kk" : locale;
}

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

function formatCityDates(
  range: DateRangeValue,
  locale: string,
  t: TranslateFn
): string {
  if (!range.from || !range.to) return t("common.datesNotSet");
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), {
    month: "short",
    day: "numeric",
  });
  return `${fmt.format(range.from)} – ${fmt.format(range.to)}`;
}

function suggestTripName(places: GeocodedPlace[], t: TranslateFn): string {
  if (places.length === 0) return "";
  if (places.length === 1) {
    return t("planner.create.nameFromPlace", { place: places[0]!.cityName });
  }
  const countries = new Set(places.map((p) => countryGroupKey(p)));
  if (countries.size === 1) {
    return t("planner.create.nameFromPlace", {
      place: places[0]!.countryName,
    });
  }
  return t("planner.create.nameFromPlace", { place: places[0]!.cityName });
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

function rangesOverlapDays(
  aFrom: Date,
  aTo: Date,
  bFrom: Date,
  bTo: Date
): boolean {
  return aFrom.getTime() <= bTo.getTime() && bFrom.getTime() <= aTo.getTime();
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
  const { t, locale } = useI18n();
  const router = useRouter();
  const { trips } = useTrips(userId);
  const busyRanges = useMemo<BusyDateRange[]>(
    () =>
      trips
        .filter((trip) => trip.status !== "cancelled")
        .map((trip) => {
          const primary = primaryTripDestination(trip);
          return {
            id: trip.id,
            label:
              trip.name?.trim() ||
              primary.cityName ||
              primary.countryName ||
              t("planner.create.fallbackTrip"),
            from: startOfLocalDay(trip.startDate.toDate()),
            to: startOfLocalDay(trip.endDate.toDate()),
          };
        }),
    [trips, t]
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
  /** Required before adding a city in advanced mode. */
  const [pendingStopType, setPendingStopType] = useState<TripStopType | null>(
    null
  );
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
  const [leisureCustom, setLeisureCustom] = useState("");
  const [mealType, setMealType] = useState<MealType>("default");
  const [mealCustom, setMealCustom] = useState("");
  const [spendMoney, setSpendMoney] = useState<SpendMoneyLevel>("medium");
  const [tripName, setTripName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameTouched, setNameTouched] = useState(false);
  const [mapResolving, setMapResolving] = useState(false);

  const atDestinationLimit = destinations.length >= MAX_TRIP_DESTINATIONS;
  const showAdvancedPicker =
    createMode === "advanced" &&
    !atDestinationLimit &&
    (addingDestination || destinations.length === 0);
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

  const hasSaudiDestination = useMemo(() => {
    if (createMode === "ordinary") {
      if (!destination) return false;
      return isSaudiArabiaCountry({
        countryCode: destination.countryCode,
        countryName: destination.countryName,
      });
    }
    return destinations.some((item) =>
      isSaudiArabiaCountry({
        countryCode: item.place.countryCode,
        countryName: item.place.countryName,
      })
    );
  }, [createMode, destination, destinations]);

  const leisureOptions = useMemo(
    () =>
      LEISURE_TYPE_OPTIONS.filter(
        (option) => option.value !== "umrah" || hasSaudiDestination
      ).map((option) => ({
        value: option.value,
        label: t(`planner.create.leisure.${option.value}.label`),
        description: t(`planner.create.leisure.${option.value}.description`),
        icon: LEISURE_TYPE_ICONS[option.value],
      })),
    [hasSaudiDestination, t]
  );

  const mealOptions = useMemo(
    () =>
      MEAL_TYPE_OPTIONS.map((option) => ({
        value: option.id,
        label: t(`planner.create.meal.${option.id}.label`),
        description: t(`planner.create.meal.${option.id}.description`),
        icon: MEAL_TYPE_ICONS[option.id],
      })),
    [t]
  );

  const spendOptions = useMemo(
    () =>
      SPEND_MONEY_OPTIONS.map((option) => ({
        value: option.id,
        label: t(`planner.create.spendLevel.${option.id}`),
        description: t(`planner.create.spend.${option.id}`),
        icon: SPEND_MONEY_ICONS[option.id],
      })),
    [t]
  );

  useEffect(() => {
    if (leisureType === "umrah" && !hasSaudiDestination) {
      setLeisureType("mixed");
    }
  }, [leisureType, hasSaudiDestination]);

  const destinationGroups = useMemo(
    () => groupDestinationsByCountry(destinations),
    [destinations]
  );

  function applyOrdinaryDestination(place: GeocodedPlace, savedKey?: string | null) {
    setDestination(place);
    setSelectedSavedKey(savedKey ?? null);
    setSearchQuery(place.label);
    if (!nameTouched) {
      setTripName(t("planner.create.nameFromPlace", { place: place.cityName }));
    }
  }

  async function applyOrdinaryDestinationWithPhotos(
    place: GeocodedPlace,
    savedKey?: string | null
  ) {
    applyOrdinaryDestination(place, savedKey);
    const photos = (await fetchDestinationPhotos(place)).slice(0, 1);
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
    if (!pendingStopType) {
      setError(t("planner.create.err.chooseStopType"));
      return;
    }
    if (destinations.length >= MAX_TRIP_DESTINATIONS) {
      setError(
        t("planner.create.err.cityLimit", { max: MAX_TRIP_DESTINATIONS })
      );
      return;
    }

    const fingerprint = placeFingerprint(place);
    if (destinations.some((d) => placeFingerprint(d.place) === fingerprint)) {
      setError(t("planner.create.err.cityAlreadyAdded"));
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
        stopType: pendingStopType,
      },
    ];
    setDestinations(next);
    setAddingDestination(false);
    setPendingStopType(null);
    setSearchQuery("");
    setSearchResults([]);
    setError(null);
    if (!nameTouched) {
      setTripName(suggestTripName(next.map((d) => d.place), t));
    }

    if (!place.photos?.length && savedKey == null) {
      void fetchDestinationPhotos(place).then((photos) => {
        const one = photos.slice(0, 1);
        if (one.length === 0) return;
        setDestinations((prev) =>
          prev.map((d) =>
            d.id === id ? { ...d, place: { ...d.place, photos: one } } : d
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
        setError(t("planner.create.err.identifyLocation"));
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
            stopType: "destination",
          },
        ]);
        setAddingDestination(false);
        setPendingStopType(null);
      } else if (destinations.length === 0) {
        setAddingDestination(true);
        setPendingStopType(null);
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
        setTripName(suggestTripName(next.map((d) => d.place), t));
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
    const fromNames = englishPlaceIdsFromNames(
      fromCity,
      fromCountry,
      resolveCountryCode(fromCountry) || undefined
    );
    if (fromNames) return fromNames;

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

    if (isAsciiId(place.cityId) && isAsciiId(place.countryId)) {
      return {
        cityId: place.cityId!.trim().toLowerCase(),
        countryId: place.countryId!.trim().toLowerCase(),
        countryCode:
          place.countryCode ||
          resolveCountryCode(place.countryName) ||
          (place.countryId!.length === 2
            ? place.countryId!.toUpperCase()
            : ""),
        cityNameEn: place.cityName,
        countryNameEn: place.countryName,
      };
    }

    const fromNames = englishPlaceIdsFromNames(
      place.cityName,
      place.countryName,
      place.countryCode || resolveCountryCode(place.countryName) || undefined
    );
    if (fromNames) return fromNames;

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

  async function resolveCoordsForLabel(
    label: string
  ): Promise<{ lat: number; lon: number } | null> {
    const trimmed = label.trim();
    if (!trimmed) return null;
    try {
      const results = await geocodeByAddress(trimmed, { language: "en" });
      const location = results[0]?.geometry?.location;
      if (!location) return null;
      const lat = location.lat();
      const lon = location.lng();
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon };
    } catch {
      return null;
    }
  }

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

    const photos = (place.photos ?? []).slice(0, 1);
    let lat =
      typeof place.lat === "number" && Number.isFinite(place.lat)
        ? place.lat
        : undefined;
    let lon =
      typeof place.lon === "number" && Number.isFinite(place.lon)
        ? place.lon
        : undefined;
    if (lat == null || lon == null) {
      const geocoded = await resolveCoordsForLabel(
        [place.cityName, place.countryName].filter(Boolean).join(", ")
      );
      if (geocoded) {
        lat = geocoded.lat;
        lon = geocoded.lon;
      }
    }
    const timezone = await resolveTimezoneForCoords(lat, lon);

    return {
      cityName: place.cityName,
      cityId: destCityId,
      countryName: place.countryName,
      countryId: destCountryId,
      ...(lat != null && lon != null ? { lat, lon } : {}),
      ...(timezone ? { timezone } : {}),
      ...(photos.length ? { photos } : {}),
    };
  }

  function matchingPlaceIdsForCityIds(
    cityId: string | undefined,
    countryId: string | undefined
  ): string[] {
    const city = cityId?.trim().toLowerCase() ?? "";
    if (!isAsciiId(city)) return [];
    const country = countryId?.trim().toLowerCase() ?? "";
    return locations
      .filter((l) => {
        const locCity = (l.city.id || "").trim().toLowerCase();
        if (locCity !== city) return false;
        if (!country) return true;
        const locCountry = (l.country.id || "").trim().toLowerCase();
        return !locCountry || locCountry === country;
      })
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
                stopType: "destination",
              },
            ]
          : [];

    if (selectedPlaces.length === 0) {
      setError(
        createMode === "advanced"
          ? t("planner.create.err.needDestination")
          : t("planner.create.err.chooseDestination")
      );
      return;
    }
    if (
      createMode === "advanced" &&
      selectedPlaces.length > MAX_TRIP_DESTINATIONS
    ) {
      setError(
        t("planner.create.err.cityLimit", { max: MAX_TRIP_DESTINATIONS })
      );
      return;
    }
    if (
      createMode === "advanced" &&
      selectedPlaces.some((item) => !item.stopType)
    ) {
      setError(t("planner.create.err.eachCityType"));
      return;
    }
    if (!dateRange.from || !dateRange.to) {
      setError(t("planner.create.err.selectDates"));
      return;
    }
    if (dateRange.to < dateRange.from) {
      setError(t("planner.create.err.endAfterStart"));
      return;
    }
    if (
      tripDayCount(
        timestampFromDate(dateRange.from),
        timestampFromDate(dateRange.to)
      ) > MAX_TRIP_DAYS
    ) {
      setError(t("planner.create.err.maxDays", { max: MAX_TRIP_DAYS }));
      return;
    }
    {
      const tripStart = startOfLocalDay(dateRange.from);
      const tripEnd = startOfLocalDay(dateRange.to);
      const overlap = busyRanges.find((range) =>
        rangesOverlapDays(tripStart, tripEnd, range.from, range.to)
      );
      if (overlap) {
        setError(
          t("planner.create.err.datesOverlap", { label: overlap.label })
        );
        return;
      }
    }
    if (!currencyCode) {
      setError(t("planner.create.err.selectCurrency"));
      return;
    }
    if (leisureType === "custom" && !leisureCustom.trim()) {
      setError(t("planner.create.err.customLeisure"));
      return;
    }
    if (mealType === "other" && !mealCustom.trim()) {
      setError(t("planner.create.err.customMeal"));
      return;
    }

    const tripStart = startOfLocalDay(dateRange.from);
    const tripEnd = startOfLocalDay(dateRange.to);
    for (const item of selectedPlaces) {
      if (!item.dateRange.from && !item.dateRange.to) continue;
      if (!item.dateRange.from || !item.dateRange.to) {
        setError(
          t("planner.create.err.cityDatesBoth", {
            city: item.place.cityName,
          })
        );
        return;
      }
      const cityStart = startOfLocalDay(item.dateRange.from);
      const cityEnd = startOfLocalDay(item.dateRange.to);
      if (cityEnd < cityStart) {
        setError(
          t("planner.create.err.cityEndAfterStart", {
            city: item.place.cityName,
          })
        );
        return;
      }
      if (cityStart < tripStart || cityEnd > tripEnd) {
        setError(
          t("planner.create.err.cityDatesInTrip", {
            city: item.place.cityName,
          })
        );
        return;
      }
    }

    const { city: fromCity, country: fromCountry } = parseFrom(fromValue);
    if (!fromCountry) {
      setError(t("planner.create.err.enterFrom"));
      return;
    }

    const name =
      tripName.trim() ||
      suggestTripName(selectedPlaces.map((d) => d.place), t);
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
            const photos = (await fetchDestinationPhotos(place)).slice(0, 1);
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
        setError(t("planner.create.err.resolveDestIds"));
        return;
      }

      const destinationStops: TripDestinationStop[] = resolved.map((row) => {
        const base = row.payload!;
        const from = row.item.dateRange.from;
        const to = row.item.dateRange.to;
        return {
          ...base,
          stopType: row.item.stopType,
          ...(from ? { startDate: timestampFromDate(from) } : {}),
          ...(to ? { endDate: timestampFromDate(to) } : {}),
        };
      });
      if (
        createMode === "advanced" &&
        destinationStops.some((stop) => !stop.stopType)
      ) {
        setError(t("planner.create.err.eachCityType"));
        return;
      }
      if (
        createMode === "advanced" &&
        !destinationStops.some((stop) => stop.stopType === "destination")
      ) {
        setError(t("planner.create.err.needDestinationNotOnlyTransit"));
        return;
      }
      const primary =
        destinationStops.find((stop) => stop.stopType === "destination") ??
        destinationStops[0]!;

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
        setError(t("planner.create.err.resolveFrom"));
        return;
      }

      let fromLat =
        typeof profile?.lat === "number" && Number.isFinite(profile.lat)
          ? profile.lat
          : undefined;
      let fromLon =
        typeof profile?.lon === "number" && Number.isFinite(profile.lon)
          ? profile.lon
          : undefined;
      if (fromLat == null || fromLon == null) {
        const geocoded = await resolveCoordsForLabel(
          [fromCityName, fromCountry.trim()].filter(Boolean).join(", ")
        );
        if (geocoded) {
          fromLat = geocoded.lat;
          fromLon = geocoded.lon;
        }
      }
      const fromTimezone = await resolveTimezoneForCoords(fromLat, fromLon);

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

      // Link planned places whose city.id matches each destination (not only
      // when the user picked from the saved-city picker).
      const matchingPlaceIds = [
        ...new Set(
          destinationStops.flatMap((stop) =>
            matchingPlaceIdsForCityIds(stop.cityId, stop.countryId)
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
          ...(fromLat != null && fromLon != null
            ? { lat: fromLat, lon: fromLon }
            : {}),
          ...(fromTimezone ? { timezone: fromTimezone } : {}),
        },
        destinations: destinationStops,
        startDate,
        endDate,
        status: "planning",
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
        mealType,
        ...(mealType === "other" && mealCustom.trim()
          ? {
              mealCustom: mealCustom.trim().slice(0, MEAL_CUSTOM_MAX_LENGTH),
            }
          : {}),
        spendMoney,
        createMode,
        preparation: { items: preparationItems },
        savedPlaceIds: matchingPlaceIds,
        cityIntelligence: { status: "pending" },
        itinerary: { status: "empty", days: [] },
      });

      onCreated?.(tripId);
      onClose();
      router.push(`/trip-planner/${tripId}?step=preparation&new=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("planner.create.err.createFailed"));
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

  const ordinaryCountryCode =
    destination?.countryCode?.trim() ||
    (destination
      ? resolveCountryCode(destination.countryName) || ""
      : "");
  const ordinaryFlag = ordinaryCountryCode
    ? getFlagEmoji(ordinaryCountryCode)
    : "";
  const ordinaryPhoto = destination?.photos?.[0];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative shrink-0 overflow-hidden border-b border-divider px-5 pb-5 pt-5">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--color-primary-tint)_0%,_transparent_55%)]"
          aria-hidden
        />
        <button
          type="button"
          aria-label={t("ui.sheet.closeAria")}
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-full p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="relative">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary-tint px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
            <Sparkles className="h-3 w-3" aria-hidden />
            {t("planner.create.title")}
          </div>
          <h2 className="mt-3 pr-10 font-[family-name:var(--font-lobster)] text-3xl tracking-tight text-text">
            {t("planner.create.subtitle")}
          </h2>
          <p className="mt-1.5 max-w-md text-sm leading-relaxed text-text-secondary">
            {t("planner.create.body")}
          </p>
          <div
            role="tablist"
            aria-label={t("planner.create.modeAria")}
            className="mt-4 grid grid-cols-2 gap-2"
          >
            {CREATE_MODE_TABS.map((item) => {
              const selected = createMode === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => switchCreateMode(item.id)}
                  className={cx(
                    "flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition-all",
                    selected
                      ? "border-primary bg-primary-tint shadow-sm ring-1 ring-primary/20"
                      : "border-border bg-surface-elevated hover:border-primary/30"
                  )}
                >
                  <span
                    className={cx(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                      selected
                        ? "bg-primary text-white"
                        : "bg-surface text-text-muted"
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cx(
                        "block text-sm font-semibold",
                        selected ? "text-primary" : "text-text"
                      )}
                    >
                      {t(`planner.create.mode.${item.id}`)}
                    </span>
                    <span className="block text-[11px] text-text-muted">
                      {t(`planner.create.mode.${item.id}Hint`)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <section className="space-y-4">
          <section>
            <FieldLabel icon={Tag} required>
              {t("trip.name")}
            </FieldLabel>
            <div className="relative mt-2">
              <TextInput
                value={tripName}
                onChange={(e) => {
                  setNameTouched(true);
                  setTripName(e.target.value);
                }}
                placeholder={t("planner.create.namePlaceholder")}
                className="!pr-9"
              />
              {tripName ? (
                <button
                  type="button"
                  aria-label={t("planner.create.clearNameAria")}
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
            <FieldLabel icon={Plane}>{t("trip.from")}</FieldLabel>
            <div className="relative mt-2">
              <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <TextInput
                value={fromValue}
                onChange={(e) => setFromValue(e.target.value)}
                placeholder={t("planner.create.fromPlaceholder")}
                className="!pl-9 !pr-9"
              />
              {fromValue ? (
                <button
                  type="button"
                  aria-label={t("planner.create.clearFromAria")}
                  onClick={() => setFromValue("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-text-muted hover:bg-surface hover:text-text"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </section>
        </section>

        {createMode === "ordinary" ? (
          <section>
            <FieldLabel icon={MapPin} required>
              {t("trip.destination")}
            </FieldLabel>
            {destination ? (
              <div className="relative mt-2 overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-sm">
                <div className="relative aspect-[2.2/1] bg-surface">
                  {ordinaryPhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={ordinaryPhoto}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary-tint to-surface">
                      <MapPin className="h-8 w-8 text-primary/50" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3.5">
                    <div className="min-w-0">
                      <p className="truncate text-lg font-semibold text-white drop-shadow-sm">
                        {ordinaryFlag ? `${ordinaryFlag} ` : ""}
                        {destination.cityName}
                      </p>
                      <p className="truncate text-sm text-white/85">
                        {destination.countryName}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={t("planner.create.changeDestinationAria")}
                      onClick={() => {
                        setDestination(null);
                        setSelectedSavedKey(null);
                        setSearchQuery("");
                        setSearchResults([]);
                      }}
                      className="shrink-0 rounded-full bg-white/95 px-3 py-1.5 text-xs font-medium text-text shadow-sm backdrop-blur-sm hover:bg-white"
                    >
                      {t("planner.create.changeDestination")}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              picker
            )}
          </section>
        ) : (
          <section>
            <div className="flex items-end justify-between gap-3">
              <FieldLabel icon={MapPin} required>
                {t("trip.destinations")}
              </FieldLabel>
              {destinations.length > 0 ? (
                <p className="text-[11px] font-medium text-text-muted">
                  {destinations.length}/{MAX_TRIP_DESTINATIONS}
                </p>
              ) : null}
            </div>
            {destinationGroups.length > 0 ? (
              <div className="mt-2 space-y-3">
                {destinationGroups.map((group) => {
                  const flag = group.countryCode
                    ? getFlagEmoji(group.countryCode)
                    : "";
                  return (
                    <div
                      key={group.countryKey}
                      className="overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-sm"
                    >
                      <div className="flex items-center gap-2 border-b border-divider bg-surface/80 px-3.5 py-2.5">
                        {flag ? (
                          <span className="text-base leading-none" aria-hidden>
                            {flag}
                          </span>
                        ) : (
                          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-elevated text-text-muted ring-1 ring-border/70">
                            <MapPin className="h-3.5 w-3.5" aria-hidden />
                          </span>
                        )}
                        <p className="text-sm font-semibold text-text">
                          {group.countryName}
                        </p>
                        <span className="ml-auto rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] font-medium text-text-muted ring-1 ring-border/70">
                          {t(
                            group.cities.length === 1
                              ? "planner.create.cityCount_one"
                              : "planner.create.cityCount_other",
                            { count: group.cities.length }
                          )}
                        </span>
                      </div>
                      <ul className="divide-y divide-divider">
                        {group.cities.map((city) => {
                          const datesLabel = formatCityDates(
                            city.dateRange,
                            locale,
                            t
                          );
                          const datesSet = Boolean(
                            city.dateRange.from && city.dateRange.to
                          );
                          const dateOpen = openCityDateId === city.id;
                          const thumb = city.place.photos?.[0];
                          const stopOrder =
                            destinations.findIndex((d) => d.id === city.id) + 1;
                          return (
                            <li key={city.id} className="px-3 py-3">
                              <div className="flex items-start gap-3">
                                <div className="relative mt-0.5 h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-primary-tint ring-1 ring-border/60">
                                  {thumb ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={thumb}
                                      alt=""
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <MapPin className="absolute inset-0 m-auto h-4 w-4 text-primary/60" />
                                  )}
                                  <span className="absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-text text-[10px] font-semibold text-white shadow-sm">
                                    {stopOrder}
                                  </span>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold text-text">
                                    {city.place.cityName}
                                  </p>
                                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {TRIP_STOP_TYPE_OPTIONS.map((option) => {
                                      const selected =
                                        city.stopType === option.id;
                                      return (
                                        <button
                                          key={option.id}
                                          type="button"
                                          aria-label={t(
                                            "planner.create.stopTypeAria",
                                            {
                                              city: city.place.cityName,
                                              option: t(
                                                `trip.stop.${option.id}`
                                              ),
                                            }
                                          )}
                                          onClick={() =>
                                            setDestinations((prev) =>
                                              prev.map((d) =>
                                                d.id === city.id
                                                  ? {
                                                      ...d,
                                                      stopType: option.id,
                                                    }
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
                                          {t(`trip.stop.${option.id}`)}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  <div className="mt-2 flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setOpenCityDateId(
                                          dateOpen ? null : city.id
                                        )
                                      }
                                      className={cx(
                                        "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors",
                                        datesSet
                                          ? "bg-surface text-text-secondary hover:text-text"
                                          : "text-text-muted hover:bg-surface hover:text-text-secondary"
                                      )}
                                    >
                                      <CalendarDays className="h-3 w-3" />
                                      {datesLabel}
                                    </button>
                                    {datesSet ? (
                                      <button
                                        type="button"
                                        aria-label={t(
                                          "planner.create.clearDatesAria",
                                          { city: city.place.cityName }
                                        )}
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
                                  aria-label={t("common.removeNamed", {
                                    name: city.place.cityName,
                                  })}
                                  onClick={() => removeDestination(city.id)}
                                  className="rounded-full p-1.5 text-text-muted hover:bg-error-background hover:text-error"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              {dateOpen ? (
                                <div className="mt-3 rounded-xl border border-border bg-surface p-2">
                                  <DateRangePicker
                                    key={`${city.id}-${city.dateRange.from?.getTime() ?? 0}-${city.dateRange.to?.getTime() ?? 0}`}
                                    value={city.dateRange}
                                    disabled={saving}
                                    minDate={dateRange.from ?? null}
                                    maxSpanDays={MAX_TRIP_DAYS}
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
                  "mt-3 rounded-2xl border border-dashed border-primary/25 bg-primary-tint/40 px-3 pb-3 pt-2.5",
                  destinations.length === 0 && "mt-2 border-solid bg-surface"
                )}
              >
                {destinations.length > 0 ? (
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-primary">
                      {t("planner.create.addAnotherCity")}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setAddingDestination(false);
                        setPendingStopType(null);
                      }}
                      className="text-xs font-medium text-text-secondary hover:text-text"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                ) : null}

                <div className="mb-3">
                  <p className="text-xs font-medium text-text-secondary">
                    {t("planner.create.cityType")}{" "}
                    <span className="text-error">*</span>
                  </p>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    {TRIP_STOP_TYPE_OPTIONS.map((option) => {
                      const selected = pendingStopType === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            setPendingStopType(option.id);
                            setError(null);
                          }}
                          className={cx(
                            "rounded-xl border px-3 py-2.5 text-left transition-all",
                            selected
                              ? "border-primary bg-surface-elevated text-primary shadow-sm ring-1 ring-primary/15"
                              : "border-border bg-surface-elevated text-text hover:border-primary/30"
                          )}
                        >
                          <span className="block text-sm font-medium">
                            {t(`trip.stop.${option.id}`)}
                          </span>
                          <span
                            className={cx(
                              "mt-0.5 block text-[11px] leading-snug",
                              selected ? "text-primary/80" : "text-text-muted"
                            )}
                          >
                            {t(`planner.create.stopDesc.${option.id}`)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {pendingStopType ? (
                  picker
                ) : (
                  <p className="rounded-xl border border-border/70 bg-surface-elevated px-3 py-3 text-sm text-text-secondary">
                    {t("planner.create.selectStopThenCity")}
                  </p>
                )}
              </div>
            ) : atDestinationLimit ? (
              <p className="mt-3 rounded-xl bg-surface px-3 py-2.5 text-center text-xs text-text-muted">
                {t("planner.create.maxCities", {
                  max: MAX_TRIP_DESTINATIONS,
                })}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSearchResults([]);
                  setPendingStopType(null);
                  setAddingDestination(true);
                }}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary/35 bg-primary-tint/30 px-3 py-3 text-sm font-medium text-primary transition-colors hover:border-primary/50 hover:bg-primary-tint"
              >
                <Plus className="h-4 w-4" />
                {t("planner.create.addDestination")}
              </button>
            )}
          </section>
        )}

        <TripDateRangeField
          label={t("planner.create.tripDates")}
          value={dateRange}
          onChange={setDateRange}
          maxSpanDays={MAX_TRIP_DAYS}
          busyRanges={busyRanges}
          disabled={saving}
        />

        <section className="space-y-4 rounded-2xl border border-border bg-surface/50 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {t("planner.create.preferences")}
          </p>

          <section className="space-y-3">
            <div className="flex items-center gap-3">
              <FieldLabel icon={Compass} className="w-40 shrink-0">
                {t("trip.typeOfLeisure")}
              </FieldLabel>
              <div className="min-w-0 flex-1">
                <SearchableSelect
                  value={leisureType}
                  onChange={(value) => {
                    if ((LEISURE_TYPES as readonly string[]).includes(value)) {
                      setLeisureType(value as LeisureType);
                    }
                  }}
                  options={leisureOptions}
                  placeholder={t("planner.create.leisurePlaceholder")}
                  searchPlaceholder={t("planner.create.leisureSearch")}
                  clearable={false}
                  listLayout="stacked"
                />
              </div>
            </div>
            {leisureType === "custom" ? (
              <div className="pl-[10.75rem]">
                <TextInput
                  value={leisureCustom}
                  onChange={(e) =>
                    setLeisureCustom(
                      e.target.value.slice(0, LEISURE_CUSTOM_MAX_LENGTH)
                    )
                  }
                  placeholder={t("planner.create.customLeisurePlaceholder")}
                  maxLength={LEISURE_CUSTOM_MAX_LENGTH}
                  disabled={saving}
                />
                <p className="mt-1.5 text-xs text-text-muted">
                  {t("planner.create.customLeisureHint")}
                </p>
              </div>
            ) : null}
            <div className="flex items-center gap-3">
              <FieldLabel icon={Utensils} className="w-40 shrink-0">
                {t("planner.create.mealType")}
              </FieldLabel>
              <div className="min-w-0 flex-1">
                <SearchableSelect
                  value={mealType}
                  onChange={(value) => {
                    if ((MEAL_TYPES as readonly string[]).includes(value)) {
                      setMealType(value as MealType);
                    }
                  }}
                  options={mealOptions}
                  placeholder={t("planner.create.mealType")}
                  clearable={false}
                  searchable={false}
                  listLayout="stacked"
                />
              </div>
            </div>
            {mealType === "other" ? (
              <div className="pl-[10.75rem]">
                <TextInput
                  value={mealCustom}
                  onChange={(e) =>
                    setMealCustom(
                      e.target.value.slice(0, MEAL_CUSTOM_MAX_LENGTH)
                    )
                  }
                  placeholder={t("planner.create.mealCustomPlaceholder")}
                  maxLength={MEAL_CUSTOM_MAX_LENGTH}
                  disabled={saving}
                />
                <p className="mt-1.5 text-xs text-text-muted">
                  {t("planner.create.mealCustomHint")}
                </p>
              </div>
            ) : null}
            <div className="flex items-center gap-3">
              <FieldLabel icon={Wallet} className="w-40 shrink-0">
                {t("trip.spendMoney")}
              </FieldLabel>
              <div className="min-w-0 flex-1">
                <SearchableSelect
                  value={spendMoney}
                  onChange={(value) => {
                    if ((SPEND_MONEY_LEVELS as readonly string[]).includes(value)) {
                      setSpendMoney(value as SpendMoneyLevel);
                    }
                  }}
                  options={spendOptions}
                  placeholder={t("trip.spendMoney")}
                  clearable={false}
                  searchable={false}
                  listLayout="stacked"
                />
              </div>
            </div>
          </section>

          <section>
            <FieldLabel icon={CircleDollarSign}>{t("trip.currency")}</FieldLabel>
            <div className="mt-2">
              <SearchableSelect
                value={currencyCode}
                onChange={setCurrencyCode}
                options={currencyOptions}
                placeholder={t("planner.create.currencyPlaceholder")}
                searchPlaceholder={t("planner.create.currencySearch")}
              />
            </div>
          </section>
        </section>

        {error ? (
          <p className="rounded-xl border border-error/20 bg-error-background px-3 py-2.5 text-sm text-error">
            {error}
          </p>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-divider bg-surface-elevated/95 px-5 py-4 backdrop-blur-sm">
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onClose} className="w-full">
            {t("common.cancel")}
          </Button>
          <Button
            loading={saving}
            onClick={() => void handleCreate()}
            className="w-full"
          >
            {t("planner.create.submit")}
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
  className,
}: {
  icon: typeof MapPin;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex min-w-0 items-center gap-1.5 text-sm font-medium text-text",
        className
      )}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface text-text-muted">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="min-w-0 leading-snug">{children}</span>
      {required ? (
        <span className="text-error" aria-hidden>
          *
        </span>
      ) : null}
    </div>
  );
}
