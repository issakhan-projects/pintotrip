"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Bus,
  CalendarDays,
  Car,
  Clock,
  FileText,
  Footprints,
  ImageIcon,
  Paperclip,
  Plane,
  Ship,
  Train,
  TrainFront,
  ArrowLeftRight,
  ArrowRight,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button, SearchableSelect, TextInput } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { cx } from "@/lib/utils";
import { IMAGE_FILE_ACCEPT } from "@/lib/images";
import {
  deleteStorageObject,
  uploadRouteAttachment,
} from "@/services/storage";
import { allocateTripRouteId } from "@/services/trip-routes";
import type {
  TripAirport,
  TripPlannerDoc,
  TripRoute,
  TripRouteAttachment,
  TripRouteTransport,
  TripTransportLocation,
} from "@/types/trip-planner";
import {
  EssentialsField,
  ESSENTIALS_FORM_STACK,
  ESSENTIALS_NOTES_CLASS,
  ESSENTIALS_SHEET_CLASS,
} from "./essentialsFormUi";
import { AIRLINE_OPTIONS } from "./airlines";
import {
  APPROX_DURATION_PRESETS,
  addMinutesToDatetimeLocal,
  airportToRoutePoint,
  airportsForRouteCity,
  cityPointFromOption,
  durationMinutesBetween,
  formatRouteDuration,
  isExactScheduleTransport,
  listRouteCities,
  localDatetimeInZoneToOffsetIso,
  offsetIsoToDatetimeLocal,
  stationToRoutePoint,
  toAirportSelectOptions,
  trainStationsForRouteCity,
  tripDatetimeLocalBounds,
  type RouteCityOption,
} from "./routeHelpers";
import { resolveTimezoneFromCoords } from "@/lib/maps";

const FerryIcon = Ship;
const MAX_ROUTE_ATTACHMENTS = 5;
const ROUTE_FILE_ACCEPT = `${IMAGE_FILE_ACCEPT},application/pdf,.pdf`;

function browserTimezone(): string {
  try {
    return (
      Intl.DateTimeFormat().resolvedOptions().timeZone?.trim() || "UTC"
    );
  } catch {
    return "UTC";
  }
}

/**
 * Prefer stored city timezone; else resolve from city / hub coordinates.
 * Always returns an IANA id so routes can persist timezone.
 */
async function resolveRouteCityTimezone(
  city: RouteCityOption,
  hubLocation?: { lat: number; lon: number } | null
): Promise<string> {
  const existing = city.timezone?.trim();
  if (existing) return existing;

  const candidates: Array<{ lat: number; lon: number }> = [];
  if (typeof city.lat === "number" && typeof city.lon === "number") {
    candidates.push({ lat: city.lat, lon: city.lon });
  }
  if (
    hubLocation &&
    Number.isFinite(hubLocation.lat) &&
    Number.isFinite(hubLocation.lon)
  ) {
    candidates.push(hubLocation);
  }

  for (const coords of candidates) {
    try {
      const resolved = await resolveTimezoneFromCoords(coords.lat, coords.lon);
      if (resolved?.trim()) return resolved.trim();
    } catch {
      // Try next candidate / fallback.
    }
  }

  return browserTimezone();
}

function formatDatetimeLocalDisplay(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return trimmed;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5])
  );
  if (Number.isNaN(date.getTime())) return trimmed;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function parseDatetimeParts(value: string): { date: string; time: string } {
  const match = value
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
  if (!match) return { date: "", time: "" };
  return { date: match[1]!, time: match[2] ?? "" };
}

function combineDatetimeParts(date: string, time: string): string {
  const d = date.trim();
  if (!d) return "";
  return `${d}T${time.trim() || "09:00"}`;
}

function timeBoundsForDate(
  date: string,
  min?: string,
  max?: string
): { min?: string; max?: string } {
  if (!date) return {};
  const bounds: { min?: string; max?: string } = {};
  if (min) {
    const parts = parseDatetimeParts(min);
    if (parts.date === date && parts.time) bounds.min = parts.time;
  }
  if (max) {
    const parts = parseDatetimeParts(max);
    if (parts.date === date && parts.time) bounds.max = parts.time;
  }
  return bounds;
}

const DATETIME_INPUT_CLASS = cx(
  "block w-full min-h-11 rounded-xl border border-border bg-white",
  "py-2.5 text-sm text-text outline-none transition-colors",
  "focus:border-primary focus:ring-2 focus:ring-primary/20",
  "[color-scheme:light]"
);

const TRANSPORT_UI: Array<{
  id: TripRouteTransport;
  label: string;
  Icon: LucideIcon;
}> = [
  { id: "flight", label: "Flight", Icon: Plane },
  { id: "train", label: "Train", Icon: TrainFront },
  { id: "bus", label: "Bus", Icon: Bus },
  { id: "metro", label: "Metro", Icon: Train },
  { id: "taxi", label: "Taxi", Icon: Car },
  { id: "airport_transfer", label: "Transfer", Icon: Car },
  { id: "car", label: "Car", Icon: Car },
  { id: "ferry", label: "Ferry", Icon: FerryIcon },
  { id: "other", label: "Other", Icon: Footprints },
];

function RouteDatetimeField({
  id,
  label,
  value,
  onChange,
  min,
  max,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
}) {
  const { date, time } = parseDatetimeParts(value);
  const minDate = min ? parseDatetimeParts(min).date : undefined;
  const maxDate = max ? parseDatetimeParts(max).date : undefined;
  const timeBounds = timeBoundsForDate(date, min, max);
  const dateId = `${id}-date`;
  const timeId = `${id}-time`;

  function commit(nextDate: string, nextTime: string) {
    onChange(combineDatetimeParts(nextDate, nextTime));
  }

  return (
    <EssentialsField label={label}>
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <label htmlFor={dateId} className="sr-only">
            Date
          </label>
          <div className="relative">
            <CalendarDays
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
              aria-hidden
            />
            <input
              id={dateId}
              type="date"
              value={date}
              min={minDate || undefined}
              max={maxDate || undefined}
              onChange={(event) =>
                commit(event.target.value, time || "09:00")
              }
              className={cx(DATETIME_INPUT_CLASS, "cursor-pointer pl-9 pr-3")}
            />
          </div>
        </div>
        <div className="min-w-0">
          <label htmlFor={timeId} className="sr-only">
            Time
          </label>
          <div className="relative">
            <Clock
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
              aria-hidden
            />
            <input
              id={timeId}
              type="time"
              value={time}
              min={timeBounds.min}
              max={timeBounds.max}
              disabled={!date}
              onChange={(event) => commit(date, event.target.value)}
              className={cx(
                DATETIME_INPUT_CLASS,
                "pl-9 pr-3",
                date ? "cursor-pointer" : "cursor-not-allowed opacity-60"
              )}
            />
          </div>
        </div>
      </div>
    </EssentialsField>
  );
}

function findAirport(airports: TripAirport[], key: string) {
  if (!key) return undefined;
  const normalized = key.trim().toUpperCase();
  return airports.find(
    (a) =>
      a.placeId === key ||
      a.iataCode?.trim().toUpperCase() === normalized
  );
}

function findStation(stations: TripTransportLocation[], key: string) {
  if (!key) return undefined;
  return stations.find((s) => s.placeId === key);
}

export type RouteSheetLegPayload = {
  transport: TripRouteTransport;
  from: TripRoute["from"];
  to: TripRoute["to"];
  departure?: TripRoute["departure"];
  arrival?: TripRoute["arrival"];
  durationMinutes?: number;
  durationApproximate?: boolean;
  note?: string;
  /** Flight only — airline name. */
  airline?: string;
  /** Flight only — e.g. "TK 123". */
  flightNumber?: string;
  status: TripRoute["status"];
  attachments?: TripRouteAttachment[];
  /** Pre-allocated Firestore id (needed when files were uploaded before create). */
  routeId?: string;
};

export type RouteSheetSavePayload = RouteSheetLegPayload & {
  /** Second leg when user chose Return (go + back). */
  returnLeg?: RouteSheetLegPayload;
};

type ExactStep =
  | "departure"
  | "arrival"
  | "return_departure"
  | "return_arrival";

type TripKind = "one_way" | "return";

export function RouteSheet({
  open,
  onClose,
  trip,
  userId,
  editing,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  trip: TripPlannerDoc;
  userId: string;
  editing: TripRoute | null;
  onSave: (payload: RouteSheetSavePayload) => Promise<void>;
}) {
  const cities = useMemo(() => listRouteCities(trip), [trip]);
  const [transport, setTransport] = useState<TripRouteTransport>("flight");
  const [fromKey, setFromKey] = useState("");
  const [toKey, setToKey] = useState("");
  const [fromHubKey, setFromHubKey] = useState("");
  const [toHubKey, setToHubKey] = useState("");
  const [departureLocal, setDepartureLocal] = useState("");
  const [arrivalLocal, setArrivalLocal] = useState("");
  const [approxMinutes, setApproxMinutes] = useState(60);
  const [note, setNote] = useState("");
  const [airline, setAirline] = useState("");
  const [flightNumber, setFlightNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState<TripRouteAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  /** Flight/train: one way or return — required before continue. */
  const [tripKind, setTripKind] = useState<TripKind | null>(null);
  /** Flight/train wizard step. */
  const [exactStep, setExactStep] = useState<ExactStep>("departure");
  const [returnDepartureLocal, setReturnDepartureLocal] = useState("");
  const [returnArrivalLocal, setReturnArrivalLocal] = useState("");
  const [returnFromHubKey, setReturnFromHubKey] = useState("");
  const [returnToHubKey, setReturnToHubKey] = useState("");
  const [returnAirline, setReturnAirline] = useState("");
  const [returnFlightNumber, setReturnFlightNumber] = useState("");
  const [returnNote, setReturnNote] = useState("");
  const [returnAttachments, setReturnAttachments] = useState<
    TripRouteAttachment[]
  >([]);
  const routeDocIdRef = useRef<string>("");
  const returnRouteDocIdRef = useRef<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const departureId = useId();
  const arrivalId = useId();
  const returnDepartureId = useId();
  const returnArrivalId = useId();
  const noteId = useId();
  const returnNoteId = useId();
  const durationId = useId();
  const flightNumberId = useId();
  const returnFlightNumberId = useId();

  const airlineOptions = useMemo(() => {
    const trimmed = airline.trim();
    if (trimmed && !AIRLINE_OPTIONS.some((o) => o.value === trimmed)) {
      return [{ value: trimmed, label: trimmed }, ...AIRLINE_OPTIONS];
    }
    return AIRLINE_OPTIONS;
  }, [airline]);

  const returnAirlineOptions = useMemo(() => {
    const trimmed = returnAirline.trim();
    if (trimmed && !AIRLINE_OPTIONS.some((o) => o.value === trimmed)) {
      return [{ value: trimmed, label: trimmed }, ...AIRLINE_OPTIONS];
    }
    return AIRLINE_OPTIONS;
  }, [returnAirline]);

  const exact = isExactScheduleTransport(transport);
  const isReturn = exact && tripKind === "return";
  const showOutboundDeparture = !exact || exactStep === "departure";
  const showOutboundArrival = !exact || exactStep === "arrival";
  const showReturnDeparture = isReturn && exactStep === "return_departure";
  const showReturnArrival = isReturn && exactStep === "return_arrival";
  const onReturnSteps = showReturnDeparture || showReturnArrival;
  const fromCity = cities.find((c) => c.key === fromKey);
  const toCity = cities.find((c) => c.key === toKey);
  const tripBounds = useMemo(() => tripDatetimeLocalBounds(trip), [trip]);
  const departureMin = tripBounds?.min;
  const departureMax = tripBounds?.max;
  const arrivalMinExclusive = departureLocal
    ? addMinutesToDatetimeLocal(departureLocal, 1)
    : undefined;
  const arrivalMin = (() => {
    const candidates = [tripBounds?.min, arrivalMinExclusive].filter(
      (v): v is string => Boolean(v)
    );
    if (candidates.length === 0) return undefined;
    return candidates.reduce((a, b) => (a >= b ? a : b));
  })();
  const arrivalMax = tripBounds?.max;
  const returnDepartureMinExclusive = arrivalLocal
    ? addMinutesToDatetimeLocal(arrivalLocal, 1)
    : undefined;
  const returnDepartureMin = (() => {
    const candidates = [tripBounds?.min, returnDepartureMinExclusive].filter(
      (v): v is string => Boolean(v)
    );
    if (candidates.length === 0) return undefined;
    return candidates.reduce((a, b) => (a >= b ? a : b));
  })();
  const returnArrivalMinExclusive = returnDepartureLocal
    ? addMinutesToDatetimeLocal(returnDepartureLocal, 1)
    : undefined;
  const returnArrivalMin = (() => {
    const candidates = [tripBounds?.min, returnArrivalMinExclusive].filter(
      (v): v is string => Boolean(v)
    );
    if (candidates.length === 0) return undefined;
    return candidates.reduce((a, b) => (a >= b ? a : b));
  })();
  const returnArrivalMax = tripBounds?.max;

  function clampToTripBounds(value: string): string {
    if (!value || !tripBounds) return value;
    if (value < tripBounds.min) return tripBounds.min;
    if (value > tripBounds.max) return tripBounds.max;
    return value;
  }

  /** Always from `trip.from` / `destinations[].transport.airports`. */
  const fromAirports = useMemo(
    () => airportsForRouteCity(trip, fromCity),
    [trip, fromCity]
  );
  const toAirports = useMemo(
    () => airportsForRouteCity(trip, toCity),
    [trip, toCity]
  );
  const fromStations = useMemo(
    () => trainStationsForRouteCity(trip, fromCity),
    [trip, fromCity]
  );
  const toStations = useMemo(
    () => trainStationsForRouteCity(trip, toCity),
    [trip, toCity]
  );

  const cityOptions = useMemo(
    () =>
      cities.map((c) => ({
        value: c.key,
        label: c.cityName,
        description: c.countryName,
      })),
    [cities]
  );

  const fromAirportOptions = useMemo(
    () => toAirportSelectOptions(fromAirports),
    [fromAirports]
  );

  const toAirportOptions = useMemo(
    () => toAirportSelectOptions(toAirports),
    [toAirports]
  );

  const fromStationOptions = useMemo(
    () =>
      fromStations.map((s) => ({
        value: s.placeId,
        label: s.name,
        description: s.address,
      })),
    [fromStations]
  );

  const toStationOptions = useMemo(
    () =>
      toStations.map((s) => ({
        value: s.placeId,
        label: s.name,
        description: s.address,
      })),
    [toStations]
  );

  useEffect(() => {
    if (!open) return;
    routeDocIdRef.current =
      editing?.id ?? allocateTripRouteId(userId, trip.id);
    returnRouteDocIdRef.current = "";
    setAttachmentError(null);
    setExactStep("departure");
    setReturnDepartureLocal("");
    setReturnArrivalLocal("");
    setReturnFromHubKey("");
    setReturnToHubKey("");
    setReturnAirline("");
    setReturnFlightNumber("");
    setReturnNote("");
    setReturnAttachments([]);
    if (editing) {
      setTripKind("one_way");
      setTransport(editing.transport);
      const fromMatch =
        cities.find(
          (c) =>
            c.cityName.toLowerCase() === editing.from.city.toLowerCase() ||
            c.airports.some((a) => a.placeId === editing.from.placeId) ||
            c.trainStations.some((s) => s.placeId === editing.from.placeId)
        ) ?? null;
      const toMatch =
        cities.find(
          (c) =>
            c.cityName.toLowerCase() === editing.to.city.toLowerCase() ||
            c.airports.some((a) => a.placeId === editing.to.placeId) ||
            c.trainStations.some((s) => s.placeId === editing.to.placeId)
        ) ?? null;
      setFromKey(fromMatch?.key ?? "");
      setToKey(toMatch?.key ?? "");
      setFromHubKey(
        editing.from.placeId || editing.from.code?.toUpperCase() || ""
      );
      setToHubKey(editing.to.placeId || editing.to.code?.toUpperCase() || "");
      setDepartureLocal(offsetIsoToDatetimeLocal(editing.departure?.datetime));
      setArrivalLocal(offsetIsoToDatetimeLocal(editing.arrival?.datetime));
      setApproxMinutes(editing.durationMinutes ?? 60);
      setNote(editing.note ?? "");
      setAirline(editing.airline ?? "");
      setFlightNumber(editing.flightNumber ?? "");
      setAttachments(editing.attachments ?? []);
      return;
    }
    setTripKind(null);
    setTransport("flight");
    setFromKey(cities[0]?.key ?? "");
    setToKey(cities[1]?.key ?? cities[0]?.key ?? "");
    setFromHubKey("");
    setToHubKey("");
    setDepartureLocal("");
    setArrivalLocal("");
    setApproxMinutes(60);
    setNote("");
    setAirline("");
    setFlightNumber("");
    setAttachments([]);
  }, [open, editing, cities, userId, trip.id]);

  function syncArrivalAfterDeparture(nextDeparture: string) {
    if (!arrivalLocal) return;
    if (!nextDeparture || arrivalLocal <= nextDeparture) {
      setArrivalLocal("");
    }
  }

  function syncReturnArrivalAfterDeparture(nextDeparture: string) {
    if (!returnArrivalLocal) return;
    if (!nextDeparture || returnArrivalLocal <= nextDeparture) {
      setReturnArrivalLocal("");
    }
  }

  function ensureReturnRouteId() {
    if (!returnRouteDocIdRef.current) {
      returnRouteDocIdRef.current = allocateTripRouteId(userId, trip.id);
    }
    return returnRouteDocIdRef.current;
  }

  function beginReturnLeg() {
    ensureReturnRouteId();
    setReturnFromHubKey((prev) => prev || toHubKey);
    setReturnToHubKey((prev) => prev || fromHubKey);
    if (!returnAirline && airline) setReturnAirline(airline);
    setExactStep("return_departure");
  }

  async function handleAttachFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const activeAttachments = onReturnSteps ? returnAttachments : attachments;
    const remaining = MAX_ROUTE_ATTACHMENTS - activeAttachments.length;
    if (remaining <= 0) {
      setAttachmentError(`You can attach up to ${MAX_ROUTE_ATTACHMENTS} files.`);
      return;
    }

    const routeId = onReturnSteps
      ? ensureReturnRouteId()
      : routeDocIdRef.current;
    if (!routeId) {
      setAttachmentError("Could not prepare upload. Try again.");
      return;
    }

    setUploadingAttachment(true);
    setAttachmentError(null);
    try {
      const selected = Array.from(fileList).slice(0, remaining);
      const uploaded: TripRouteAttachment[] = [];
      for (const file of selected) {
        const fileId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const isPdf =
          file.type === "application/pdf" ||
          file.name.toLowerCase().endsWith(".pdf");
        const result = await uploadRouteAttachment(
          userId,
          trip.id,
          routeId,
          fileId,
          file
        );
        uploaded.push({
          id: fileId,
          name: file.name.trim() || (isPdf ? "ticket.pdf" : "ticket.jpg"),
          contentType: result.contentType,
          url: result.url,
          storagePath: result.storagePath,
          kind: isPdf ? "pdf" : "image",
        });
      }
      if (onReturnSteps) {
        setReturnAttachments((prev) => [...prev, ...uploaded]);
      } else {
        setAttachments((prev) => [...prev, ...uploaded]);
      }
    } catch (err) {
      setAttachmentError(
        err instanceof Error ? err.message : "Failed to upload attachment."
      );
    } finally {
      setUploadingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRemoveAttachment(attachment: TripRouteAttachment) {
    if (onReturnSteps) {
      setReturnAttachments((prev) =>
        prev.filter((item) => item.id !== attachment.id)
      );
    } else {
      setAttachments((prev) => prev.filter((item) => item.id !== attachment.id));
    }
    setAttachmentError(null);
    try {
      await deleteStorageObject(attachment.storagePath);
    } catch {
      // Best-effort cleanup — metadata already removed from the form.
    }
  }

  const computedExactDuration = useMemo(() => {
    if (!exact || !fromCity || !toCity || !departureLocal || !arrivalLocal) {
      return undefined;
    }
    const depIso = localDatetimeInZoneToOffsetIso(
      departureLocal,
      fromCity.timezone
    );
    const arrIso = localDatetimeInZoneToOffsetIso(
      arrivalLocal,
      toCity.timezone
    );
    return durationMinutesBetween(depIso, arrIso);
  }, [exact, fromCity, toCity, departureLocal, arrivalLocal]);

  const computedReturnDuration = useMemo(() => {
    if (
      !isReturn ||
      !fromCity ||
      !toCity ||
      !returnDepartureLocal ||
      !returnArrivalLocal
    ) {
      return undefined;
    }
    // Return departs from outbound arrival city.
    const depIso = localDatetimeInZoneToOffsetIso(
      returnDepartureLocal,
      toCity.timezone
    );
    const arrIso = localDatetimeInZoneToOffsetIso(
      returnArrivalLocal,
      fromCity.timezone
    );
    return durationMinutesBetween(depIso, arrIso);
  }, [
    isReturn,
    fromCity,
    toCity,
    returnDepartureLocal,
    returnArrivalLocal,
  ]);

  const estimatedArrivalLabel = useMemo(() => {
    if (exact || !fromCity || !departureLocal || !approxMinutes) return null;
    const depIso = localDatetimeInZoneToOffsetIso(
      departureLocal,
      fromCity.timezone
    );
    if (!depIso) return null;
    const arrivalMs = new Date(depIso).getTime() + approxMinutes * 60_000;
    if (Number.isNaN(arrivalMs)) return null;
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(arrivalMs));
  }, [exact, fromCity, departureLocal, approxMinutes]);

  const outboundLegValid = (() => {
    if (!fromCity || !toCity || !departureLocal) return false;
    if (
      tripBounds &&
      (departureLocal < tripBounds.min || departureLocal > tripBounds.max)
    ) {
      return false;
    }
    if (
      arrivalLocal &&
      tripBounds &&
      (arrivalLocal < tripBounds.min || arrivalLocal > tripBounds.max)
    ) {
      return false;
    }
    if (exact && arrivalLocal && arrivalLocal <= departureLocal) {
      return false;
    }
    if (transport === "flight") {
      if (!fromHubKey || !toHubKey || !arrivalLocal) return false;
      if (fromHubKey === toHubKey) return false;
      if (
        !findAirport(fromAirports, fromHubKey) ||
        !findAirport(toAirports, toHubKey)
      ) {
        return false;
      }
      return computedExactDuration != null && computedExactDuration > 0;
    }
    if (transport === "train") {
      if (!arrivalLocal) return false;
      if (fromStationOptions.length > 0 && !fromHubKey) return false;
      if (toStationOptions.length > 0 && !toHubKey) return false;
      if (
        fromHubKey &&
        toHubKey &&
        fromHubKey === toHubKey &&
        fromKey === toKey
      ) {
        return false;
      }
      return computedExactDuration != null && computedExactDuration > 0;
    }
    return approxMinutes > 0;
  })();

  const returnLegValid = (() => {
    if (!isReturn || !fromCity || !toCity) return false;
    if (!returnDepartureLocal || !returnArrivalLocal) return false;
    if (
      tripBounds &&
      (returnDepartureLocal < tripBounds.min ||
        returnDepartureLocal > tripBounds.max ||
        returnArrivalLocal < tripBounds.min ||
        returnArrivalLocal > tripBounds.max)
    ) {
      return false;
    }
    if (returnArrivalLocal <= returnDepartureLocal) return false;
    if (arrivalLocal && returnDepartureLocal <= arrivalLocal) return false;
    if (transport === "flight") {
      if (!returnFromHubKey || !returnToHubKey) return false;
      if (returnFromHubKey === returnToHubKey) return false;
      if (
        !findAirport(toAirports, returnFromHubKey) ||
        !findAirport(fromAirports, returnToHubKey)
      ) {
        return false;
      }
      return computedReturnDuration != null && computedReturnDuration > 0;
    }
    if (transport === "train") {
      if (toStationOptions.length > 0 && !returnFromHubKey) return false;
      if (fromStationOptions.length > 0 && !returnToHubKey) return false;
      if (
        returnFromHubKey &&
        returnToHubKey &&
        returnFromHubKey === returnToHubKey &&
        fromKey === toKey
      ) {
        return false;
      }
      return computedReturnDuration != null && computedReturnDuration > 0;
    }
    return false;
  })();

  const canContinueDeparture = (() => {
    if (!exact || !fromCity || !departureLocal) return false;
    if (!editing && !tripKind) return false;
    if (
      tripBounds &&
      (departureLocal < tripBounds.min || departureLocal > tripBounds.max)
    ) {
      return false;
    }
    if (transport === "flight") {
      if (!fromHubKey || !findAirport(fromAirports, fromHubKey)) return false;
    }
    if (transport === "train") {
      if (fromStationOptions.length > 0 && !fromHubKey) return false;
    }
    return true;
  })();

  const canContinueOutboundArrival = outboundLegValid && isReturn;

  const canContinueReturnDeparture = (() => {
    if (!isReturn || !toCity || !returnDepartureLocal) return false;
    if (
      tripBounds &&
      (returnDepartureLocal < tripBounds.min ||
        returnDepartureLocal > tripBounds.max)
    ) {
      return false;
    }
    if (arrivalLocal && returnDepartureLocal <= arrivalLocal) return false;
    if (transport === "flight") {
      if (!returnFromHubKey || !findAirport(toAirports, returnFromHubKey)) {
        return false;
      }
    }
    if (transport === "train") {
      if (toStationOptions.length > 0 && !returnFromHubKey) return false;
    }
    return true;
  })();

  const canSave = (() => {
    if (exact && isReturn) return returnLegValid && outboundLegValid;
    if (exact) return outboundLegValid && Boolean(tripKind || editing);
    return outboundLegValid;
  })();

  function buildExactLegPayload(args: {
    fromPoint: TripRoute["from"];
    toPoint: TripRoute["to"];
    departureLocalValue: string;
    arrivalLocalValue: string;
    fromTimezone: string;
    toTimezone: string;
    noteValue: string;
    airlineValue: string;
    flightNumberValue: string;
    attachmentList: TripRouteAttachment[];
    routeId?: string;
  }): RouteSheetLegPayload | null {
    const departureIso = localDatetimeInZoneToOffsetIso(
      args.departureLocalValue,
      args.fromTimezone
    );
    const arrivalIso = localDatetimeInZoneToOffsetIso(
      args.arrivalLocalValue,
      args.toTimezone
    );
    if (!departureIso || !arrivalIso) return null;
    const duration = durationMinutesBetween(departureIso, arrivalIso);
    if (duration == null || duration <= 0) return null;
    return {
      transport,
      from: args.fromPoint,
      to: args.toPoint,
      departure: {
        datetime: departureIso,
        timezone: args.fromTimezone,
        timeKnown: true,
      },
      arrival: {
        datetime: arrivalIso,
        timezone: args.toTimezone,
        timeKnown: true,
      },
      durationMinutes: duration,
      durationApproximate: false,
      status: editing?.status ?? "planned",
      attachments: args.attachmentList,
      routeId: args.routeId,
      ...(args.noteValue.trim() ? { note: args.noteValue.trim() } : {}),
      ...(transport === "flight" && args.airlineValue.trim()
        ? { airline: args.airlineValue.trim() }
        : {}),
      ...(transport === "flight" && args.flightNumberValue.trim()
        ? { flightNumber: args.flightNumberValue.trim().toUpperCase() }
        : {}),
    };
  }

  async function handleSave() {
    if (!fromCity || !toCity || !canSave) return;
    setSaving(true);
    setAttachmentError(null);
    try {
      const depAirport =
        transport === "flight"
          ? findAirport(fromAirports, fromHubKey)
          : undefined;
      const arrAirport =
        transport === "flight"
          ? findAirport(toAirports, toHubKey)
          : undefined;
      const depStation =
        transport === "train"
          ? findStation(fromStations, fromHubKey)
          : undefined;
      const arrStation =
        transport === "train"
          ? findStation(toStations, toHubKey)
          : undefined;

      const fromHubLocation =
        depAirport?.location ?? depStation?.location ?? null;
      const toHubLocation =
        arrAirport?.location ?? arrStation?.location ?? null;

      const [fromTimezone, toTimezone] = await Promise.all([
        resolveRouteCityTimezone(fromCity, fromHubLocation),
        resolveRouteCityTimezone(toCity, toHubLocation),
      ]);

      let fromPoint = cityPointFromOption(fromCity);
      let toPoint = cityPointFromOption(toCity);

      if (transport === "flight") {
        if (!depAirport || !arrAirport) return;
        fromPoint = airportToRoutePoint(fromCity, depAirport);
        toPoint = airportToRoutePoint(toCity, arrAirport);
      } else if (transport === "train") {
        if (depStation) fromPoint = stationToRoutePoint(fromCity, depStation);
        if (arrStation) toPoint = stationToRoutePoint(toCity, arrStation);
      } else if (toHubKey) {
        const optionalArrAirport = findAirport(toAirports, toHubKey);
        if (optionalArrAirport) {
          toPoint = airportToRoutePoint(toCity, optionalArrAirport);
        }
      }

      if (exact) {
        const outbound = buildExactLegPayload({
          fromPoint,
          toPoint,
          departureLocalValue: departureLocal,
          arrivalLocalValue: arrivalLocal,
          fromTimezone,
          toTimezone,
          noteValue: note,
          airlineValue: airline,
          flightNumberValue: flightNumber,
          attachmentList: attachments,
          routeId: routeDocIdRef.current || undefined,
        });
        if (!outbound) return;

        let returnLeg: RouteSheetLegPayload | undefined;
        if (isReturn) {
          let returnFromPoint = cityPointFromOption(toCity);
          let returnToPoint = cityPointFromOption(fromCity);
          if (transport === "flight") {
            const returnDepAirport = findAirport(toAirports, returnFromHubKey);
            const returnArrAirport = findAirport(
              fromAirports,
              returnToHubKey
            );
            if (!returnDepAirport || !returnArrAirport) return;
            returnFromPoint = airportToRoutePoint(toCity, returnDepAirport);
            returnToPoint = airportToRoutePoint(fromCity, returnArrAirport);
          } else if (transport === "train") {
            const returnDepStation = findStation(
              toStations,
              returnFromHubKey
            );
            const returnArrStation = findStation(
              fromStations,
              returnToHubKey
            );
            if (returnDepStation) {
              returnFromPoint = stationToRoutePoint(toCity, returnDepStation);
            }
            if (returnArrStation) {
              returnToPoint = stationToRoutePoint(fromCity, returnArrStation);
            }
          }
          const built = buildExactLegPayload({
            fromPoint: returnFromPoint,
            toPoint: returnToPoint,
            departureLocalValue: returnDepartureLocal,
            arrivalLocalValue: returnArrivalLocal,
            fromTimezone: toTimezone,
            toTimezone: fromTimezone,
            noteValue: returnNote,
            airlineValue: returnAirline,
            flightNumberValue: returnFlightNumber,
            attachmentList: returnAttachments,
            routeId: returnRouteDocIdRef.current || undefined,
          });
          if (!built) return;
          returnLeg = built;
        }

        await onSave({
          ...outbound,
          ...(returnLeg ? { returnLeg } : {}),
        });
        onClose();
        return;
      }

      const departureIso = localDatetimeInZoneToOffsetIso(
        departureLocal,
        fromTimezone
      );
      if (!departureIso) return;

      const arrivalMs =
        new Date(departureIso).getTime() + approxMinutes * 60_000;
      const payload: RouteSheetSavePayload = {
        transport,
        from: fromPoint,
        to: toPoint,
        departure: {
          datetime: departureIso,
          timezone: fromTimezone,
          timeKnown: true,
        },
        arrival: {
          datetime: new Date(arrivalMs).toISOString(),
          timezone: toTimezone,
          // Arrival is derived from approximate duration — clock is not exact.
          timeKnown: false,
        },
        status: editing?.status ?? "planned",
        attachments,
        routeId: routeDocIdRef.current || undefined,
        durationMinutes: approxMinutes,
        durationApproximate: true,
        ...(note.trim() ? { note: note.trim() } : {}),
      };

      await onSave(payload);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? "Edit route" : "Add route"}
      description="Plan how you’ll move between destinations."
      size="lg"
      className={cx(ESSENTIALS_SHEET_CLASS, "md:!max-w-lg")}
      bodyClassName="pb-4"
    >
      <div className={ESSENTIALS_FORM_STACK}>
        <EssentialsField label="Transport type">
          <div className="grid grid-cols-4 gap-1.5">
            {TRANSPORT_UI.map((item) => {
              const active = transport === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setTransport(item.id);
                    setFromHubKey("");
                    setToHubKey("");
                    setExactStep("departure");
                    if (!isExactScheduleTransport(item.id)) {
                      setTripKind(null);
                    } else if (editing) {
                      setTripKind("one_way");
                    } else {
                      setTripKind(null);
                    }
                  }}
                  className={cx(
                    "flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2.5 text-center transition-colors",
                    active
                      ? "border-primary/30 bg-primary-tint text-primary"
                      : "border-border bg-white text-text-secondary hover:border-primary/20 hover:text-text"
                  )}
                >
                  <item.Icon className="h-4 w-4" aria-hidden />
                  <span className="text-[11px] font-medium leading-tight">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </EssentialsField>

        {exact && !editing ? (
          <EssentialsField
            label="Trip type"
            hint={
              !tripKind ? (
                <p className="text-xs text-text-muted">
                  Choose one way or return to continue.
                </p>
              ) : null
            }
          >
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  {
                    id: "one_way" as const,
                    label: "One way",
                    description: "Go only",
                    Icon: ArrowRight,
                  },
                  {
                    id: "return" as const,
                    label: "Return",
                    description: "Go and back",
                    Icon: ArrowLeftRight,
                  },
                ] as const
              ).map((item) => {
                const active = tripKind === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setTripKind(item.id);
                      if (
                        item.id === "one_way" &&
                        (exactStep === "return_departure" ||
                          exactStep === "return_arrival")
                      ) {
                        setExactStep("arrival");
                      }
                    }}
                    className={cx(
                      "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      active
                        ? "border-primary/30 bg-primary-tint text-primary"
                        : "border-border bg-white text-text-secondary hover:border-primary/20 hover:text-text"
                    )}
                  >
                    <item.Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-tight">
                        {item.label}
                      </span>
                      <span className="block text-[11px] text-text-muted">
                        {item.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </EssentialsField>
        ) : null}

        {showOutboundDeparture ? (
          <section className="space-y-3.5 rounded-xl border border-border bg-surface/70 p-3.5 sm:p-4">
            <header className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-tint text-[11px] font-semibold text-primary">
                A
              </span>
              <div>
                <h3 className="text-sm font-semibold text-text">
                  {isReturn ? "Outbound departure" : "Departure"}
                </h3>
                <p className="text-xs text-text-muted">
                  Where and when you leave
                </p>
              </div>
            </header>

            <EssentialsField label="From city">
              <SearchableSelect
                value={fromKey}
                onChange={(value) => {
                  setFromKey(value);
                  setFromHubKey("");
                }}
                options={cityOptions}
                placeholder="Select city"
                clearable={false}
              />
            </EssentialsField>

            {transport === "flight" ? (
              <EssentialsField
                label="Departure airport"
                hint={
                  fromAirportOptions.length === 0 ? (
                    <p className="text-xs text-text-muted">
                      No airports on this city yet. They appear after trip
                      transport discovery finishes.
                    </p>
                  ) : null
                }
              >
                <SearchableSelect
                  value={fromHubKey}
                  onChange={setFromHubKey}
                  options={fromAirportOptions}
                  placeholder="Select airport"
                  triggerLayout="stacked"
                  clearable={false}
                  disabled={!fromKey || fromAirportOptions.length === 0}
                />
              </EssentialsField>
            ) : null}

            {transport === "train" && fromStationOptions.length > 0 ? (
              <EssentialsField label="Departure station">
                <SearchableSelect
                  value={fromHubKey}
                  onChange={setFromHubKey}
                  options={fromStationOptions}
                  placeholder="Select station"
                  clearable={false}
                  disabled={!fromKey}
                />
              </EssentialsField>
            ) : null}

            <RouteDatetimeField
              id={departureId}
              label={exact ? "Departure" : "Start"}
              value={departureLocal}
              min={departureMin}
              max={departureMax}
              onChange={(value) => {
                const next = clampToTripBounds(value);
                setDepartureLocal(next);
                syncArrivalAfterDeparture(next);
              }}
            />
          </section>
        ) : null}

        {exact &&
        (exactStep === "arrival" ||
          exactStep === "return_departure" ||
          exactStep === "return_arrival") &&
        fromCity ? (
          <button
            type="button"
            onClick={() => setExactStep("departure")}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface/70 px-3.5 py-3 text-left transition-colors hover:border-primary/25"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-tint text-[11px] font-semibold text-primary">
              A
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-text-muted">
                {isReturn ? "Outbound departure" : "Departure"}
              </p>
              <p className="truncate text-sm font-medium text-text">
                {fromCity.cityName}
                {departureLocal
                  ? ` · ${formatDatetimeLocalDisplay(departureLocal)}`
                  : ""}
              </p>
            </div>
            <span className="shrink-0 text-xs font-medium text-primary">
              Edit
            </span>
          </button>
        ) : null}

        {showOutboundArrival ? (
          <section className="space-y-3.5 rounded-xl border border-border bg-white p-3.5 ring-1 ring-border/60 sm:p-4">
            <header className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface text-[11px] font-semibold text-text-secondary ring-1 ring-border">
                B
              </span>
              <div>
                <h3 className="text-sm font-semibold text-text">
                  {isReturn ? "Outbound arrival" : "Arrival"}
                </h3>
                <p className="text-xs text-text-muted">
                  {exact
                    ? "Where and when you arrive"
                    : "Destination and how long it takes"}
                </p>
              </div>
            </header>

            <EssentialsField label="To city">
              <SearchableSelect
                value={toKey}
                onChange={(value) => {
                  setToKey(value);
                  setToHubKey("");
                }}
                options={cityOptions}
                placeholder="Select city"
                clearable={false}
              />
            </EssentialsField>

            {!exact && toAirportOptions.length > 0 ? (
              <EssentialsField
                label="To place (optional)"
                hint={
                  <p className="text-xs text-text-muted">
                    Pick an airport for transfers like taxi to the terminal, or
                    leave as the city.
                  </p>
                }
              >
                <SearchableSelect
                  value={toHubKey}
                  onChange={setToHubKey}
                  options={[
                    {
                      value: "",
                      label: toCity?.cityName ?? "City center",
                      description: "City",
                    },
                    ...toAirportOptions,
                  ]}
                  placeholder="City or airport"
                  triggerLayout="stacked"
                  clearable
                  disabled={!toKey}
                />
              </EssentialsField>
            ) : null}

            {transport === "flight" ? (
              <EssentialsField
                label="Arrival airport"
                hint={
                  toAirportOptions.length === 0 ? (
                    <p className="text-xs text-text-muted">
                      No airports found for this city yet.
                    </p>
                  ) : null
                }
              >
                <SearchableSelect
                  value={toHubKey}
                  onChange={setToHubKey}
                  options={toAirportOptions}
                  placeholder="Select airport"
                  triggerLayout="stacked"
                  clearable={false}
                  disabled={!toKey || toAirportOptions.length === 0}
                />
              </EssentialsField>
            ) : null}

            {transport === "train" && toStationOptions.length > 0 ? (
              <EssentialsField label="Arrival station">
                <SearchableSelect
                  value={toHubKey}
                  onChange={setToHubKey}
                  options={toStationOptions}
                  placeholder="Select station"
                  clearable={false}
                  disabled={!toKey}
                />
              </EssentialsField>
            ) : null}

            {exact ? (
              <>
                <RouteDatetimeField
                  id={arrivalId}
                  label="Arrival"
                  value={arrivalLocal}
                  min={arrivalMin}
                  max={arrivalMax}
                  onChange={(value) => {
                    const clamped = clampToTripBounds(value);
                    if (departureLocal && clamped <= departureLocal) {
                      const next =
                        addMinutesToDatetimeLocal(departureLocal, 1) ??
                        departureLocal;
                      setArrivalLocal(clampToTripBounds(next));
                      return;
                    }
                    setArrivalLocal(clamped);
                    if (
                      returnDepartureLocal &&
                      returnDepartureLocal <= clamped
                    ) {
                      setReturnDepartureLocal("");
                      setReturnArrivalLocal("");
                    }
                  }}
                />
                {computedExactDuration != null ? (
                  <p className="text-xs text-text-secondary">
                    Duration{" "}
                    <span className="font-medium text-text">
                      {formatRouteDuration(computedExactDuration)}
                    </span>
                  </p>
                ) : arrivalLocal && departureLocal ? (
                  <p className="text-xs text-error">
                    Arrival must be after departure.
                  </p>
                ) : null}
              </>
            ) : (
              <EssentialsField label="Approximate duration" htmlFor={durationId}>
                <div className="flex flex-wrap gap-1.5">
                  {APPROX_DURATION_PRESETS.map((preset) => {
                    const active = approxMinutes === preset.minutes;
                    return (
                      <button
                        key={preset.minutes}
                        type="button"
                        onClick={() => setApproxMinutes(preset.minutes)}
                        className={cx(
                          "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                          active
                            ? "border-primary/30 bg-primary-tint text-primary"
                            : "border-border bg-white text-text-secondary hover:text-text"
                        )}
                      >
                        ~{preset.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2">
                  <TextInput
                    id={durationId}
                    type="number"
                    min={1}
                    step={5}
                    value={String(approxMinutes)}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      if (Number.isFinite(next) && next > 0) {
                        setApproxMinutes(Math.round(next));
                      }
                    }}
                    placeholder="Minutes"
                    className="!shadow-none"
                  />
                  <p className="mt-1.5 text-xs text-text-muted">
                    Minutes · estimated arrival{" "}
                    {estimatedArrivalLabel
                      ? estimatedArrivalLabel
                      : "after start time"}
                  </p>
                </div>
              </EssentialsField>
            )}
          </section>
        ) : null}

        {exact &&
        (exactStep === "return_departure" || exactStep === "return_arrival") &&
        toCity ? (
          <button
            type="button"
            onClick={() => setExactStep("arrival")}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-white px-3.5 py-3 text-left ring-1 ring-border/60 transition-colors hover:border-primary/25"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-[11px] font-semibold text-text-secondary ring-1 ring-border">
              B
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-text-muted">
                Outbound arrival
              </p>
              <p className="truncate text-sm font-medium text-text">
                {toCity.cityName}
                {arrivalLocal
                  ? ` · ${formatDatetimeLocalDisplay(arrivalLocal)}`
                  : ""}
              </p>
            </div>
            <span className="shrink-0 text-xs font-medium text-primary">
              Edit
            </span>
          </button>
        ) : null}

        {showReturnDeparture ? (
          <section className="space-y-3.5 rounded-xl border border-border bg-surface/70 p-3.5 sm:p-4">
            <header className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-tint text-[11px] font-semibold text-primary">
                C
              </span>
              <div>
                <h3 className="text-sm font-semibold text-text">
                  Return departure
                </h3>
                <p className="text-xs text-text-muted">
                  Going back · {toCity?.cityName ?? "Origin"}
                </p>
              </div>
            </header>

            <EssentialsField label="From city">
              <div className="rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-text">
                {toCity?.cityName ?? "—"}
              </div>
            </EssentialsField>

            {transport === "flight" ? (
              <EssentialsField label="Departure airport">
                <SearchableSelect
                  value={returnFromHubKey}
                  onChange={setReturnFromHubKey}
                  options={toAirportOptions}
                  placeholder="Select airport"
                  triggerLayout="stacked"
                  clearable={false}
                  disabled={!toKey || toAirportOptions.length === 0}
                />
              </EssentialsField>
            ) : null}

            {transport === "train" && toStationOptions.length > 0 ? (
              <EssentialsField label="Departure station">
                <SearchableSelect
                  value={returnFromHubKey}
                  onChange={setReturnFromHubKey}
                  options={toStationOptions}
                  placeholder="Select station"
                  clearable={false}
                  disabled={!toKey}
                />
              </EssentialsField>
            ) : null}

            <RouteDatetimeField
              id={returnDepartureId}
              label="Departure"
              value={returnDepartureLocal}
              min={returnDepartureMin}
              max={departureMax}
              onChange={(value) => {
                const next = clampToTripBounds(value);
                if (arrivalLocal && next <= arrivalLocal) {
                  const bumped =
                    addMinutesToDatetimeLocal(arrivalLocal, 1) ?? arrivalLocal;
                  setReturnDepartureLocal(clampToTripBounds(bumped));
                  syncReturnArrivalAfterDeparture(clampToTripBounds(bumped));
                  return;
                }
                setReturnDepartureLocal(next);
                syncReturnArrivalAfterDeparture(next);
              }}
            />
          </section>
        ) : null}

        {exact && exactStep === "return_arrival" && toCity ? (
          <button
            type="button"
            onClick={() => setExactStep("return_departure")}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface/70 px-3.5 py-3 text-left transition-colors hover:border-primary/25"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-tint text-[11px] font-semibold text-primary">
              C
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-text-muted">
                Return departure
              </p>
              <p className="truncate text-sm font-medium text-text">
                {toCity.cityName}
                {returnDepartureLocal
                  ? ` · ${formatDatetimeLocalDisplay(returnDepartureLocal)}`
                  : ""}
              </p>
            </div>
            <span className="shrink-0 text-xs font-medium text-primary">
              Edit
            </span>
          </button>
        ) : null}

        {showReturnArrival ? (
          <section className="space-y-3.5 rounded-xl border border-border bg-white p-3.5 ring-1 ring-border/60 sm:p-4">
            <header className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface text-[11px] font-semibold text-text-secondary ring-1 ring-border">
                D
              </span>
              <div>
                <h3 className="text-sm font-semibold text-text">
                  Return arrival
                </h3>
                <p className="text-xs text-text-muted">
                  Back to {fromCity?.cityName ?? "start"}
                </p>
              </div>
            </header>

            <EssentialsField label="To city">
              <div className="rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-text">
                {fromCity?.cityName ?? "—"}
              </div>
            </EssentialsField>

            {transport === "flight" ? (
              <EssentialsField label="Arrival airport">
                <SearchableSelect
                  value={returnToHubKey}
                  onChange={setReturnToHubKey}
                  options={fromAirportOptions}
                  placeholder="Select airport"
                  triggerLayout="stacked"
                  clearable={false}
                  disabled={!fromKey || fromAirportOptions.length === 0}
                />
              </EssentialsField>
            ) : null}

            {transport === "train" && fromStationOptions.length > 0 ? (
              <EssentialsField label="Arrival station">
                <SearchableSelect
                  value={returnToHubKey}
                  onChange={setReturnToHubKey}
                  options={fromStationOptions}
                  placeholder="Select station"
                  clearable={false}
                  disabled={!fromKey}
                />
              </EssentialsField>
            ) : null}

            <RouteDatetimeField
              id={returnArrivalId}
              label="Arrival"
              value={returnArrivalLocal}
              min={returnArrivalMin}
              max={returnArrivalMax}
              onChange={(value) => {
                const clamped = clampToTripBounds(value);
                if (returnDepartureLocal && clamped <= returnDepartureLocal) {
                  const next =
                    addMinutesToDatetimeLocal(returnDepartureLocal, 1) ??
                    returnDepartureLocal;
                  setReturnArrivalLocal(clampToTripBounds(next));
                  return;
                }
                setReturnArrivalLocal(clamped);
              }}
            />
            {computedReturnDuration != null ? (
              <p className="text-xs text-text-secondary">
                Duration{" "}
                <span className="font-medium text-text">
                  {formatRouteDuration(computedReturnDuration)}
                </span>
              </p>
            ) : returnArrivalLocal && returnDepartureLocal ? (
              <p className="text-xs text-error">
                Arrival must be after departure.
              </p>
            ) : null}
          </section>
        ) : null}

        {showOutboundArrival && transport === "flight" ? (
          <section className="space-y-3.5 rounded-xl border border-border bg-surface/70 p-3.5 sm:p-4">
            <header className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-tint text-primary">
                <Plane className="h-3.5 w-3.5" aria-hidden />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-text">
                  {isReturn ? "Outbound flight details" : "Flight details"}
                </h3>
                <p className="text-xs text-text-muted">Optional</p>
              </div>
            </header>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-3">
              <EssentialsField label="Airline">
                <SearchableSelect
                  value={airline}
                  onChange={setAirline}
                  options={airlineOptions}
                  placeholder="Select airline"
                  searchPlaceholder="Search airline or code…"
                  triggerLayout="stacked"
                />
              </EssentialsField>
              <EssentialsField label="Flight number" htmlFor={flightNumberId}>
                <TextInput
                  id={flightNumberId}
                  value={flightNumber}
                  onChange={(e) => setFlightNumber(e.target.value)}
                  placeholder="TK 123"
                  className="!shadow-none"
                  autoCapitalize="characters"
                />
              </EssentialsField>
            </div>
          </section>
        ) : null}

        {showReturnArrival && transport === "flight" ? (
          <section className="space-y-3.5 rounded-xl border border-border bg-surface/70 p-3.5 sm:p-4">
            <header className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-tint text-primary">
                <Plane className="h-3.5 w-3.5" aria-hidden />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-text">
                  Return flight details
                </h3>
                <p className="text-xs text-text-muted">Optional</p>
              </div>
            </header>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-3">
              <EssentialsField label="Airline">
                <SearchableSelect
                  value={returnAirline}
                  onChange={setReturnAirline}
                  options={returnAirlineOptions}
                  placeholder="Select airline"
                  searchPlaceholder="Search airline or code…"
                  triggerLayout="stacked"
                />
              </EssentialsField>
              <EssentialsField
                label="Flight number"
                htmlFor={returnFlightNumberId}
              >
                <TextInput
                  id={returnFlightNumberId}
                  value={returnFlightNumber}
                  onChange={(e) => setReturnFlightNumber(e.target.value)}
                  placeholder="TK 456"
                  className="!shadow-none"
                  autoCapitalize="characters"
                />
              </EssentialsField>
            </div>
          </section>
        ) : null}

        {showOutboundArrival ? (
          <EssentialsField label="Note (optional)" htmlFor={noteId}>
            <textarea
              id={noteId}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Seat, booking ref, tips…"
              className={ESSENTIALS_NOTES_CLASS}
            />
          </EssentialsField>
        ) : null}

        {showReturnArrival ? (
          <EssentialsField label="Return note (optional)" htmlFor={returnNoteId}>
            <textarea
              id={returnNoteId}
              rows={2}
              value={returnNote}
              onChange={(e) => setReturnNote(e.target.value)}
              placeholder="Seat, booking ref, tips…"
              className={ESSENTIALS_NOTES_CLASS}
            />
          </EssentialsField>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3.5">
          {showOutboundArrival || showReturnArrival ? (
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
              <input
                ref={fileInputRef}
                type="file"
                accept={ROUTE_FILE_ACCEPT}
                multiple
                className="hidden"
                onChange={(event) => void handleAttachFiles(event.target.files)}
              />
              <button
                type="button"
                aria-label="Attach ticket PDF or image"
                title="Attach PDF or image"
                disabled={
                  saving ||
                  uploadingAttachment ||
                  (onReturnSteps
                    ? returnAttachments.length
                    : attachments.length) >= MAX_ROUTE_ATTACHMENTS
                }
                onClick={() => fileInputRef.current?.click()}
                className={cx(
                  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-text-secondary shadow-sm transition-colors",
                  "hover:border-primary/30 hover:bg-primary-tint hover:text-primary",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                {uploadingAttachment ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                ) : (
                  <Paperclip className="h-4 w-4" />
                )}
              </button>
              {(onReturnSteps ? returnAttachments : attachments).map((file) => (
                <div
                  key={file.id}
                  className="inline-flex max-w-[9.5rem] items-center gap-1 rounded-lg border border-border bg-surface px-1.5 py-1"
                >
                  {file.kind === "pdf" ? (
                    <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-[11px] font-medium text-text hover:text-primary"
                    title={file.name}
                  >
                    {file.name}
                  </a>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    disabled={saving || uploadingAttachment}
                    onClick={() => void handleRemoveAttachment(file)}
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-white hover:text-error disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {attachmentError ? (
                <p className="text-[11px] text-error">{attachmentError}</p>
              ) : null}
            </div>
          ) : (
            <div className="min-w-0 flex-1" />
          )}

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={saving || uploadingAttachment}
            >
              Cancel
            </Button>
            {exact && exactStep === "departure" ? (
              <Button
                type="button"
                variant="primary"
                disabled={!canContinueDeparture || saving || uploadingAttachment}
                onClick={() => setExactStep("arrival")}
              >
                Continue
              </Button>
            ) : exact && exactStep === "arrival" && isReturn ? (
              <Button
                type="button"
                variant="primary"
                disabled={
                  !canContinueOutboundArrival || saving || uploadingAttachment
                }
                onClick={beginReturnLeg}
              >
                Continue to return
              </Button>
            ) : exact && exactStep === "return_departure" ? (
              <Button
                type="button"
                variant="primary"
                disabled={
                  !canContinueReturnDeparture || saving || uploadingAttachment
                }
                onClick={() => setExactStep("return_arrival")}
              >
                Continue
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                loading={saving}
                disabled={!canSave || saving || uploadingAttachment}
                onClick={() => void handleSave()}
              >
                {isReturn ? "Save routes" : "Save route"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Sheet>
  );
}

export { TRANSPORT_UI };
