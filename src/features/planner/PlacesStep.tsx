"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, ConfirmModal } from "@/components/ui";
import {
  Check,
  ChevronDown,
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
  Sparkles,
  Trash2,
  TrainFront,
} from "lucide-react";
import { TravelMap } from "@/features/map/TravelMap";
import { PlaceDetailSheet } from "@/features/places/PlaceDetailSheet";
import { Sheet } from "@/components/ui/Sheet";
import type { SavedLocation } from "@/hooks/useLocations";
import type {
  ItineraryDay,
  ItineraryDayWeather,
  ItineraryPlace,
  TripItinerary,
  TripPlannerDoc,
  TripRoute,
} from "@/types/trip-planner";
import type { LocationPrice, LocationStatus } from "@/types/location";
import { getBrowserCoords, type MapMarkerInput } from "@/lib/maps";
import { PLACE_CATEGORY_LABELS } from "@/types/trip-plan";
import { planTripRegenerateCost } from "@/types/credits";
import { formatAvailableDuration } from "./timelineHelpers";
import { cx } from "@/lib/utils";
import { distanceKm } from "./clusterPlaces";
import {
  matchLocationsToDestinations,
  sortLocationsForDestination,
} from "./matchTripPlaces";
import { PlanTripSheet } from "./PlanTripSheet";
import { TripSetupChecklist } from "./TripSetupChecklist";
import { listTripDestinations, toIsoDate } from "./tripDestinations";
import { listTripAccommodations } from "./essentialsHelpers";
import { isWeatherFresh, weatherForTrip } from "./tripWeather";
import { subscribeTripRoutes } from "@/services/trip-routes";
import {
  formatRouteDuration,
} from "./routeHelpers";
import {
  ROUTE_TRANSPORT_ICON,
  ROUTE_TRANSPORT_LABEL,
} from "./RouteLegCard";

type Coords = { lat: number; lon: number };

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

type PlacesView = "map" | "itinerary";

interface PlacesStepProps {
  trip: TripPlannerDoc;
  locations: SavedLocation[];
  userId: string;
  aiCreditsBalance: number;
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
}

export function PlacesStep({
  trip,
  locations,
  userId,
  aiCreditsBalance,
  language,
  onUpdateSavedPlaces,
  onUpdateItinerary,
  onSavePlan,
  onMarkPlaceStatus,
  onSavePlaceNote,
}: PlacesStepProps) {
  const [view, setView] = useState<PlacesView>("itinerary");
  const [addOpen, setAddOpen] = useState(false);
  const [addDayIndex, setAddDayIndex] = useState<number | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planIntent, setPlanIntent] = useState<"generate" | "regenerate">(
    "generate"
  );
  const [planSetupConfirmOpen, setPlanSetupConfirmOpen] = useState(false);
  const [pendingPlanIntent, setPendingPlanIntent] = useState<
    "generate" | "regenerate"
  >("generate");
  const [detail, setDetail] = useState<SavedLocation | null>(null);
  const recreateCost = planTripRegenerateCost(trip.createMode);

  const tripPlaces = useMemo(() => {
    const ids = new Set(trip.savedPlaceIds);
    for (const day of trip.itinerary.days) {
      for (const place of day.places) {
        if (place.type === "gap" || place.type === "route") continue;
        ids.add(place.locationId);
      }
    }
    return locations.filter(
      (l) => ids.has(l.id) && l.status !== "cancelled"
    );
  }, [locations, trip.savedPlaceIds, trip.itinerary.days]);

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

  const markers: MapMarkerInput[] = useMemo(() => {
    const placeMarkers: MapMarkerInput[] = tripPlaces.map((place) => ({
      id: place.id,
      lat: place.lat,
      lon: place.lon,
      title: place.title,
      status: place.status,
      kind: "place" as const,
      googlePlaceId: place.city.googlePlaceId,
    }));

    const stayMarkers: MapMarkerInput[] = listTripAccommodations(trip)
      .filter(
        (stay) =>
          typeof stay.lat === "number" &&
          Number.isFinite(stay.lat) &&
          typeof stay.lon === "number" &&
          Number.isFinite(stay.lon)
      )
      .map((stay, index) => ({
        id: `__stay__${stay.id ?? index}`,
        lat: stay.lat as number,
        lon: stay.lon as number,
        title: stay.name?.trim() || stay.address?.trim() || "Accommodation",
        kind: "stay" as const,
      }));

    const seenArrival = new Set<string>();
    const airportMarkers: MapMarkerInput[] = [];

    const pushArrival = (
      arrival: {
        code?: string | null;
        name?: string;
        cityName?: string;
        lat?: number;
        lon?: number;
      },
      idSuffix: string
    ) => {
      if (
        typeof arrival.lat !== "number" ||
        !Number.isFinite(arrival.lat) ||
        typeof arrival.lon !== "number" ||
        !Number.isFinite(arrival.lon)
      ) {
        return;
      }
      const code = arrival.code?.trim().toUpperCase() || "";
      const dedupeKey =
        code || `${arrival.lat.toFixed(4)},${arrival.lon.toFixed(4)}`;
      if (seenArrival.has(dedupeKey)) return;
      seenArrival.add(dedupeKey);

      const label = [code, arrival.name?.trim() || arrival.cityName?.trim()]
        .filter(Boolean)
        .join(" · ");
      airportMarkers.push({
        id: `__airport__${idSuffix}`,
        lat: arrival.lat,
        lon: arrival.lon,
        title: label || "Destination airport",
        kind: "airport" as const,
      });
    };

    const destinationAirports = listTripDestinations(trip).flatMap(
      (dest, destIndex) =>
        (dest.transport?.airports ?? []).map((airport, airportIndex) => ({
          code: airport.iataCode,
          name: airport.name,
          cityName: dest.cityName,
          lat: airport.location?.lat,
          lon: airport.location?.lon,
          id: `${dest.cityId || destIndex}-${airport.placeId || airportIndex}`,
        }))
    );

    for (const airport of destinationAirports) {
      pushArrival(airport, airport.id);
    }

    const combined = [...placeMarkers, ...stayMarkers, ...airportMarkers];
    if (combined.length > 0) return combined;

    return listTripDestinations(trip)
      .filter(
        (dest) =>
          typeof dest.lat === "number" &&
          Number.isFinite(dest.lat) &&
          typeof dest.lon === "number" &&
          Number.isFinite(dest.lon)
      )
      .map((dest, index) => ({
        id: `__destination__${dest.cityId || dest.cityName || index}`,
        lat: dest.lat as number,
        lon: dest.lon as number,
        title: dest.cityName,
        kind: "city" as const,
      }));
  }, [tripPlaces, trip, trip.destinations]);

  const hasStayPins = useMemo(() => {
    return listTripAccommodations(trip).some(
      (stay) =>
        typeof stay.lat === "number" &&
        Number.isFinite(stay.lat) &&
        typeof stay.lon === "number" &&
        Number.isFinite(stay.lon)
    );
  }, [trip.destinations, trip]);

  const hasAirportPins = useMemo(() => {
    return listTripDestinations(trip).some((dest) =>
      (dest.transport?.airports ?? []).some(
        (airport) =>
          typeof airport.location?.lat === "number" &&
          Number.isFinite(airport.location.lat) &&
          typeof airport.location?.lon === "number" &&
          Number.isFinite(airport.location.lon)
      )
    );
  }, [trip]);
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

  async function toggleItineraryPlace(
    dayIndex: number,
    locationId: string,
    next: LocationStatus
  ) {
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
    await onMarkPlaceStatus(locationId, next);
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
  }

  function openAddSheet(dayIndex?: number) {
    setAddDayIndex(dayIndex ?? null);
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

      <div className="grid grid-cols-2 rounded-xl bg-surface p-1">
        <ViewTab
          active={view === "itinerary"}
          onClick={() => setView("itinerary")}
          icon={<ListOrdered className="h-4 w-4" />}
          label="Itinerary"
        />
        <ViewTab
          active={view === "map"}
          onClick={() => setView("map")}
          icon={<MapIcon className="h-4 w-4" />}
          label="Map"
        />
      </div>

      {view === "map" ? (
        <div className="relative h-[min(70vh,520px)] min-h-[320px] overflow-hidden rounded-2xl border border-border bg-surface">
          <TravelMap
            className="absolute inset-0 h-full w-full"
            markers={markers}
            fitToMarkers
            centerOnCurrentLocation={false}
            onMarkerSelect={(id) => {
              if (
                id.startsWith("__destination__") ||
                id.startsWith("__stay__") ||
                id.startsWith("__airport__")
              )
                return;
              const place = byId.get(id) ?? null;
              setDetail(place);
            }}
          />
          {tripPlaces.length === 0 && !hasStayPins && !hasAirportPins ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/55 to-transparent px-4 pb-4 pt-10">
              <div className="pointer-events-auto rounded-xl bg-surface-elevated/95 px-3 py-3 shadow-sm ring-1 ring-border backdrop-blur-sm">
                <p className="text-sm font-medium text-text">No places yet</p>
                <p className="mt-0.5 text-xs text-text-secondary">
                  Add saved locations to see them on the map.
                </p>
                <Button
                  icon={Plus}
                  variant="secondary"
                  onClick={() => openAddSheet()}
                  className="mt-2 h-11 !border-border !bg-surface !text-xs !text-text"
                >
                  Add places
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <ItineraryList
          trip={trip}
          byId={byId}
          routesById={routesById}
          onToggleStatus={(dayIndex, locationId, status) =>
            void toggleItineraryPlace(dayIndex, locationId, status)
          }
          onOpen={(place) => setDetail(place)}
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
        }}
        title={
          addDayIndex !== null
            ? `Add place to day ${addDayIndex + 1}`
            : "Add places to trip"
        }
        size="lg"
      >
        <div className="space-y-2">
          {availableToAdd.length === 0 ? (
            <p className="text-sm text-text-secondary">
              No saved places in{" "}
              {listTripDestinations(trip)
                .map((dest) => dest.cityName)
                .filter(Boolean)
                .join(", ") ||
                listTripDestinations(trip)[0]?.countryName ||
                "your destinations"}{" "}
              left to add. Save places from those destinations on your map
              first.
            </p>
          ) : (
            availableToAdd.map((place) => (
              <button
                key={place.id}
                type="button"
                onClick={() => {
                  void addPlaceToTrip(place.id);
                }}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-border px-3 py-3 text-left hover:border-primary/30"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <PlaceThumb place={place} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-text">
                      {place.title}
                    </span>
                    <span className="text-xs text-text-secondary">
                      {place.city.name}, {place.country.name}
                    </span>
                  </span>
                </span>
                <Plus className="h-4 w-4 shrink-0 text-primary" />
              </button>
            ))
          )}        </div>
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
          setView("itinerary");
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

      <PlaceDetailSheet
        place={detail}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        onUpdateStatus={async (status) => {
          if (!detail) return;
          await onMarkPlaceStatus(detail.id, status);
          setDetail({ ...detail, status });
        }}
        onSaveNote={async (note) => {
          if (!detail) return;
          await onSavePlaceNote(detail.id, note);
          setDetail({ ...detail, note });
        }}
      />

      {view === "itinerary" ? (
        <TripSetupChecklist trip={trip} userId={userId} />
      ) : null}
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

  return (
    <div className="space-y-4">
      {trip.itinerary.days.map((day, dayIndex) => {
        const isCollapsed = collapsed[day.day] ?? false;
        const activePlaces = day.places.filter((slot) =>
          isActiveItinerarySlot(slot, byId)
        );
        const placeCount = activePlaces.filter(
          (slot) => slot.type !== "gap" && slot.type !== "route"
        ).length;
        const dateLabel = day.date.toDate().toLocaleDateString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
        });
        const weather = weatherByDay.get(day.day) ?? day.weather;

        return (
          <section
            key={`day-${day.day}`}
            className="rounded-2xl border border-border bg-surface-elevated p-4 sm:p-5"
          >
            <header>
              <button
                type="button"
                className="flex w-full items-start gap-3 text-left"
                onClick={() =>
                  setCollapsed((prev) => ({
                    ...prev,
                    [day.day]: !isCollapsed,
                  }))
                }
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
                  {activePlaces.map((slot) => {
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
                          className="flex items-start gap-3 rounded-xl px-1 py-2"
                        >
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
                      return (
                        <li
                          key={slot.locationId}
                          className="flex items-start gap-3 rounded-xl px-1 py-2"
                        >
                          <span className="mt-3 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary-tint text-primary">
                            <TransportIcon className="h-3 w-3" aria-hidden />
                          </span>
                          <div className="min-w-0 flex-1 py-1.5">
                            <p className="text-sm font-semibold text-text">
                              {title}
                            </p>
                            <p className="mt-0.5 text-xs text-text-secondary">
                              {[transportLabel, duration]
                                .filter(Boolean)
                                .join(" · ")}
                              {routeNote
                                ? `${duration || transportLabel ? " · " : ""}${routeNote}`
                                : ""}
                            </p>
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
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    Book / info
                                  </a>
                                ) : null}
                              </div>
                            )}
                          </div>
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
                    const locality = [
                      place?.city.name,
                      place?.country.name,
                    ]
                      .filter(Boolean)
                      .join(", ");
                    const hasMeta = Boolean(priceLabel) || links.length > 0;
                    return (
                      <li
                        key={slot.locationId}
                        className="flex items-start gap-3 rounded-xl px-1 py-2"
                      >
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
                            onClick={() => place && onOpen(place)}
                          >
                            <PlaceThumb
                              place={place}
                              imageUrl={slot.imageUrl}
                            />
                          </button>
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              className="w-full min-w-0 text-left"
                              onClick={() => place && onOpen(place)}
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

                        <span
                          className="mt-3 hidden text-text-muted sm:inline-flex"
                          aria-hidden
                        >
                          <GripVertical className="h-4 w-4" />
                        </span>

                        <div className="mt-1.5">
                          <PlaceMenu
                            onOpen={() => place && onOpen(place)}
                            onRemove={() => onRemove(slot.locationId)}
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

function PlaceThumb({
  place,
  imageUrl,
}: {
  place?: SavedLocation | null;
  /** Prefer itinerary/plan image so thumbs match PlanTripSheet. */
  imageUrl?: string | null;
}) {
  const image =
    imageUrl?.trim() ||
    place?.images[0]?.url?.trim() ||
    null;
  return (
    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-divider">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="h-full w-full object-cover" />
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
}: {
  onOpen: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent) {
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
