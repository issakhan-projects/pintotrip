"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { Button, ConfirmModal, TextInput, TimePicker } from "@/components/ui";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  CloudSun,
  ExternalLink,
  GripVertical,
  ListOrdered,
  Loader2,
  Map as MapIcon,
  MapPin,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  TrainFront,
  X,
} from "lucide-react";
import { TravelMap } from "@/features/map/TravelMap";
import { PlacePreviewSheet } from "@/features/map/PlacePreviewSheet";
import { Sheet } from "@/components/ui/Sheet";
import type { SavedLocation } from "@/hooks/useLocations";
import type {
  ItineraryDay,
  ItineraryDayWeather,
  ItineraryPlace,
  TripAccommodation,
  TripItinerary,
  TripPlannerDoc,
  TripRoute,
  TripRouteTransport,
} from "@/types/trip-planner";
import type {
  LocationAiMetadata,
  LocationImage,
  LocationPrice,
  LocationStatus,
} from "@/types/location";
import {
  getBrowserCoords,
  hasUsableMapCoords,
  resolveEnglishPlaceIds,
  withCityGooglePlaceId,
  type MapMarkerInput,
} from "@/lib/maps";
import {
  TripPlannerItineraryMap,
  type ItineraryMapLeg,
} from "./TripPlannerItineraryMap";
import { PLACE_CATEGORY_LABELS } from "@/types/trip-plan";
import {
  AI_CREDIT_COSTS,
  formatInsufficientCreditsMessage,
  isInsufficientAICreditsError,
  PLACE_SEARCH_PACK_SIZE,
  planTripRegenerateCost,
} from "@/types/credits";
import { formatAvailableDuration } from "./timelineHelpers";
import { lockBodyScroll } from "@/lib/bodyScrollLock";
import { countryIdFromParts, cx, isAsciiId, slugifyId } from "@/lib/utils";
import { distanceKm } from "./clusterPlaces";
import {
  matchLocationsToDestinations,
  sortLocationsForDestination,
} from "./matchTripPlaces";
import { PlanTripSheet } from "./PlanTripSheet";
import { TripSetupChecklist } from "./TripSetupChecklist";
import {
  listTripDestinations,
  owningDestinationForDate,
  toIsoDate,
} from "./tripDestinations";
import { listTripAccommodations } from "./essentialsHelpers";
import { isWeatherFresh, weatherForTrip } from "./tripWeather";
import { subscribeTripRoutes } from "@/services/trip-routes";
import {
  formatRouteClock,
  formatRouteDuration,
} from "./routeHelpers";
import {
  ROUTE_TRANSPORT_ICON,
  ROUTE_TRANSPORT_LABEL,
} from "./RouteLegCard";
import {
  fetchSuggestedPlacePhoto,
  pexelsPhotoUrlExcludeId,
  searchPlacesByName,
  type SearchedPlace,
} from "@/features/add-place/placeSearch";
import { purchasePlaceSearchPack } from "@/services/functions";
import {
  createUserLocation,
  deleteUserLocation,
  getUserLocation,
} from "@/services/locations";
import { Timestamp } from "firebase/firestore";
import { resolveCountryCode } from "@/lib/countries";

type Coords = { lat: number; lon: number };

/** City/country line under an itinerary place title. */
function placeLocalityLabel(
  place: SavedLocation | undefined,
  fallback?: { cityName?: string; countryName?: string } | null
): string {
  const city =
    place?.city?.name?.trim() ||
    fallback?.cityName?.trim() ||
    "";
  const country =
    place?.country?.name?.trim() ||
    fallback?.countryName?.trim() ||
    "";
  return [city, country].filter(Boolean).join(", ");
}

function isGenericDayTitle(title: string | undefined): boolean {
  return !title?.trim() || /^day\s*\d+$/i.test(title.trim());
}

function itinerarySlotHasImage(
  slot: ItineraryPlace,
  place: SavedLocation | undefined
): boolean {
  if (slot.imageUrl?.trim()) return true;
  if (place?.images?.some((img) => img.url?.trim())) return true;
  return false;
}

function weatherIconUrl(icon: string): string {
  return `https://openweathermap.org/img/wn/${icon}@2x.png`;
}

function itineraryNeedsWeatherFetch(days: ItineraryDay[]): boolean {
  if (days.length === 0) return false;
  return days.some((day) => !isWeatherFresh(day.weather));
}

function isActiveItinerarySlot(
  slot: ItineraryPlace,
  byId: Map<string, SavedLocation>
): boolean {
  if (slot.status === "cancelled") return false;
  // Gap / route blocks are itinerary metadata (no saved location doc).
  if (slot.type === "gap" || slot.type === "route") return true;
  return byId.get(slot.locationId)?.status !== "cancelled";
}

function formatDistanceFrom(from: Coords, to: Coords): string {
  const km = distanceKm(from, to);
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  if (km < 100) return `${Math.round(km)} km`;
  return `${Math.round(km).toLocaleString()} km`;
}

function formatPlacePrice(price: LocationPrice): string | null {
  const label = price.label?.trim();
  if (label) return label;
  if (price.amount == null) return null;
  if (price.amount === 0) return "Free";
  return `${price.amount}${price.currency ? ` ${price.currency}` : ""}`;
}

/** Parse `HH:mm` → minutes from midnight. */
function parseVisitClock(value?: string): number | null {
  if (!value?.trim()) return null;
  const match = value.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23
  ) {
    return null;
  }
  return hour * 60 + minute;
}

function formatVisitClock(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  const hour = Math.floor(clamped / 60);
  const minute = clamped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function durationFromVisitWindow(
  from: string,
  to: string
): number | undefined {
  const fromMins = parseVisitClock(from);
  const toMins = parseVisitClock(to);
  if (fromMins == null || toMins == null || toMins <= fromMins) return undefined;
  return toMins - fromMins;
}

type DayMapPoint = {
  id: string;
  lat: number;
  lon: number;
  title: string;
  order: number;
  kind: "place" | "city" | "airport" | "stay";
  status?: LocationStatus;
  googlePlaceId?: string;
};

/** True when the itinerary day falls inside the stay window (inclusive). */
function stayCoversItineraryDay(
  stay: TripAccommodation,
  dayIso: string
): boolean {
  const start = stay.startDate?.trim();
  const end = stay.endDate?.trim();
  // Dates are optional on stays — still show a mappable pin every day.
  if (!start || !end) return true;
  return dayIso >= start && dayIso <= end;
}

/** Build numbered markers + route overlays for one itinerary day (existing data only). */
function buildDayMapData(
  day: ItineraryDay | undefined,
  byId: Map<string, SavedLocation>,
  routesById: Map<string, TripRoute>,
  accommodations: TripAccommodation[] = []
): { markers: DayMapPoint[]; legs: ItineraryMapLeg[]; placeCount: number } {
  if (!day) return { markers: [], legs: [], placeCount: 0 };

  const activePlaces = [...day.places]
    .filter((slot) => isActiveItinerarySlot(slot, byId))
    .sort((a, b) => a.order - b.order);

  const markers: DayMapPoint[] = [];
  const legs: ItineraryMapLeg[] = [];
  const placePoints: { id: string; lat: number; lon: number }[] = [];
  let placeCount = 0;
  const dayIso = toIsoDate(day.date.toDate());

  // Stays covering this calendar day (pin first so places stay visually on top).
  for (const stay of accommodations) {
    if (!stayCoversItineraryDay(stay, dayIso)) continue;
    if (!hasUsableMapCoords(stay.lat, stay.lon)) continue;
    markers.push({
      id: `stay:${stay.id ?? `${stay.lat},${stay.lon}`}`,
      lat: stay.lat!,
      lon: stay.lon!,
      title: stay.name?.trim() || stay.address?.trim() || "Stay",
      order: 0,
      kind: "stay",
    });
  }

  activePlaces.forEach((slot, slotIndex) => {
    const displayOrder = slotIndex + 1;

    if (slot.type === "gap") return;

    if (slot.type === "route") {
      const route =
        (slot.routeId ? routesById.get(slot.routeId) : undefined) ??
        (slot.locationId.startsWith("route:")
          ? routesById.get(slot.locationId.slice(6))
          : undefined);
      if (!route) return;

      const from = route.from.location;
      const to = route.to.location;
      const fromOk =
        from && hasUsableMapCoords(from.lat, from.lon) ? from : null;
      const toOk = to && hasUsableMapCoords(to.lat, to.lon) ? to : null;
      const kind: DayMapPoint["kind"] =
        route.transport === "flight" ? "airport" : "city";

      if (fromOk) {
        markers.push({
          id: `${slot.locationId}:from`,
          lat: fromOk.lat,
          lon: fromOk.lon,
          title: route.from.name || route.from.city || "From",
          order: displayOrder,
          kind,
        });
      }
      if (toOk) {
        markers.push({
          id: `${slot.locationId}:to`,
          lat: toOk.lat,
          lon: toOk.lon,
          title: route.to.name || route.to.city || "To",
          order: displayOrder,
          kind,
        });
      }
      if (fromOk && toOk) {
        legs.push({
          id: route.id,
          transport: route.transport,
          from: { lat: fromOk.lat, lon: fromOk.lon },
          to: { lat: toOk.lat, lon: toOk.lon },
        });
      }
      return;
    }

    placeCount += 1;
    const place = byId.get(slot.locationId);
    if (!place || !hasUsableMapCoords(place.lat, place.lon)) return;

    markers.push({
      id: slot.locationId,
      lat: place.lat,
      lon: place.lon,
      title: slot.title?.trim() || place.title,
      order: displayOrder,
      kind: "place",
      status: slot.status === "visited" ? "visited" : place.status,
      googlePlaceId: place.city.googlePlaceId,
    });
    placePoints.push({
      id: slot.locationId,
      lat: place.lat,
      lon: place.lon,
    });
  });

  // Connect consecutive mappable places in itinerary order (visual path only).
  for (let i = 0; i < placePoints.length - 1; i += 1) {
    const a = placePoints[i];
    const b = placePoints[i + 1];
    if (!a || !b) continue;
    legs.push({
      id: `connect:${a.id}:${b.id}`,
      transport: "other" as TripRouteTransport,
      from: { lat: a.lat, lon: a.lon },
      to: { lat: b.lat, lon: b.lon },
    });
  }

  return { markers, legs, placeCount };
}

type AddPlaceTab = "list" | "map" | "search";

interface PlacesStepProps {
  trip: TripPlannerDoc;
  locations: SavedLocation[];
  userId: string;
  aiCreditsBalance: number;
  /** Google Places Text Search — Free is always off. */
  canSearchPlaces?: boolean;
  language?: string;
  onUpdateSavedPlaces: (ids: string[]) => Promise<void>;
  onUpdateItinerary: (itinerary: TripItinerary) => Promise<void>;
  onSavePlan: (payload: {
    savedPlaceIds: string[];
    itinerary: TripItinerary;
  }) => Promise<void>;
  onMarkPlaceStatus: (
    locationId: string,
    status: LocationStatus
  ) => Promise<void>;
  onSavePlaceNote: (locationId: string, note: string) => Promise<void>;
  onSavePlaceTravelInfo?: (
    locationId: string,
    patch: {
      description: string;
      note: string;
      ai: LocationAiMetadata;
    }
  ) => Promise<void>;
  onSavePlaceImages?: (
    locationId: string,
    images: LocationImage[]
  ) => Promise<void>;
  /** Pro: allow Google Place Photos in the preview sheet. */
  allowGooglePlacePhotos?: boolean;
}

export function PlacesStep({
  trip,
  locations,
  userId,
  aiCreditsBalance,
  canSearchPlaces = false,
  language,
  onUpdateSavedPlaces,
  onUpdateItinerary,
  onSavePlan,
  onMarkPlaceStatus,
  onSavePlaceNote,
  onSavePlaceTravelInfo,
  onSavePlaceImages,
  allowGooglePlacePhotos = false,
}: PlacesStepProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [addTab, setAddTab] = useState<AddPlaceTab>("list");
  const [addDayIndex, setAddDayIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchedPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchPackRemaining, setSearchPackRemaining] = useState(0);
  const [buyingSearchPack, setBuyingSearchPack] = useState(false);
  const [addingSearchPlaceId, setAddingSearchPlaceId] = useState<string | null>(
    null
  );
  const [searchError, setSearchError] = useState<string | null>(null);
  const [deleteAvailablePlace, setDeleteAvailablePlace] =
    useState<SavedLocation | null>(null);
  const [deletingAvailablePlace, setDeletingAvailablePlace] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planIntent, setPlanIntent] = useState<"generate" | "regenerate">(
    "generate"
  );
  const [planSetupConfirmOpen, setPlanSetupConfirmOpen] = useState(false);
  const [pendingPlanIntent, setPendingPlanIntent] = useState<
    "generate" | "regenerate"
  >("generate");
  const [preview, setPreview] = useState<SavedLocation | null>(null);
  /** Active itinerary day for the shared map (one map instance for all days). */
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [mobileMapOpen, setMobileMapOpen] = useState(false);
  const [mapFitToken, setMapFitToken] = useState(0);
  const placeRowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const recreateCost = planTripRegenerateCost(trip.createMode);

  const [tripRoutes, setTripRoutes] = useState<TripRoute[]>([]);
  useEffect(() => {
    return subscribeTripRoutes(userId, trip.id, setTripRoutes);
  }, [userId, trip.id]);
  const routesById = useMemo(
    () => new Map(tripRoutes.map((route) => [route.id, route])),
    [tripRoutes]
  );

  const byId = useMemo(
    () => new Map(locations.map((l) => [l.id, l])),
    [locations]
  );

  // iOS Safari/PWA can serve a partial locations cache (first page / stale
  // IndexedDB). Hydrate itinerary slots that are missing or lack city names.
  const hydratedLocationIdsRef = useRef(new Set<string>());
  useEffect(() => {
    hydratedLocationIdsRef.current = new Set();
  }, [trip.id]);

  useEffect(() => {
    const missing: string[] = [];
    for (const day of trip.itinerary.days) {
      for (const slot of day.places) {
        if (slot.type === "gap" || slot.type === "route") continue;
        const id = slot.locationId?.trim();
        if (!id || hydratedLocationIdsRef.current.has(id)) continue;
        const place = byId.get(id);
        if (
          !place ||
          !place.city?.name?.trim() ||
          !place.country?.name?.trim()
        ) {
          missing.push(id);
        }
      }
    }
    if (missing.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const id of missing) {
        if (cancelled) return;
        hydratedLocationIdsRef.current.add(id);
        try {
          await getUserLocation(userId, id, { hard: true });
        } catch {
          // Keep fallback locality from the day destination.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [trip.itinerary.days, byId, userId]);

  const availableToAdd = useMemo(() => {
    const taken = new Set(trip.savedPlaceIds);
    for (const day of trip.itinerary.days) {
      for (const place of day.places) {
        taken.add(place.locationId);
      }
    }

    const destinations = listTripDestinations(trip);
    const matched = matchLocationsToDestinations(locations, destinations).filter(
      (place) => !taken.has(place.id)
    );
    return sortLocationsForDestination(matched, destinations);
  }, [locations, trip]);

  const availableToAddMarkers: MapMarkerInput[] = useMemo(
    () =>
      availableToAdd.map((place) => ({
        id: place.id,
        lat: place.lat,
        lon: place.lon,
        title: place.title,
        status: place.status,
        kind: "place" as const,
        googlePlaceId: place.city.googlePlaceId,
      })),
    [availableToAdd]
  );

  async function toggleItineraryPlace(
    dayIndex: number,
    locationId: string,
    next: LocationStatus
  ) {
    const slot = trip.itinerary.days[dayIndex]?.places.find(
      (p) => p.locationId === locationId
    );

    // Route / gap slots are itinerary-only (no saved location doc).
    if (slot?.type === "route" || slot?.type === "gap") {
      const days: ItineraryDay[] = trip.itinerary.days.map((day, i) => {
        if (i !== dayIndex) return day;
        return {
          ...day,
          places: day.places.map((p) =>
            p.locationId === locationId ? { ...p, status: next } : p
          ),
        };
      });
      await onUpdateItinerary({
        status:
          trip.itinerary.status === "empty" ? "edited" : trip.itinerary.status,
        days,
      });
      return;
    }

    // Real places with a saved location: update location status (visited/planned)
    // and sync every itinerary slot that points at it.
    if (byId.has(locationId)) {
      await onMarkPlaceStatus(locationId, next);
      return;
    }

    // Orphan itinerary slot (no location doc) — update itinerary only.
    const days: ItineraryDay[] = trip.itinerary.days.map((day) => ({
      ...day,
      places: day.places.map((p) =>
        p.locationId === locationId ? { ...p, status: next } : p
      ),
    }));
    await onUpdateItinerary({
      status:
        trip.itinerary.status === "empty" ? "edited" : trip.itinerary.status,
      days,
    });
  }

  async function removeFromTrip(locationId: string) {
    const nextIds = trip.savedPlaceIds.filter((id) => id !== locationId);
    await onUpdateSavedPlaces(nextIds);
    if (trip.itinerary.days.length > 0) {
      const days = trip.itinerary.days
        .map((day) => ({
          ...day,
          places: day.places
            .filter((p) => p.locationId !== locationId)
            .map((p, order) => ({ ...p, order })),
        }));
      await onUpdateItinerary({
        status: "edited",
        days,
      });
    }
  }

  async function deleteAvailableSavedPlace(place: SavedLocation) {
    setDeletingAvailablePlace(true);
    try {
      await deleteUserLocation(userId, place.id);
      // Keep trip docs clean if this id was referenced somehow.
      if (trip.savedPlaceIds.includes(place.id)) {
        await removeFromTrip(place.id);
      }
      setDeleteAvailablePlace(null);
    } finally {
      setDeletingAvailablePlace(false);
    }
  }

  async function addPlaceToTrip(locationId: string) {
    const alreadySaved = trip.savedPlaceIds.includes(locationId);
    const nextIds = alreadySaved
      ? trip.savedPlaceIds
      : [...trip.savedPlaceIds, locationId];

    let nextItinerary: TripItinerary | null = null;
    if (addDayIndex !== null && trip.itinerary.days.length > 0) {
      const day = trip.itinerary.days[addDayIndex];
      if (day && !day.places.some((p) => p.locationId === locationId)) {
        nextItinerary = {
          status: "edited",
          days: trip.itinerary.days.map((d, i) => {
            if (i !== addDayIndex) return d;
            return {
              ...d,
              places: [
                ...d.places,
                {
                  locationId,
                  order: d.places.length,
                  status: "planned" as const,
                },
              ],
            };
          }),
        };
      }
    }

    if (!alreadySaved) {
      await onUpdateSavedPlaces(nextIds);
    }
    if (nextItinerary) {
      await onUpdateItinerary(nextItinerary);
    }

    return {
      savedPlaceIds: nextIds,
      itinerary: nextItinerary ?? trip.itinerary,
    };
  }

  const lastChargedSearchQueryRef = useRef("");
  const searchPackRemainingRef = useRef(searchPackRemaining);
  searchPackRemainingRef.current = searchPackRemaining;

  async function buySearchPack() {
    setSearchError(null);
    if (!canSearchPlaces) {
      setSearchError("Place name search is not included in your plan.");
      return;
    }
    if (aiCreditsBalance < AI_CREDIT_COSTS.searchPlaces) {
      setSearchError(
        `Not enough AI credits. Need ${AI_CREDIT_COSTS.searchPlaces}, you have ${aiCreditsBalance}.`
      );
      return;
    }
    setBuyingSearchPack(true);
    try {
      const pack = await purchasePlaceSearchPack();
      const granted = pack.searchesGranted || PLACE_SEARCH_PACK_SIZE;
      const q = searchQuery.trim();
      if (q.length >= 2) {
        lastChargedSearchQueryRef.current = q;
        setSearchPackRemaining(granted - 1);
        setSearching(true);
        try {
          const results = await searchPlacesByName(q, {
            maxResultCount: PLACE_SEARCH_PACK_SIZE,
          });
          setSearchResults(results);
        } catch {
          setSearchResults([]);
        } finally {
          setSearching(false);
        }
      } else {
        setSearchPackRemaining((prev) => prev + granted);
      }
    } catch (err) {
      if (isInsufficientAICreditsError(err)) {
        setSearchError(formatInsufficientCreditsMessage(err));
      } else {
        setSearchError(
          err instanceof Error ? err.message : "Could not unlock searches."
        );
      }
    } finally {
      setBuyingSearchPack(false);
    }
  }

  async function addSearchedPlace(place: SearchedPlace) {
    setSearchError(null);
    setAddingSearchPlaceId(place.placeId);
    try {
      const cityName = place.cityName.trim();
      const countryName = place.countryName.trim();
      const englishIds = await resolveEnglishPlaceIds(place.lat, place.lon);
      const countryCode =
        englishIds?.countryCode ||
        resolveCountryCode(countryName) ||
        undefined;
      const countryData = {
        id: countryIdFromParts(
          englishIds?.countryNameEn || countryName,
          countryCode
        ),
        name: countryName,
      };
      const cityId =
        (englishIds?.cityId && isAsciiId(englishIds.cityId)
          ? englishIds.cityId
          : null) ||
        (isAsciiId(slugifyId(englishIds?.cityNameEn || ""))
          ? slugifyId(englishIds!.cityNameEn)
          : null) ||
        (isAsciiId(slugifyId(cityName)) ? slugifyId(cityName) : null);
      if (!isAsciiId(countryData.id) || !cityId) {
        throw new Error(
          "Could not resolve English city/country ids for this place."
        );
      }
      const cityData = await withCityGooglePlaceId(
        { id: cityId, name: cityName },
        countryData,
        { lat: place.lat, lon: place.lon }
      );

      const locationId = await createUserLocation(userId, {
        title: place.title.trim(),
        description: place.address || "Added from Google Maps search.",
        lat: place.lat,
        lon: place.lon,
        country: countryData,
        city: cityData,
        status: "planned",
        images: [],
        confidence: 1,
        ai: {
          why: `Matched from Google Maps search: ${place.address}`,
          model: "manual",
          processedAt: Timestamp.now(),
        },
        source: { type: "manual" },
      });

      const saved = await addPlaceToTrip(locationId);
      await onSavePlan(saved);
      setSearchResults((prev) =>
        prev.filter((p) => p.placeId !== place.placeId)
      );
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : "Failed to add place."
      );
    } finally {
      setAddingSearchPlaceId(null);
    }
  }

  // Name search — packed credits; charge once per distinct query.
  useEffect(() => {
    if (!addOpen || addTab !== "search" || !canSearchPlaces) return;
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    if (searchPackRemainingRef.current <= 0) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      if (searchPackRemainingRef.current <= 0) return;

      const alreadyCharged = lastChargedSearchQueryRef.current === q;
      if (!alreadyCharged) {
        lastChargedSearchQueryRef.current = q;
        setSearchPackRemaining((prev) => Math.max(0, prev - 1));
      }

      setSearching(true);
      void searchPlacesByName(q, { maxResultCount: PLACE_SEARCH_PACK_SIZE })
        .then((results) => {
          if (!cancelled) setSearchResults(results);
        })
        .catch(() => {
          if (!cancelled) setSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [addOpen, addTab, searchQuery, canSearchPlaces]);

  function openAddSheet(dayIndex?: number) {
    setAddDayIndex(dayIndex ?? null);
    setAddTab("list");
    setSearchError(null);
    setAddOpen(true);
  }

  function openPlanSheet(intent: "generate" | "regenerate" = "generate") {
    setPlanIntent(intent);
    setPlanOpen(true);
  }

  const hasRoutes = tripRoutes.length > 0;
  const hasAccommodation = listTripAccommodations(trip).length > 0;
  const missingSetupDetails = !hasRoutes || !hasAccommodation;

  function requestPlanSheet(intent: "generate" | "regenerate" = "generate") {
    if (missingSetupDetails) {
      setPendingPlanIntent(intent);
      setPlanSetupConfirmOpen(true);
      return;
    }
    openPlanSheet(intent);
  }

  function planSetupWarningDescription(): string {
    if (!hasRoutes && !hasAccommodation) {
      return "You haven’t added flight or accommodation details. Your trip plan might be inaccurate. Do you confirm?";
    }
    if (!hasRoutes) {
      return "You haven’t added flight details. Your trip plan might be inaccurate. Do you confirm?";
    }
    return "You haven’t added accommodation details. Your trip plan might be inaccurate. Do you confirm?";
  }

  const hasItinerary =
    trip.itinerary.status !== "empty" && trip.itinerary.days.length > 0;

  // Keep active day in range when the itinerary shrinks/grows.
  useEffect(() => {
    const dayCount = trip.itinerary.days.length;
    if (dayCount === 0) {
      setActiveDayIndex(0);
      return;
    }
    if (activeDayIndex >= dayCount) {
      setActiveDayIndex(dayCount - 1);
    }
  }, [trip.itinerary.days.length, activeDayIndex]);

  const tripAccommodations = useMemo(
    () => listTripAccommodations(trip),
    [trip]
  );

  const activeDay = trip.itinerary.days[activeDayIndex];
  const dayMapData = useMemo(
    () =>
      buildDayMapData(activeDay, byId, routesById, tripAccommodations),
    [activeDay, byId, routesById, tripAccommodations]
  );

  const dayMapMarkers: MapMarkerInput[] = useMemo(
    () =>
      dayMapData.markers.map((m) => ({
        id: m.id,
        lat: m.lat,
        lon: m.lon,
        title: m.title,
        kind: m.kind,
        order: m.kind === "place" ? m.order : undefined,
        ...(m.status ? { status: m.status } : {}),
        ...(m.googlePlaceId ? { googlePlaceId: m.googlePlaceId } : {}),
      })),
    [dayMapData.markers]
  );

  const mappablePlaceCount = useMemo(
    () => dayMapData.markers.filter((m) => m.kind === "place").length,
    [dayMapData.markers]
  );

  const dayMapContentKey = useMemo(
    () =>
      [
        activeDayIndex,
        ...dayMapData.markers.map(
          (m) => `${m.id}:${m.lat}:${m.lon}:${m.order}`
        ),
        ...dayMapData.legs.map((l) => l.id),
      ].join("|"),
    [activeDayIndex, dayMapData.markers, dayMapData.legs]
  );

  // Refit when the active day's mappable content arrives/changes (same map instance).
  useEffect(() => {
    if (!hasItinerary) return;
    setMapFitToken((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by dayMapContentKey
  }, [dayMapContentKey, hasItinerary]);

  useEffect(() => {
    if (!mobileMapOpen) return;
    return lockBodyScroll();
  }, [mobileMapOpen]);

  function selectActiveDay(dayIndex: number, opts?: { fit?: boolean }) {
    setActiveDayIndex(dayIndex);
    setSelectedPlaceId(null);
    if (opts?.fit !== false) {
      setMapFitToken((n) => n + 1);
    }
  }

  function focusPlaceFromMap(markerId: string) {
    // Route endpoint markers use `${slotId}:from|to` — highlight the slot id.
    const placeId = markerId.includes(":")
      ? markerId.replace(/:(from|to)$/, "")
      : markerId;
    setSelectedPlaceId(placeId);

    // Ensure the day containing this place is expanded/active.
    const dayIdx = trip.itinerary.days.findIndex((day) =>
      day.places.some((slot) => slot.locationId === placeId)
    );
    if (dayIdx >= 0 && dayIdx !== activeDayIndex) {
      selectActiveDay(dayIdx, { fit: false });
    }

    window.requestAnimationFrame(() => {
      placeRowRefs.current.get(placeId)?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
  }

  function focusPlaceFromItinerary(placeId: string, dayIndex: number) {
    if (dayIndex !== activeDayIndex) {
      selectActiveDay(dayIndex, { fit: false });
    }
    setSelectedPlaceId(placeId);
  }

  const itineraryMap = (
    <TripPlannerItineraryMap
      markers={dayMapMarkers}
      legs={dayMapData.legs}
      selectedMarkerId={selectedPlaceId}
      onMarkerSelect={focusPlaceFromMap}
      fitToken={mapFitToken}
      className="h-full w-full"
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            Places &amp; Itinerary
          </h2>
          <p className="mt-1 max-w-xl text-sm text-text-secondary">
            Organize your saved places, plan your itinerary and mark places as
            you visit.
          </p>
        </div>
        {hasItinerary ? (
          <Button
            icon={RefreshCw}
            variant="secondary"
            onClick={() => requestPlanSheet("regenerate")}
            className="h-11 shrink-0 !border-border !bg-surface-elevated !text-text"
          >
            Regenerate ({recreateCost} AI credits)
          </Button>
        ) : null}
      </div>

      {hasItinerary ? (
        <div className="relative lg:grid lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)] lg:items-start lg:gap-5">
          <div className="min-w-0">
            <ItineraryList
              trip={trip}
              byId={byId}
              routesById={routesById}
              activeDayIndex={activeDayIndex}
              selectedPlaceId={selectedPlaceId}
              placeRowRefs={placeRowRefs}
              onSelectDay={(dayIndex) => selectActiveDay(dayIndex)}
              onSelectPlace={(placeId, dayIndex) =>
                focusPlaceFromItinerary(placeId, dayIndex)
              }
              onToggleStatus={(dayIndex, locationId, status) =>
                void toggleItineraryPlace(dayIndex, locationId, status)
              }
              onOpen={(place) => setPreview(place)}
              onRemove={(id) => void removeFromTrip(id)}
              onPlan={() => requestPlanSheet("generate")}
              onAddPlace={(dayIndex) => openAddSheet(dayIndex)}
              onAddPlaces={() => openAddSheet()}
              onUpdateItinerary={onUpdateItinerary}
            />
          </div>

          {/*
            ONE shared map shell:
            - Desktop (lg+): sticky right column
            - Mobile/tablet: same instance, fullscreen when open (never remounted).
              Keep flex + full size while closed so Google Maps does not init at 0×0.
          */}
          <div
            className={cx(
              "overflow-hidden bg-surface-elevated",
              mobileMapOpen
                ? "fixed inset-0 z-50 flex flex-col"
                : "max-lg:pointer-events-none max-lg:fixed max-lg:inset-0 max-lg:-z-10 max-lg:flex max-lg:flex-col max-lg:invisible",
              "lg:sticky lg:top-20 lg:z-auto lg:flex lg:h-[calc(100vh-6.5rem)] lg:flex-col lg:rounded-2xl lg:border lg:border-border lg:shadow-sm"
            )}
          >
            {mobileMapOpen ? (
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text">
                    Day {activeDay?.day ?? activeDayIndex + 1}
                    {activeDay?.title ? ` · ${activeDay.title}` : ""}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {mappablePlaceCount}{" "}
                    {mappablePlaceCount === 1 ? "place" : "places"} on map
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMapOpen(false)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface text-text hover:bg-divider"
                  aria-label="Close map"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="hidden shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5 lg:flex">
                <p className="truncate text-xs font-medium text-text-secondary">
                  Day {activeDay?.day ?? activeDayIndex + 1} map
                </p>
                <p className="shrink-0 text-[11px] text-text-muted">
                  {mappablePlaceCount}{" "}
                  {mappablePlaceCount === 1 ? "place" : "places"}
                </p>
              </div>
            )}
            <div className="relative min-h-0 flex-1">
              {itineraryMap}
            </div>
          </div>

          {!mobileMapOpen ? (
            <button
              type="button"
              onClick={() => {
                setMobileMapOpen(true);
                // Refit after the fullscreen shell paints (tiles + markers).
                window.requestAnimationFrame(() => {
                  setMapFitToken((n) => n + 1);
                });
              }}
              className="fixed bottom-5 left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-surface-elevated px-4 py-3 text-sm font-semibold text-text shadow-md ring-1 ring-black/5 lg:hidden"
            >
              <MapIcon className="h-4 w-4 text-primary" />
              Map · {mappablePlaceCount}{" "}
              {mappablePlaceCount === 1 ? "place" : "places"}
            </button>
          ) : null}
        </div>
      ) : (
        <ItineraryList
          trip={trip}
          byId={byId}
          routesById={routesById}
          activeDayIndex={0}
          selectedPlaceId={null}
          placeRowRefs={placeRowRefs}
          onSelectDay={() => undefined}
          onSelectPlace={() => undefined}
          onToggleStatus={(dayIndex, locationId, status) =>
            void toggleItineraryPlace(dayIndex, locationId, status)
          }
          onOpen={(place) => setPreview(place)}
          onRemove={(id) => void removeFromTrip(id)}
          onPlan={() => requestPlanSheet("generate")}
          onAddPlace={(dayIndex) => openAddSheet(dayIndex)}
          onAddPlaces={() => openAddSheet()}
          onUpdateItinerary={onUpdateItinerary}
        />
      )}

      <Sheet
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          setAddDayIndex(null);
          setAddTab("list");
          setSearchError(null);
        }}
        title={
          addDayIndex !== null
            ? `Add place to day ${addDayIndex + 1}`
            : "Add places to trip"
        }
        size="lg"
        bodyClassName="!p-0"
      >
        <div className="flex min-h-0 flex-col">
          <div className="px-4 pt-3 sm:px-5">
            <div className="grid grid-cols-3 rounded-xl bg-surface p-1">
              <ViewTab
                active={addTab === "list"}
                onClick={() => setAddTab("list")}
                icon={<ListOrdered className="h-4 w-4" />}
                label="List"
              />
              <ViewTab
                active={addTab === "map"}
                onClick={() => setAddTab("map")}
                icon={<MapIcon className="h-4 w-4" />}
                label="Map"
              />
              <ViewTab
                active={addTab === "search"}
                onClick={() => setAddTab("search")}
                icon={<Search className="h-4 w-4" />}
                label="Search"
              />
            </div>
          </div>

          {addTab === "search" && !canSearchPlaces ? (
            <div className="space-y-3 px-4 py-6 sm:px-5">
              <p className="text-sm text-text-secondary">
                Place name search (Google Places) is not included in your plan.
              </p>
            </div>
          ) : null}

          {addTab === "list" ? (
            <div className="space-y-2 px-4 py-3 sm:px-5">
              {availableToAdd.length === 0 ? (
                <p className="text-sm text-text-secondary">
                  No saved places in{" "}
                  {listTripDestinations(trip)
                    .map((dest) => dest.cityName)
                    .filter(Boolean)
                    .join(", ") ||
                    listTripDestinations(trip)[0]?.countryName ||
                    "your destinations"}{" "}
                  left to add. Use Search to find new places, or save places
                  from the map first.
                </p>
              ) : (
                <>
                  <p className="text-xs font-medium text-text-muted">
                    {availableToAdd.length}{" "}
                    {availableToAdd.length === 1 ? "place" : "places"}{" "}
                    available
                  </p>
                  {availableToAdd.map((place) => (
                    <div
                      key={place.id}
                      className="flex w-full items-center gap-2 rounded-xl border border-border px-3 py-3"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          void addPlaceToTrip(place.id);
                        }}
                        className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left hover:opacity-90"
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <PlaceThumb
                            place={place}
                            className="!h-14 !w-14 rounded-xl"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-text">
                              {place.title}
                            </span>
                            <span className="text-xs text-text-secondary">
                              {placeLocalityLabel(place) || "Unknown area"}
                            </span>
                          </span>
                        </span>
                        <Plus className="h-4 w-4 shrink-0 text-primary" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${place.title}`}
                        title="Delete saved place"
                        onClick={() => setDeleteAvailablePlace(place)}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-error-background hover:text-error"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          ) : null}

          {addTab === "map" ? (
            <div className="flex min-h-0 flex-col px-4 pb-4 pt-3 sm:px-5">
              {availableToAdd.length === 0 ? (
                <p className="text-sm text-text-secondary">
                  No available saved places to pin. Switch to Search to find
                  new ones.
                </p>
              ) : (
                <>
                  <p className="mb-2 text-xs text-text-secondary">
                    Tap a pin to add that place
                    {addDayIndex !== null
                      ? ` to day ${addDayIndex + 1}`
                      : " to this trip"}
                    .
                  </p>
                  <div className="relative h-[min(52vh,360px)] overflow-hidden rounded-xl border border-border bg-surface">
                    <TravelMap
                      className="absolute inset-0 h-full w-full"
                      markers={availableToAddMarkers}
                      fitToMarkers
                      showCurrentLocation={false}
                      centerOnCurrentLocation={false}
                      interactionMode="pick-place"
                      onMarkerSelect={(id) => {
                        void addPlaceToTrip(id);
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          ) : null}

          {addTab === "search" && canSearchPlaces ? (
            <div className="space-y-3 px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-text-secondary">
                  {searchPackRemaining > 0
                    ? `${searchPackRemaining} search${searchPackRemaining === 1 ? "" : "es"} left in your pack`
                    : `Unlock ${PLACE_SEARCH_PACK_SIZE} searches for ${AI_CREDIT_COSTS.searchPlaces} AI credits`}
                </p>
                <p className="text-xs text-text-muted">
                  Balance {aiCreditsBalance}
                </p>
              </div>

              {searchPackRemaining <= 0 ? (
                <Button
                  icon={buyingSearchPack ? Loader2 : Sparkles}
                  onClick={() => void buySearchPack()}
                  disabled={buyingSearchPack}
                  className="h-11 w-full !bg-primary hover:!bg-primary-hover !border-primary !text-white"
                >
                  {buyingSearchPack
                    ? "Unlocking…"
                    : `Unlock ${PLACE_SEARCH_PACK_SIZE} searches · ${AI_CREDIT_COSTS.searchPlaces} credits`}
                </Button>
              ) : (
                <TextInput
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search place name…"
                  icon={Search}
                  autoFocus
                />
              )}

              {searchError ? (
                <p className="text-sm text-error">{searchError}</p>
              ) : null}

              {searching ? (
                <p className="inline-flex items-center gap-2 text-sm text-text-secondary">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  Searching…
                </p>
              ) : null}

              {searchPackRemaining > 0 &&
              !searching &&
              searchQuery.trim().length >= 2 &&
              searchResults.length === 0 ? (
                <p className="text-sm text-text-secondary">No places found.</p>
              ) : null}

              <div className="space-y-2">
                {searchResults.map((place) => {
                  const busy = addingSearchPlaceId === place.placeId;
                  return (
                    <button
                      key={place.placeId}
                      type="button"
                      disabled={Boolean(addingSearchPlaceId)}
                      onClick={() => {
                        void addSearchedPlace(place);
                      }}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-border px-3 py-3 text-left hover:border-primary/30 disabled:opacity-60"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-text">
                          {place.title}
                        </span>
                        <span className="block truncate text-xs text-text-secondary">
                          {place.address}
                        </span>
                      </span>
                      {busy ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                      ) : (
                        <Plus className="h-4 w-4 shrink-0 text-primary" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </Sheet>

      <PlanTripSheet
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        userId={userId}
        trip={trip}
        locations={locations}
        aiCreditsBalance={aiCreditsBalance}
        language={language}
        intent={planIntent}
        onSaved={async (payload) => {
          await onSavePlan(payload);
        }}
      />

      <ConfirmModal
        open={planSetupConfirmOpen}
        title="Plan without full details?"
        description={planSetupWarningDescription()}
        confirmLabel="Plan anyway"
        cancelLabel="Go back"
        onCancel={() => setPlanSetupConfirmOpen(false)}
        onConfirm={() => {
          setPlanSetupConfirmOpen(false);
          openPlanSheet(pendingPlanIntent);
        }}
      />

      <ConfirmModal
        open={Boolean(deleteAvailablePlace)}
        title="Delete saved place?"
        description={
          deleteAvailablePlace
            ? `“${deleteAvailablePlace.title}” will be removed from your saved places.`
            : undefined
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        tone="danger"
        loading={deletingAvailablePlace}
        onCancel={() => {
          if (!deletingAvailablePlace) setDeleteAvailablePlace(null);
        }}
        onConfirm={() => {
          if (deleteAvailablePlace) {
            void deleteAvailableSavedPlace(deleteAvailablePlace);
          }
        }}
      />

      <PlacePreviewSheet
        place={preview}
        open={Boolean(preview)}
        userId={userId}
        allowGooglePlacePhotos={allowGooglePlacePhotos}
        onClose={() => setPreview(null)}
        onUpdateStatus={async (status) => {
          if (!preview) return;
          await onMarkPlaceStatus(preview.id, status);
          setPreview({ ...preview, status });
        }}
        onSaveNote={async (note) => {
          if (!preview) return;
          await onSavePlaceNote(preview.id, note);
          setPreview({ ...preview, note });
        }}
        onSaveTravelInfo={
          onSavePlaceTravelInfo
            ? async (patch) => {
                if (!preview) return;
                await onSavePlaceTravelInfo(preview.id, patch);
                setPreview({ ...preview, ...patch });
              }
            : undefined
        }
        onSaveImages={
          onSavePlaceImages
            ? async (images) => {
                if (!preview) return;
                await onSavePlaceImages(preview.id, images);
                setPreview({ ...preview, images });
              }
            : undefined
        }
        onDelete={async () => {
          if (!preview) return;
          await deleteAvailableSavedPlace(preview);
          setPreview(null);
        }}
      />

      <TripSetupChecklist trip={trip} userId={userId} />
    </div>
  );
}

function ViewTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-surface-elevated text-primary shadow-sm"
          : "text-text-secondary hover:text-text"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function ItineraryList({
  trip,
  byId,
  routesById,
  activeDayIndex,
  selectedPlaceId,
  placeRowRefs,
  onSelectDay,
  onSelectPlace,
  onToggleStatus,
  onOpen,
  onRemove,
  onPlan,
  onAddPlace,
  onAddPlaces,
  onUpdateItinerary,
}: {
  trip: TripPlannerDoc;
  byId: Map<string, SavedLocation>;
  routesById: Map<string, TripRoute>;
  activeDayIndex: number;
  selectedPlaceId: string | null;
  placeRowRefs: MutableRefObject<Map<string, HTMLElement>>;
  onSelectDay: (dayIndex: number) => void;
  onSelectPlace: (placeId: string, dayIndex: number) => void;
  onToggleStatus: (
    dayIndex: number,
    locationId: string,
    status: LocationStatus
  ) => void;
  onOpen: (place: SavedLocation) => void;
  onRemove: (locationId: string) => void;
  onPlan: () => void;
  onAddPlace: (dayIndex: number) => void;
  onAddPlaces: () => void;
  onUpdateItinerary: (itinerary: TripItinerary) => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [userCoords, setUserCoords] = useState<Coords | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  /** Optimistic weather keyed by day number until trip doc catches up. */
  const [weatherByDay, setWeatherByDay] = useState<
    Map<number, ItineraryDayWeather>
  >(() => new Map());
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  async function reorderDaySlots(
    dayIndex: number,
    fromKey: string,
    toKey: string
  ) {
    if (fromKey === toKey) return;
    const day = trip.itinerary.days[dayIndex];
    if (!day) return;

    const ordered = [...day.places].sort((a, b) => a.order - b.order);
    const fromIndex = ordered.findIndex((slot) => slot.locationId === fromKey);
    const toIndex = ordered.findIndex((slot) => slot.locationId === toKey);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

    const next = [...ordered];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);

    const days = trip.itinerary.days.map((d, i) => {
      if (i !== dayIndex) return d;
      return {
        ...d,
        places: next.map((slot, order) => ({ ...slot, order })),
      };
    });

    await onUpdateItinerary({
      status: "edited",
      days,
    });
  }

  async function moveDaySlot(dayIndex: number, locationId: string, delta: -1 | 1) {
    const day = trip.itinerary.days[dayIndex];
    if (!day) return;
    const ordered = [...day.places].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((slot) => slot.locationId === locationId);
    if (index < 0) return;
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    const targetSlot = ordered[target];
    if (!targetSlot) return;
    await reorderDaySlots(dayIndex, locationId, targetSlot.locationId);
  }

  async function updatePlaceVisitTime(
    dayIndex: number,
    locationId: string,
    next: { from: string; to: string } | null
  ) {
    const day = trip.itinerary.days[dayIndex];
    if (!day) return;

    const days = trip.itinerary.days.map((d, i) => {
      if (i !== dayIndex) return d;
      return {
        ...d,
        places: d.places.map((slot) => {
          if (slot.locationId !== locationId) return slot;
          if (!next) {
            const rest = { ...slot };
            delete rest.bestVisitTime;
            return rest;
          }
          const durationMinutes = durationFromVisitWindow(next.from, next.to);
          return {
            ...slot,
            bestVisitTime: { from: next.from, to: next.to },
            ...(durationMinutes != null ? { durationMinutes } : {}),
          };
        }),
      };
    });

    await onUpdateItinerary({
      status: "edited",
      days,
    });
  }

  const destinations = listTripDestinations(trip);
  const hasCoords = destinations.some(
    (dest) =>
      typeof dest.lat === "number" &&
      Number.isFinite(dest.lat) &&
      typeof dest.lon === "number" &&
      Number.isFinite(dest.lon)
  );
  const needsFetch = itineraryNeedsWeatherFetch(trip.itinerary.days);
  const destWeatherKey = destinations
    .map(
      (dest) =>
        `${dest.cityId ?? dest.cityName}:${dest.lat ?? ""}:${dest.lon ?? ""}:${dest.startDate?.toMillis?.() ?? ""}:${dest.endDate?.toMillis?.() ?? ""}`
    )
    .join("|");

  useEffect(() => {
    let cancelled = false;
    void getBrowserCoords({ timeoutMs: 10_000, maximumAge: 60_000 }).then(
      (coords) => {
        if (!cancelled && coords) setUserCoords(coords);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync local override from persisted trip weather when cache is warm.
  useEffect(() => {
    if (needsFetch) return;
    const next = new Map<number, ItineraryDayWeather>();
    for (const day of trip.itinerary.days) {
      if (day.weather) next.set(day.day, day.weather);
    }
    setWeatherByDay(next);
  }, [needsFetch, trip.itinerary.days]);

  useEffect(() => {
    if (!hasCoords || trip.itinerary.days.length === 0 || !needsFetch) {
      setWeatherLoading(false);
      return;
    }

    let cancelled = false;
    setWeatherLoading(true);

    void weatherForTrip(trip)
      .then(async ({ byIsoDate }) => {
        if (cancelled) return;

        const localWeather = new Map<number, ItineraryDayWeather>();
        const days = trip.itinerary.days.map((day) => {
          const weather =
            byIsoDate.get(toIsoDate(day.date.toDate())) ?? day.weather;
          if (weather) localWeather.set(day.day, weather);
          return weather ? { ...day, weather } : day;
        });

        setWeatherByDay(localWeather);
        setWeatherLoading(false);

        try {
          await onUpdateItinerary({
            status: trip.itinerary.status,
            days,
          });
        } catch {
          // UI already shows localWeather; persist can retry on next visit.
        }
      })
      .catch(() => {
        if (cancelled) return;
        setWeatherLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Fetch only when cache is missing/stale or destination/dates change.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional trip field deps
  }, [
    hasCoords,
    destWeatherKey,
    needsFetch,
    trip.startDate?.toMillis?.(),
    trip.endDate?.toMillis?.(),
    trip.itinerary.days.length,
  ]);

  /** Place slots that still need a photo attempt (empty, not flagged, or share a duplicate URL). */
  const missingPhotoKey = useMemo(() => {
    const keys: string[] = [];
    const urlOwner = new Map<string, string>();
    for (const day of trip.itinerary.days) {
      for (const slot of day.places) {
        if (slot.type === "gap" || slot.type === "route") continue;
        const place = byId.get(slot.locationId);
        const url = slot.imageUrl?.trim();
        if (url) {
          const owner = urlOwner.get(url);
          if (!owner) {
            urlOwner.set(url, slot.locationId);
          } else if (owner !== slot.locationId) {
            keys.push(`dup:${day.day}:${slot.locationId}`);
            continue;
          }
        }
        if (slot.noImage) continue;
        if (itinerarySlotHasImage(slot, place)) continue;
        keys.push(`${day.day}:${slot.locationId}`);
      }
    }
    return keys.join("|");
  }, [trip.itinerary.days, byId]);

  // Fill empty itinerary place thumbs from Pexels; flag noImage when none found.
  useEffect(() => {
    if (!missingPhotoKey) return;

    let cancelled = false;
    const usedPhotoIds = new Set<string>();
    for (const day of trip.itinerary.days) {
      for (const slot of day.places) {
        const existing = slot.imageUrl?.trim();
        if (existing) usedPhotoIds.add(pexelsPhotoUrlExcludeId(existing));
        const place = byId.get(slot.locationId);
        for (const img of place?.images ?? []) {
          const url = img.url?.trim();
          if (url) usedPhotoIds.add(pexelsPhotoUrlExcludeId(url));
        }
      }
    }

    void (async () => {
      let changed = false;
      const days = trip.itinerary.days.map((day) => ({
        ...day,
        places: day.places.map((slot) => ({ ...slot })),
      }));

      // Same generic city photo was often assigned to every place. Keep the first
      // owner of each URL and clear the rest so they re-resolve by place name.
      const urlOwner = new Map<string, string>();
      for (const day of days) {
        for (const slot of day.places) {
          if (slot.type === "gap" || slot.type === "route") continue;
          const url = slot.imageUrl?.trim();
          if (!url) continue;
          const owner = urlOwner.get(url);
          if (!owner) {
            urlOwner.set(url, slot.locationId);
            continue;
          }
          if (owner === slot.locationId) continue;
          delete slot.imageUrl;
          delete slot.noImage;
          changed = true;
        }
      }

      for (const day of days) {
        for (const slot of day.places) {
          if (cancelled) return;
          if (slot.type === "gap" || slot.type === "route") continue;
          if (slot.noImage) continue;
          const place = byId.get(slot.locationId);
          if (itinerarySlotHasImage(slot, place)) continue;

          const title =
            slot.title?.trim() || place?.title?.trim() || "";
          const cityName = place?.city?.name?.trim() || "";
          const countryName = place?.country?.name?.trim() || undefined;
          const lat = place?.lat;
          const lon = place?.lon;

          if (
            !title ||
            !cityName ||
            typeof lat !== "number" ||
            !Number.isFinite(lat) ||
            typeof lon !== "number" ||
            !Number.isFinite(lon)
          ) {
            slot.noImage = true;
            delete slot.imageUrl;
            changed = true;
            continue;
          }

          try {
            const photo = await fetchSuggestedPlacePhoto({
              title,
              cityName,
              countryName,
              lat,
              lon,
              excludePlaceIds: usedPhotoIds,
            });
            if (cancelled) return;
            if (photo?.photoUrl) {
              usedPhotoIds.add(photo.placeId);
              usedPhotoIds.add(pexelsPhotoUrlExcludeId(photo.photoUrl));
              slot.imageUrl = photo.photoUrl;
              delete slot.noImage;
              changed = true;
            } else {
              slot.noImage = true;
              delete slot.imageUrl;
              changed = true;
            }
          } catch {
            if (cancelled) return;
            slot.noImage = true;
            delete slot.imageUrl;
            changed = true;
          }
        }
      }

      if (!changed || cancelled) return;
      try {
        await onUpdateItinerary({
          status:
            trip.itinerary.status === "empty"
              ? "edited"
              : trip.itinerary.status,
          days,
        });
      } catch {
        // Next visit can retry slots that never persisted noImage/imageUrl.
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by missingPhotoKey
  }, [missingPhotoKey]);

  if (trip.itinerary.status === "empty" || trip.itinerary.days.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface px-4 py-10 text-center">
        <p className="text-sm font-medium text-text">No itinerary yet</p>
        <p className="mt-1 text-sm text-text-secondary">
          Choose a leisure style and let AI plan days around that purpose —
          including rest and free time — or add your own.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button
            icon={Plus}
            variant="secondary"
            onClick={onAddPlaces}
            className="!border-border !bg-surface-elevated !text-text h-11"
          >
            Add places
          </Button>
          <Button
            icon={Sparkles}
            onClick={onPlan}
            className="!bg-primary hover:!bg-primary-hover !border-primary !text-white h-11"
          >
            Plan my trip
          </Button>
        </div>
      </div>
    );
  }

  const tripDestinations = listTripDestinations(trip);

  return (
    <div className="space-y-4">
      {trip.itinerary.days.map((day, dayIndex) => {
        const isCollapsed = collapsed[day.day] ?? false;
        const isActiveDay = dayIndex === activeDayIndex;
        const activePlaces = [...day.places]
          .filter((slot) => isActiveItinerarySlot(slot, byId))
          .sort((a, b) => a.order - b.order);
        const placeCount = activePlaces.filter(
          (slot) => slot.type !== "gap" && slot.type !== "route"
        ).length;
        const dateLabel = day.date.toDate().toLocaleDateString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
        });
        const weather = weatherByDay.get(day.day) ?? day.weather;
        const dayOwner = owningDestinationForDate(
          tripDestinations,
          day.date.toDate()
        );
        const dayLocalityFallback = {
          cityName:
            dayOwner?.cityName?.trim() ||
            (!isGenericDayTitle(day.title) ? day.title.trim() : "") ||
            undefined,
          countryName: dayOwner?.countryName?.trim() || undefined,
        };

        return (
          <section
            key={`day-${day.day}`}
            className={cx(
              "rounded-2xl border bg-surface-elevated p-4 sm:p-5",
              isActiveDay
                ? "border-primary/40 ring-1 ring-primary/20"
                : "border-border"
            )}
          >
            <header>
              <button
                type="button"
                className="flex w-full items-start gap-3 text-left"
                onClick={() => {
                  if (dayIndex !== activeDayIndex) {
                    onSelectDay(dayIndex);
                    setCollapsed((prev) => ({
                      ...prev,
                      [day.day]: false,
                    }));
                    return;
                  }
                  setCollapsed((prev) => ({
                    ...prev,
                    [day.day]: !isCollapsed,
                  }));
                }}
                aria-expanded={!isCollapsed}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-text">
                      Day {day.day} · {dateLabel}
                    </p>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-text-secondary">
                      {placeCount} {placeCount === 1 ? "place" : "places"}
                      <ChevronDown
                        className={cx(
                          "h-4 w-4 transition-transform",
                          isCollapsed && "-rotate-90"
                        )}
                      />
                    </span>
                  </div>
                  <h3 className="mt-1 text-base font-semibold text-text">
                    {day.title}
                  </h3>
                  {day.description ? (
                    <p className="mt-0.5 text-sm text-text-secondary">
                      {day.description}
                    </p>
                  ) : null}
                  {hasCoords ? (
                    <DayWeatherBadge
                      weather={weather}
                      loading={weatherLoading && !weather}
                    />
                  ) : null}
                </div>
              </button>
            </header>

            {!isCollapsed ? (
              <>
                <ul className="mt-4 space-y-1">
                  {activePlaces.map((slot, slotIndex) => {
                    const displayOrder = slotIndex + 1;
                    const isDragging = draggingKey === slot.locationId;
                    const isSelected = selectedPlaceId === slot.locationId;
                    const isDragOver =
                      dragOverKey === slot.locationId &&
                      draggingKey !== slot.locationId;
                    const reorderProps = {
                      draggable: true,
                      onDragStart: (e: DragEvent<HTMLLIElement>) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", slot.locationId);
                        setDraggingKey(slot.locationId);
                      },
                      onDragEnd: () => {
                        setDraggingKey(null);
                        setDragOverKey(null);
                      },
                      onDragOver: (e: DragEvent<HTMLLIElement>) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dragOverKey !== slot.locationId) {
                          setDragOverKey(slot.locationId);
                        }
                      },
                      onDragLeave: () => {
                        if (dragOverKey === slot.locationId) {
                          setDragOverKey(null);
                        }
                      },
                      onDrop: (e: DragEvent<HTMLLIElement>) => {
                        e.preventDefault();
                        const fromKey =
                          e.dataTransfer.getData("text/plain") || draggingKey;
                        setDraggingKey(null);
                        setDragOverKey(null);
                        if (fromKey) {
                          void reorderDaySlots(
                            dayIndex,
                            fromKey,
                            slot.locationId
                          );
                        }
                      },
                    };
                    const reorderControls = (
                      <div className="mt-1.5 flex shrink-0 flex-col items-center gap-0.5">
                        <button
                          type="button"
                          aria-label="Move up"
                          disabled={slotIndex === 0}
                          onClick={() =>
                            void moveDaySlot(dayIndex, slot.locationId, -1)
                          }
                          className="rounded-md p-0.5 text-text-muted hover:bg-surface hover:text-text disabled:opacity-30"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <span
                          className="cursor-grab text-text-muted active:cursor-grabbing"
                          title="Drag to reorder"
                          aria-hidden
                        >
                          <GripVertical className="h-4 w-4" />
                        </span>
                        <button
                          type="button"
                          aria-label="Move down"
                          disabled={slotIndex >= activePlaces.length - 1}
                          onClick={() =>
                            void moveDaySlot(dayIndex, slot.locationId, 1)
                          }
                          className="rounded-md p-0.5 text-text-muted hover:bg-surface hover:text-text disabled:opacity-30"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                    const orderBadge = (
                      <span
                        className={cx(
                          "mt-3 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ring-1",
                          isSelected
                            ? "bg-primary text-white ring-primary"
                            : "bg-surface text-text-secondary ring-border"
                        )}
                      >
                        {displayOrder}
                      </span>
                    );
                    const rowClass = cx(
                      "flex items-start gap-2 rounded-xl px-1 py-2 transition-colors",
                      isDragging && "opacity-50",
                      isDragOver && "bg-primary-tint/50 ring-1 ring-primary/30",
                      isSelected &&
                        !isDragOver &&
                        "bg-primary-tint/40 ring-1 ring-primary/25"
                    );
                    const rowRef = (el: HTMLLIElement | null) => {
                      if (el) placeRowRefs.current.set(slot.locationId, el);
                      else placeRowRefs.current.delete(slot.locationId);
                    };

                    if (slot.type === "gap") {
                      const gapTitle =
                        slot.title?.trim() ||
                        (slot.cityName
                          ? `Time in ${slot.cityName}`
                          : "Free time");
                      const gapDuration =
                        slot.durationMinutes != null &&
                        Number.isFinite(slot.durationMinutes)
                          ? formatAvailableDuration(slot.durationMinutes)
                          : null;
                      return (
                        <li
                          key={slot.locationId}
                          ref={rowRef}
                          className={rowClass}
                          {...reorderProps}
                        >
                          {orderBadge}
                          <span className="mt-3 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary-tint text-primary">
                            <Sparkles className="h-3 w-3" aria-hidden />
                          </span>
                          <div className="min-w-0 flex-1 py-1.5">
                            <p className="text-sm font-semibold text-text">
                              {gapTitle}
                            </p>
                            {gapDuration ? (
                              <p className="mt-0.5 text-xs text-text-secondary">
                                {gapDuration} layover
                              </p>
                            ) : null}
                          </div>
                          {reorderControls}
                        </li>
                      );
                    }

                    if (slot.type === "route") {
                      const route =
                        (slot.routeId
                          ? routesById.get(slot.routeId)
                          : undefined) ??
                        (slot.locationId.startsWith("route:")
                          ? routesById.get(slot.locationId.slice(6))
                          : undefined);
                      const title =
                        slot.title?.trim() ||
                        (route
                          ? `${route.from.name} → ${route.to.name}`
                          : "Transfer");
                      const TransportIcon = route
                        ? ROUTE_TRANSPORT_ICON[route.transport]
                        : TrainFront;
                      const transportLabel = route
                        ? ROUTE_TRANSPORT_LABEL[route.transport]
                        : "Transfer";
                      const duration = route
                        ? formatRouteDuration(
                            route.durationMinutes,
                            route.durationApproximate ?? true
                          )
                        : slot.durationMinutes != null
                          ? formatAvailableDuration(slot.durationMinutes)
                          : null;
                      const depClock = route
                        ? formatRouteClock(
                            route.departure?.datetime,
                            route.departure?.timezone,
                            route.departure?.timeKnown
                          )
                        : null;
                      const arrClock = route
                        ? formatRouteClock(
                            route.arrival?.datetime,
                            route.arrival?.timezone,
                            route.arrival?.timeKnown
                          )
                        : null;
                      const routeTimeLabel =
                        depClock && arrClock
                          ? `${depClock} – ${arrClock}`
                          : depClock
                            ? `Dep ${depClock}`
                            : arrClock
                              ? `Arr ${arrClock}`
                              : null;
                      const routeNote = route?.note?.trim() || null;
                      const price =
                        route?.priceLabel?.trim() ||
                        (route?.priceAmount != null
                          ? route.priceAmount === 0
                            ? "Free"
                            : `${route.priceAmount}${
                                route.priceCurrency
                                  ? ` ${route.priceCurrency}`
                                  : ""
                              }`
                          : null);
                      const visited = slot.status === "visited";
                      return (
                        <li
                          key={slot.locationId}
                          ref={rowRef}
                          className={rowClass}
                          {...reorderProps}
                        >
                          {orderBadge}
                          <button
                            type="button"
                            aria-label={
                              visited ? "Mark planned" : "Mark visited"
                            }
                            onClick={() =>
                              onToggleStatus(
                                dayIndex,
                                slot.locationId,
                                visited ? "planned" : "visited"
                              )
                            }
                            className={cx(
                              "mt-3 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                              visited
                                ? "border-primary bg-primary text-white"
                                : "border-border bg-white hover:border-primary/40"
                            )}
                          >
                            {visited ? <Check className="h-3 w-3" /> : null}
                          </button>
                          <div
                            className="min-w-0 flex-1 cursor-pointer py-1.5 text-left"
                            onClick={() =>
                              onSelectPlace(slot.locationId, dayIndex)
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onSelectPlace(slot.locationId, dayIndex);
                              }
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-text">
                              <span className="truncate">{title}</span>
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-tint px-2 py-0.5 text-[10px] font-medium text-primary">
                                <TransportIcon
                                  className="h-3 w-3"
                                  aria-hidden
                                />
                                {transportLabel}
                              </span>
                            </p>
                            {routeTimeLabel ? (
                              <p className="mt-0.5 flex items-center gap-1 text-xs text-text-secondary">
                                <Clock className="h-3 w-3 shrink-0" />
                                <span>
                                  {routeTimeLabel}
                                  {duration ? ` · ${duration}` : ""}
                                </span>
                              </p>
                            ) : duration || routeNote ? (
                              <p className="mt-0.5 text-xs text-text-secondary">
                                {[duration, routeNote]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            ) : null}
                            {routeTimeLabel && routeNote ? (
                              <p className="mt-0.5 text-xs text-text-secondary">
                                {routeNote}
                              </p>
                            ) : null}
                            {(price || route?.link) && (
                              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                {price ? (
                                  <span className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-text">
                                    {price}
                                  </span>
                                ) : null}
                                {route?.link ? (
                                  <a
                                    href={route.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    Book / info
                                  </a>
                                ) : null}
                              </div>
                            )}
                          </div>
                          {reorderControls}
                        </li>
                      );
                    }

                    const place = byId.get(slot.locationId);
                    const visited = slot.status === "visited";
                    const displayTitle =
                      slot.title?.trim() ||
                      place?.title?.trim() ||
                      "Unknown place";
                    const displayDescription =
                      slot.description?.trim() ||
                      place?.description?.trim() ||
                      place?.ai?.why?.trim() ||
                      null;
                    const displayNote = place?.note?.trim() || null;
                    const distanceLabel =
                      userCoords && place
                        ? formatDistanceFrom(userCoords, {
                            lat: place.lat,
                            lon: place.lon,
                          })
                        : null;
                    const priceLabel = place?.price
                      ? formatPlacePrice(place.price)
                      : null;
                    const links =
                      place?.links?.filter((l) => l.url?.trim()) ?? [];
                    const locality = placeLocalityLabel(place, {
                      cityName:
                        slot.cityName?.trim() || dayLocalityFallback.cityName,
                      countryName: dayLocalityFallback.countryName,
                    });
                    const hasMeta = Boolean(priceLabel) || links.length > 0;
                    return (
                      <li
                        key={slot.locationId}
                        ref={rowRef}
                        className={rowClass}
                        {...reorderProps}
                      >
                        {orderBadge}
                        <button
                          type="button"
                          aria-label={
                            visited ? "Mark planned" : "Mark visited"
                          }
                          onClick={() =>
                            onToggleStatus(
                              dayIndex,
                              slot.locationId,
                              visited ? "planned" : "visited"
                            )
                          }
                          className={cx(
                            "mt-3 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                            visited
                              ? "border-primary bg-primary text-white"
                              : "border-border bg-white hover:border-primary/40"
                          )}
                        >
                          {visited ? <Check className="h-3 w-3" /> : null}
                        </button>

                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <button
                            type="button"
                            className="shrink-0 text-left"
                            onClick={() => {
                              onSelectPlace(slot.locationId, dayIndex);
                              if (place) onOpen(place);
                            }}
                          >
                            <PlaceThumb
                              place={place}
                              imageUrl={slot.imageUrl}
                              noImage={slot.noImage}
                            />
                          </button>
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              className="w-full min-w-0 text-left"
                              onClick={() => {
                                onSelectPlace(slot.locationId, dayIndex);
                                if (place) onOpen(place);
                              }}
                            >
                              <span className="flex min-w-0 flex-wrap items-center gap-2">
                                <span className="truncate text-sm font-semibold text-text">
                                  {displayTitle}
                                </span>
                                {place?.category ? (
                                  <span className="shrink-0 rounded-full bg-primary-tint px-2 py-0.5 text-[10px] font-medium text-primary">
                                    {PLACE_CATEGORY_LABELS[place.category] ??
                                      place.category}
                                  </span>
                                ) : null}
                              </span>
                              <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-text-secondary">
                                <MapPin className="h-3 w-3 shrink-0" />
                                <span className="truncate">
                                  {locality || "Unknown area"}
                                  {distanceLabel
                                    ? ` · ${distanceLabel}`
                                    : ""}
                                </span>
                              </span>
                            </button>
                            {displayDescription ? (
                              <p className="mt-1 text-xs text-text-secondary">
                                {displayDescription}
                              </p>
                            ) : null}
                            <PlaceVisitTimeEditor
                              from={slot.bestVisitTime?.from}
                              to={slot.bestVisitTime?.to}
                              durationMinutes={slot.durationMinutes}
                              onChange={(next) =>
                                updatePlaceVisitTime(
                                  dayIndex,
                                  slot.locationId,
                                  next
                                )
                              }
                            />
                            {displayNote ? (
                              <p className="mt-1 text-xs text-text">
                                <span className="font-medium">Note: </span>
                                {displayNote}
                              </p>
                            ) : null}
                            {hasMeta ? (
                              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                {priceLabel ? (
                                  <span className="inline-flex items-center rounded-full bg-surface-elevated px-2 py-0.5 text-[11px] font-medium text-text">
                                    {priceLabel}
                                  </span>
                                ) : null}
                                {links.map((link) => (
                                  <a
                                    key={link.url}
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    {link.label?.trim() ||
                                      (place?.category === "transport"
                                        ? "Buy tickets"
                                        : "Tickets / info")}
                                  </a>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {reorderControls}

                        <div className="mt-1.5">
                          <PlaceMenu
                            onOpen={() => place && onOpen(place)}
                            onRemove={() => onRemove(slot.locationId)}
                            mapsUrl={
                              place &&
                              Number.isFinite(place.lat) &&
                              Number.isFinite(place.lon)
                                ? `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lon}`
                                : null
                            }
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {placeCount === 0 &&
                !activePlaces.some((slot) => slot.type === "route") ? (
                  <p className="mt-4 rounded-xl bg-surface px-3 py-2.5 text-sm text-text-secondary">
                    No places on this day yet — add one or regenerate the plan.
                  </p>
                ) : null}

                <button
                  type="button"
                  onClick={() => onAddPlace(dayIndex)}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-surface px-3 py-3 text-sm font-medium text-text-secondary transition-colors hover:bg-divider hover:text-text"
                >
                  <Plus className="h-4 w-4" />
                  Add place to this day
                </button>
              </>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function PlaceVisitTimeEditor({
  from,
  to,
  durationMinutes,
  onChange,
}: {
  from?: string;
  to?: string;
  durationMinutes?: number;
  onChange: (next: { from: string; to: string } | null) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from ?? "");
  const [draftTo, setDraftTo] = useState(to ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) return;
    setDraftFrom(from ?? "");
    setDraftTo(to ?? "");
  }, [from, to, editing]);

  const hasWindow = Boolean(from?.trim() && to?.trim());
  const durationLabel =
    durationMinutes != null && Number.isFinite(durationMinutes)
      ? formatAvailableDuration(durationMinutes)
      : null;

  function openEditor(event: ReactMouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    const start = from?.trim() || "10:00";
    const end =
      to?.trim() ||
      (durationMinutes != null && Number.isFinite(durationMinutes)
        ? formatVisitClock(
            (parseVisitClock(start) ?? 10 * 60) + Math.max(30, durationMinutes)
          )
        : "12:00");
    setDraftFrom(start);
    setDraftTo(end);
    setEditing(true);
  }

  async function commit(nextFrom: string, nextTo: string) {
    const fromMins = parseVisitClock(nextFrom);
    const toMins = parseVisitClock(nextTo);
    if (fromMins == null || toMins == null || toMins <= fromMins) return;
    if (nextFrom === from && nextTo === to) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onChange({ from: nextFrom, to: nextTo });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function clearTime() {
    setSaving(true);
    try {
      await onChange(null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={openEditor}
        onMouseDown={(e) => e.stopPropagation()}
        className="mt-1 flex w-full items-center gap-1 rounded-lg text-left text-xs transition-colors hover:bg-surface"
      >
        <Clock
          className={cx(
            "h-3 w-3 shrink-0",
            hasWindow ? "text-primary" : "text-text-muted"
          )}
        />
        {hasWindow ? (
          <span className="font-medium text-text">
            {from} – {to}
            {durationLabel ? ` · ~${durationLabel}` : ""}
            <span className="ml-1.5 font-normal text-text-muted">Edit</span>
          </span>
        ) : durationLabel ? (
          <span className="text-text-secondary">
            ~{durationLabel} visit
            <span className="ml-1.5 text-text-muted">Set time</span>
          </span>
        ) : (
          <span className="text-text-muted">Set visit time</span>
        )}
      </button>
    );
  }

  const draftDuration = durationFromVisitWindow(draftFrom, draftTo);
  const canSave =
    parseVisitClock(draftFrom) != null &&
    parseVisitClock(draftTo) != null &&
    (parseVisitClock(draftTo) ?? 0) > (parseVisitClock(draftFrom) ?? 0);

  return (
    <div
      className="mt-2 space-y-2 rounded-xl border border-border bg-surface px-2.5 py-2"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDragStart={(e) => e.preventDefault()}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0 space-y-1">
          <span className="block text-[11px] font-medium text-text-muted">
            From
          </span>
          <TimePicker
            value={draftFrom}
            max={draftTo || undefined}
            stepMinutes={5}
            placeholder="Start"
            onChange={(value) => {
              setDraftFrom(value);
              const toMins = parseVisitClock(draftTo);
              const fromMins = parseVisitClock(value);
              if (
                fromMins != null &&
                toMins != null &&
                toMins <= fromMins
              ) {
                setDraftTo(formatVisitClock(fromMins + 30));
              }
            }}
          />
        </label>
        <label className="min-w-0 space-y-1">
          <span className="block text-[11px] font-medium text-text-muted">
            To
          </span>
          <TimePicker
            value={draftTo}
            min={draftFrom || undefined}
            stepMinutes={5}
            placeholder="End"
            onChange={(value) => setDraftTo(value)}
          />
        </label>
      </div>
      {draftDuration != null ? (
        <p className="text-[11px] text-text-secondary">
          ~{formatAvailableDuration(draftDuration)} visit
        </p>
      ) : draftFrom && draftTo ? (
        <p className="text-[11px] text-error">End time must be after start</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={!canSave || saving}
          onClick={() => void commit(draftFrom, draftTo)}
          className="h-9 !bg-primary hover:!bg-primary-hover !border-primary !text-white"
        >
          {saving ? "Saving…" : "Save time"}
        </Button>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setDraftFrom(from ?? "");
            setDraftTo(to ?? "");
            setEditing(false);
          }}
          className="h-9 rounded-xl px-3 text-sm font-medium text-text-secondary hover:bg-divider hover:text-text"
        >
          Cancel
        </button>
        {hasWindow ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => void clearTime()}
            className="ml-auto h-9 rounded-xl px-3 text-sm font-medium text-error hover:bg-error-background"
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DayWeatherBadge({
  weather,
  loading,
}: {
  weather?: ItineraryDayWeather;
  loading: boolean;
}) {
  if (loading) {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        Loading weather…
      </p>
    );
  }

  if (!weather?.available) {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-text-muted">
        <CloudSun className="h-3.5 w-3.5" />
        Forecast not available yet
      </p>
    );
  }

  const tempUnit = weather.units === "imperial" ? "°F" : "°C";
  const temp =
    weather.temp != null
      ? `${Math.round(weather.temp)}${tempUnit}`
      : weather.tempMin != null && weather.tempMax != null
        ? `${Math.round(weather.tempMin)}° / ${Math.round(weather.tempMax)}°`
        : null;

  return (
    <p className="mt-2 inline-flex max-w-full items-center gap-1.5 text-xs text-text-secondary">
      {weather.icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={weatherIconUrl(weather.icon)}
          alt=""
          className="h-6 w-6 -ml-0.5 shrink-0"
        />
      ) : (
        <CloudSun className="h-3.5 w-3.5 shrink-0 text-sky-600" />
      )}
      {temp ? (
        <span className="font-medium tabular-nums text-text">{temp}</span>
      ) : null}
      {weather.tempMin != null &&
      weather.tempMax != null &&
      weather.temp != null ? (
        <span className="tabular-nums text-text-muted">
          {Math.round(weather.tempMin)}° / {Math.round(weather.tempMax)}°
        </span>
      ) : null}
      {weather.description ? (
        <span className="min-w-0 truncate capitalize">{weather.description}</span>
      ) : null}
      {weather.precipitationChance != null &&
      weather.precipitationChance > 0 ? (
        <span className="shrink-0 text-text-muted">
          · {weather.precipitationChance}% rain
        </span>
      ) : null}
    </p>
  );
}

/** First usable photo for a saved place — prefer user uploads over external. */
function placeCoverImageUrl(place?: SavedLocation | null): string | null {
  const images = place?.images;
  if (Array.isArray(images)) {
    const user = images.find(
      (img) => img.source === "user" && img.url?.trim()
    )?.url?.trim();
    if (user) return user;
    const any = images.find((img) => img.url?.trim())?.url?.trim();
    if (any) return any;
  }
  if (place?.source?.type === "image") {
    const fromSource = place.source.url?.trim();
    if (fromSource) return fromSource;
  }
  return null;
}

function placeThumbCandidates(
  place?: SavedLocation | null,
  imageUrl?: string | null
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (url?: string | null) => {
    const next = url?.trim();
    if (!next || seen.has(next)) return;
    seen.add(next);
    out.push(next);
  };

  push(imageUrl);
  push(placeCoverImageUrl(place));
  if (Array.isArray(place?.images)) {
    for (const img of place.images) push(img.url);
  }
  if (place?.source?.type === "image") push(place.source.url);
  return out;
}

function PlaceThumb({
  place,
  imageUrl,
  noImage,
  className,
}: {
  place?: SavedLocation | null;
  /** Prefer itinerary/plan image so thumbs match PlanTripSheet. */
  imageUrl?: string | null;
  /** Lookup already failed — keep placeholder, do not imply loading. */
  noImage?: boolean;
  className?: string;
}) {
  const candidates = placeThumbCandidates(place, imageUrl);
  const [failedSrcs, setFailedSrcs] = useState<string[]>([]);
  const image =
    candidates.find((url) => !failedSrcs.includes(url)) ?? null;

  return (
    <div
      className={cx(
        "h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-divider",
        className
      )}
      data-no-image={!image && noImage ? "true" : undefined}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={image}
          src={image}
          alt=""
          className="h-full w-full object-cover"
          onError={() => {
            setFailedSrcs((prev) =>
              prev.includes(image) ? prev : [...prev, image]
            );
          }}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-text-muted">
          <MapPin className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

function PlaceMenu({
  onOpen,
  onRemove,
  mapsUrl = null,
}: {
  onOpen: () => void;
  onRemove: () => void;
  /** Google Maps deep link when the place has usable coordinates. */
  mapsUrl?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: globalThis.MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Place options"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="rounded-lg p-1.5 text-text-muted hover:bg-surface hover:text-text"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open ? (
        <div className="absolute right-0 z-10 mt-1 min-w-[9.5rem] rounded-xl border border-border bg-surface-elevated py-1 shadow-lg">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-surface"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onOpen();
            }}
          >
            View details
          </button>
          {mapsUrl ? (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-surface"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
            >
              <MapIcon className="h-3.5 w-3.5" />
              Show on map
            </a>
          ) : null}
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-error hover:bg-error-background"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onRemove();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>
      ) : null}
    </div>
  );
}
