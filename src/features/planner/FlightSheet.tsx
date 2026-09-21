"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  FileText,
  Info,
  Link2,
  MoreVertical,
  Pencil,
  Plane,
  PlaneTakeoff,
  Plus,
  Trash2,
} from "lucide-react";
import { Button, SearchableSelect, TextInput } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { cx } from "@/lib/utils";
import { resolveCityAirports } from "@/services/functions";
import type {
  TripFlightAirport,
  TripFlightEssential,
  TripPlannerDoc,
} from "@/types/trip-planner";
import {
  ESSENTIALS_FORM_STACK,
  ESSENTIALS_SHEET_CLASS,
  EssentialsField,
} from "./essentialsFormUi";
import {
  flightAirportCode,
  formatFlightWhen,
  fromDatetimeLocalValue,
  normalizeUrl,
  toDatetimeLocalValue,
  toTripFlightAirport,
} from "./essentialsHelpers";
import {
  flightRouteAirportsKey,
  flightRouteLabel,
  listFlightRouteCities,
} from "./tripDestinations";

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

type FlightKind = "outbound" | "return" | "leg";

function normalizeCityLabel(value?: string): string {
  return value?.trim().toLowerCase() ?? "";
}

function classifyFlight(
  flight: TripFlightEssential,
  routeCities: ReturnType<typeof listFlightRouteCities>,
  routeAirports: TripFlightAirport[]
): FlightKind {
  const originCity = normalizeCityLabel(routeCities[0]?.cityName);
  const destCity = normalizeCityLabel(
    routeCities[routeCities.length - 1]?.cityName
  );
  const originCode = routeAirports[0]?.code?.toUpperCase() ?? "";
  const destCode =
    routeAirports[routeAirports.length - 1]?.code?.toUpperCase() ?? "";

  const fromCity = normalizeCityLabel(
    flight.fromCityName || flight.departure?.cityName
  );
  const toCity = normalizeCityLabel(
    flight.toCityName || flight.arrival?.cityName
  );
  const fromCode = flightAirportCode(flight, "departure");
  const toCode = flightAirportCode(flight, "arrival");

  const outboundByCode =
    Boolean(originCode && destCode) &&
    fromCode === originCode &&
    toCode === destCode;
  const returnByCode =
    Boolean(originCode && destCode) &&
    fromCode === destCode &&
    toCode === originCode;
  const outboundByCity =
    Boolean(originCity && destCity) &&
    fromCity === originCity &&
    toCity === destCity;
  const returnByCity =
    Boolean(originCity && destCity) &&
    fromCity === destCity &&
    toCity === originCity;

  if (outboundByCode || outboundByCity) return "outbound";
  if (returnByCode || returnByCity) return "return";
  return "leg";
}

const FLIGHT_KIND_UI: Record<
  FlightKind,
  {
    label: string;
    iconWrap: string;
    icon: string;
    badge: string;
  }
> = {
  outbound: {
    label: "Outbound",
    iconWrap: "bg-sky-50",
    icon: "text-sky-600",
    badge: "bg-success-background text-success",
  },
  return: {
    label: "Return",
    iconWrap: "bg-primary-tint",
    icon: "text-primary",
    badge: "bg-primary-tint text-primary",
  },
  leg: {
    label: "Flight",
    iconWrap: "bg-surface",
    icon: "text-text-secondary",
    badge: "bg-surface text-text-secondary",
  },
};

function FlightDatetimeField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const display = formatDatetimeLocalDisplay(value);

  return (
    <EssentialsField label={label} htmlFor={id}>
      <div className="relative">
        <CalendarDays
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
          aria-hidden
        />
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
          aria-hidden
        />
        {display ? (
          <span className="pointer-events-none absolute inset-y-0 left-9 right-9 flex items-center truncate text-sm text-text">
            {display}
          </span>
        ) : (
          <span className="pointer-events-none absolute inset-y-0 left-9 right-9 flex items-center truncate text-sm text-text-muted">
            Select date & time
          </span>
        )}
        <input
          id={id}
          type="datetime-local"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cx(
            "block w-full min-h-11 cursor-pointer rounded-xl border border-border bg-white",
            "px-9 py-2.5 text-sm text-transparent caret-transparent outline-none transition-colors",
            "focus:border-primary focus:ring-2 focus:ring-primary/20",
            "[color-scheme:light]"
          )}
        />
      </div>
    </EssentialsField>
  );
}

export function FlightSheet({
  open,
  onClose,
  trip,
  items,
  onSaveAll,
  onSaveRouteAirports,
}: {
  open: boolean;
  onClose: () => void;
  trip: TripPlannerDoc;
  items: TripFlightEssential[];
  onSaveAll: (items: TripFlightEssential[]) => Promise<void>;
  onSaveRouteAirports?: (
    airports: TripFlightAirport[],
    key: string
  ) => Promise<void>;
}) {
  const [view, setView] = useState<"list" | "form">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [departureCode, setDepartureCode] = useState("");
  const [arrivalCode, setArrivalCode] = useState("");
  const [departureAt, setDepartureAt] = useState("");
  const [arrivalAt, setArrivalAt] = useState("");
  const [bookingLink, setBookingLink] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [airports, setAirports] = useState<TripFlightAirport[]>([]);
  const [resolvingAirports, setResolvingAirports] = useState(false);
  const [, setResolveError] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const resolveInFlightKeyRef = useRef<string | null>(null);
  const departureAtId = useId();
  const arrivalAtId = useId();
  const linkId = useId();
  const notesId = useId();

  const routeCities = useMemo(() => listFlightRouteCities(trip), [trip]);
  const routeLabel = useMemo(
    () => flightRouteLabel(routeCities),
    [routeCities]
  );
  const citiesKey = useMemo(
    () => flightRouteAirportsKey(routeCities),
    [routeCities]
  );
  const directionAirports = airports;
  useEffect(() => {
    if (!menuOpenId) return;
    const onDoc = () => setMenuOpenId(null);
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [menuOpenId]);

  const airportOptions = useMemo(
    () =>
      airports.map((airport) => ({
        value: airport.code,
        label: airport.code,
        description:
          airport.name?.trim() || airport.cityName?.trim() || undefined,
      })),
    [airports]
  );

  const departureOptions = airportOptions;
  const arrivalOptions = useMemo(
    () =>
      airportOptions.filter(
        (option) =>
          !departureCode || option.value !== departureCode.toUpperCase()
      ),
    [airportOptions, departureCode]
  );

  const sameAirportSelected =
    Boolean(departureCode) &&
    Boolean(arrivalCode) &&
    departureCode.toUpperCase() === arrivalCode.toUpperCase();

  const editing = editingId
    ? items.find((item) => item.id === editingId) ?? null
    : null;

  function resetForm(initial: TripFlightEssential | null) {
    const dep =
      initial?.departure?.code?.trim().toUpperCase() ||
      initial?.departureAirport?.trim().toUpperCase() ||
      "";
    const arr =
      initial?.arrival?.code?.trim().toUpperCase() ||
      initial?.arrivalAirport?.trim().toUpperCase() ||
      "";
    setDepartureCode(dep);
    setArrivalCode(arr && arr !== dep ? arr : "");
    setDepartureAt(toDatetimeLocalValue(initial?.departureAt));
    setArrivalAt(toDatetimeLocalValue(initial?.arrivalAt));
    setBookingLink(initial?.bookingLink ?? "");
    setNotes(initial?.notes ?? "");
  }

  function applyDefaultDirection(list: TripFlightAirport[]) {
    if (list.length < 2) return;
    const first = list[0]!.code.toUpperCase();
    const last = list[list.length - 1]!.code.toUpperCase();
    if (first === last) return;
    setDepartureCode((current) => current || first);
    setArrivalCode((current) => {
      if (current && current !== first) return current;
      return last !== first ? last : "";
    });
  }

  useEffect(() => {
    if (!open) return;
    setMenuOpenId(null);
    if (items.length === 0) {
      setEditingId(null);
      resetForm(null);
      setView("form");
    } else {
      setView("list");
      setEditingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when sheet opens
  }, [open]);

  useEffect(() => {
    if (!open || routeCities.length === 0) {
      setAirports([]);
      setResolveError(null);
      setResolvingAirports(false);
      resolveInFlightKeyRef.current = null;
      return;
    }

    if (resolveInFlightKeyRef.current === citiesKey) {
      return;
    }

    let cancelled = false;
    resolveInFlightKeyRef.current = citiesKey;
    setResolvingAirports(true);
    setResolveError(null);

    void resolveCityAirports({
      cities: routeCities.map((city) => ({
        cityName: city.cityName,
        ...(city.countryName ? { countryName: city.countryName } : {}),
        ...(city.cityId ? { cityId: city.cityId } : {}),
        ...(typeof city.lat === "number" ? { lat: city.lat } : {}),
        ...(typeof city.lon === "number" ? { lon: city.lon } : {}),
      })),
      language: "en",
    })
      .then(async (result) => {
        if (cancelled) return;
        const next = (result.airports ?? []).map(toTripFlightAirport);
        setAirports(next);
        if (!editingId) {
          applyDefaultDirection(next);
        }
        if (next.length > 0 && onSaveRouteAirports) {
          try {
            await onSaveRouteAirports(next, citiesKey);
          } catch {
            // Still show resolved codes even if persist fails.
          }
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setAirports([]);
        setResolveError(
          err instanceof Error ? err.message : "Could not resolve airports."
        );
      })
      .finally(() => {
        if (resolveInFlightKeyRef.current === citiesKey) {
          resolveInFlightKeyRef.current = null;
        }
        if (!cancelled) setResolvingAirports(false);
      });

    return () => {
      cancelled = true;
    };
    // Only resolve when sheet opens or cities key changes — not on every trip rewrite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, citiesKey]);

  const canSave =
    Boolean(departureCode.trim()) &&
    Boolean(arrivalCode.trim()) &&
    !sameAirportSelected;

  function startAdd() {
    setEditingId(null);
    resetForm(null);
    applyDefaultDirection(airports);
    setView("form");
  }

  function startEdit(item: TripFlightEssential) {
    setEditingId(item.id);
    resetForm(item);
    setView("form");
  }

  function backToList() {
    if (items.length === 0) {
      onClose();
      return;
    }
    setView("list");
    setEditingId(null);
  }

  function selectDeparture(code: string) {
    const next = code.trim().toUpperCase();
    setDepartureCode(next);
    if (next && arrivalCode.toUpperCase() === next) {
      setArrivalCode("");
    }
  }

  function selectArrival(code: string) {
    const next = code.trim().toUpperCase();
    if (next && departureCode.toUpperCase() === next) return;
    setArrivalCode(next);
  }

  async function handleSave() {
    if (!canSave) return;
    const depCode = departureCode.trim().toUpperCase();
    const arrCode = arrivalCode.trim().toUpperCase();
    if (!depCode || !arrCode || depCode === arrCode) return;

    const departure =
      airports.find((airport) => airport.code.toUpperCase() === depCode) ??
      ({ code: depCode } satisfies TripFlightAirport);
    const arrival =
      airports.find((airport) => airport.code.toUpperCase() === arrCode) ??
      ({ code: arrCode } satisfies TripFlightAirport);

    const directionLabel = [
      departure.cityName?.trim() || departure.code,
      arrival.cityName?.trim() || arrival.code,
    ].join(" → ");

    setSaving(true);
    try {
      const next: TripFlightEssential = {
        id: editing?.id?.trim() || crypto.randomUUID(),
        routeLabel: directionLabel,
        ...(departure.cityName ? { fromCityName: departure.cityName } : {}),
        ...(arrival.cityName ? { toCityName: arrival.cityName } : {}),
        departure: toTripFlightAirport(departure),
        arrival: toTripFlightAirport(arrival),
        routeAirports: [
          toTripFlightAirport(departure),
          toTripFlightAirport(arrival),
        ],
        departureAirport: departure.code,
        arrivalAirport: arrival.code,
        ...(fromDatetimeLocalValue(departureAt)
          ? { departureAt: fromDatetimeLocalValue(departureAt) }
          : {}),
        ...(fromDatetimeLocalValue(arrivalAt)
          ? { arrivalAt: fromDatetimeLocalValue(arrivalAt) }
          : {}),
        ...(normalizeUrl(bookingLink)
          ? { bookingLink: normalizeUrl(bookingLink) }
          : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };

      const nextItems = editingId
        ? items.some((item) => item.id === editingId)
          ? items.map((item) => (item.id === editingId ? next : item))
          : [...items, next]
        : [...items, next];
      await onSaveAll(nextItems);
      setView("list");
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: string) {
    setSaving(true);
    try {
      await onSaveAll(items.filter((item) => item.id !== id));
    } finally {
      setSaving(false);
    }
  }

  const formTitle = editing ? "Edit flight" : "Add flight";
  const formDescription = editing
    ? "Update this one-way flight for your trip."
    : "Add your flight details for this trip.";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={view === "form" ? formTitle : "Flights"}
      description={
        view === "form"
          ? formDescription
          : "Add and manage your flights for this trip"
      }
      leading={
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-tint text-primary">
          <Plane className="h-5 w-5" aria-hidden />
        </span>
      }
      size="lg"
      className={ESSENTIALS_SHEET_CLASS}
      bodyClassName={view === "form" ? "pb-5" : undefined}
    >
      {view === "list" ? (
        <div className="space-y-4">
          {items.length > 0 ? (
            <ul className="space-y-2.5">
              {items.map((flight) => {
                const kind = classifyFlight(
                  flight,
                  routeCities,
                  directionAirports
                );
                const kindUi = FLIGHT_KIND_UI[kind];
                const label =
                  flight.routeLabel?.trim() ||
                  [flight.fromCityName, flight.toCityName]
                    .filter(Boolean)
                    .join(" → ") ||
                  routeLabel ||
                  "Flight";
                const codes = [
                  flightAirportCode(flight, "departure"),
                  flightAirportCode(flight, "arrival"),
                ].filter(Boolean);
                const when = flight.departureAt?.trim()
                  ? formatFlightWhen(flight.departureAt)
                  : "";
                const detail = [codes.join(" → "), when]
                  .filter(Boolean)
                  .join(" · ");
                const menuOpen = menuOpenId === flight.id;

                return (
                  <li key={flight.id}>
                    <div className="relative flex items-center gap-3 rounded-2xl border border-border bg-white p-3.5">
                      <button
                        type="button"
                        onClick={() => startEdit(flight)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <span
                          className={cx(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                            kindUi.iconWrap,
                            kindUi.icon
                          )}
                        >
                          <PlaneTakeoff className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-text">
                            {label}
                          </span>
                          {detail ? (
                            <span className="mt-0.5 block truncate text-xs text-text-secondary">
                              {detail}
                            </span>
                          ) : null}
                        </span>
                        <span
                          className={cx(
                            "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                            kindUi.badge
                          )}
                        >
                          {kindUi.label}
                        </span>
                      </button>

                      <div className="relative shrink-0">
                        <button
                          type="button"
                          aria-label="Flight options"
                          aria-expanded={menuOpen}
                          disabled={saving}
                          onClick={(event) => {
                            event.stopPropagation();
                            setMenuOpenId(menuOpen ? null : flight.id);
                          }}
                          className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text disabled:opacity-50"
                        >
                          <MoreVertical className="h-4 w-4" aria-hidden />
                        </button>
                        {menuOpen ? (
                          <div
                            role="menu"
                            className="absolute right-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-xl border border-border bg-white py-1 shadow-[0_12px_32px_rgba(17,24,39,0.12)]"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              role="menuitem"
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-surface"
                              onClick={() => {
                                setMenuOpenId(null);
                                startEdit(flight);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5 text-text-muted" />
                              Edit
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-error hover:bg-error-background"
                              onClick={() => {
                                setMenuOpenId(null);
                                void handleRemove(flight.id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Remove
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-text-secondary">
              No flights yet. Add outbound and return as separate one-way
              flights.
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" variant="primary" icon={Plus} onClick={startAdd}>
              Add flight
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className={ESSENTIALS_FORM_STACK}>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-3">
            <EssentialsField label="From (airport)">
              <SearchableSelect
                value={departureCode}
                onChange={selectDeparture}
                options={departureOptions}
                placeholder={
                  resolvingAirports ? "Loading…" : "Select departure"
                }
                searchPlaceholder="Search code or city"
                disabled={resolvingAirports || departureOptions.length === 0}
                leadingIcon={Plane}
                triggerLayout="stacked"
              />
            </EssentialsField>
            <EssentialsField label="To (airport)">
              <SearchableSelect
                value={arrivalCode}
                onChange={selectArrival}
                options={arrivalOptions}
                placeholder={
                  resolvingAirports ? "Loading…" : "Select arrival"
                }
                searchPlaceholder="Search code or city"
                disabled={
                  resolvingAirports ||
                  arrivalOptions.length === 0 ||
                  !departureCode
                }
                leadingIcon={Plane}
                triggerLayout="stacked"
              />
            </EssentialsField>
          </div>

          {sameAirportSelected ? (
            <p className="-mt-1.5 text-xs text-error">
              From and To must be different — each flight is one direction
              (outbound or return).
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-3">
            <FlightDatetimeField
              id={departureAtId}
              label="Departure"
              value={departureAt}
              onChange={setDepartureAt}
            />
            <FlightDatetimeField
              id={arrivalAtId}
              label="Arrival"
              value={arrivalAt}
              onChange={setArrivalAt}
            />
          </div>

          <EssentialsField label="Booking link" htmlFor={linkId}>
            <TextInput
              id={linkId}
              icon={Link2}
              value={bookingLink}
              onChange={(event) => setBookingLink(event.target.value)}
              placeholder="https://…"
              inputMode="url"
              className="!shadow-none"
            />
          </EssentialsField>

          <div className="min-w-0">
            <label
              htmlFor={notesId}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary"
            >
              <FileText className="h-3.5 w-3.5" aria-hidden />
              Notes (optional)
            </label>
            <div className="relative mt-1.5">
              <FileText
                className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-text-muted"
                aria-hidden
              />
              <textarea
                id={notesId}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                placeholder="Seat, confirmation code, baggage…"
                className="block w-full resize-y rounded-xl border border-border bg-white py-2.5 pl-9 pr-3 text-sm leading-relaxed text-text outline-none transition-colors placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          {airportOptions.length < 2 && !resolvingAirports ? (
            <div className="flex items-start gap-2.5 rounded-xl bg-primary-tint px-3.5 py-3 text-sm text-primary">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                Need at least two airport codes on this trip to add a flight.
              </p>
            </div>
          ) : !sameAirportSelected ? (
            <div className="flex items-start gap-2.5 rounded-xl bg-primary-tint px-3.5 py-3 text-sm text-primary">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>One direction only — add a second flight for the return.</p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              variant="primary"
              icon={Plane}
              onClick={() => void handleSave()}
              disabled={!canSave || saving}
              loading={saving}
              className="min-w-[7.5rem]"
            >
              Save
            </Button>
            <Button type="button" variant="secondary" onClick={backToList}>
              {items.length === 0 ? "Cancel" : "Back"}
            </Button>
            {editing ? (
              <Button
                type="button"
                variant="secondary"
                icon={Trash2}
                className="ml-auto !text-error"
                disabled={saving}
                onClick={() => {
                  void handleRemove(editing.id).then(() => {
                    setView("list");
                    setEditingId(null);
                  });
                }}
              >
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </Sheet>
  );
}
