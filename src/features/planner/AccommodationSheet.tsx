"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  BedDouble,
  CalendarDays,
  ChevronDown,
  ExternalLink,
  FileText,
  Info,
  Link2,
  MapPin,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Button, DateRangePicker, TextInput, type DateRangeValue } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { TravelMap } from "@/features/map/TravelMap";
import { reverseGeocode } from "@/lib/maps";
import { cx } from "@/lib/utils";
import type { TripAccommodation, TripPlannerDoc } from "@/types/trip-planner";
import { primaryTripDestination } from "./tripDestinations";
import {
  hotelNameFromBookingUrl,
  resolveAccommodationLocation,
  searchAccommodationByGeocode,
  type AccommodationSearchResult,
} from "./resolveAccommodationLocation";
import {
  ESSENTIALS_FORM_STACK,
  ESSENTIALS_SHEET_CLASS,
  EssentialsField,
} from "./essentialsFormUi";
import {
  formatStayDate,
  formatStayDates,
  normalizeUrl,
  parseLocalIsoDate,
  toLocalIsoDate,
} from "./essentialsHelpers";

type AccommodationMode = "link" | "map";

type StayKind = "current" | "upcoming" | "past" | "stay";

function todayLocalIso(): string {
  return toLocalIsoDate(new Date());
}

function classifyStay(stay: TripAccommodation): StayKind {
  const start = stay.startDate?.trim();
  const end = stay.endDate?.trim();
  if (!start || !end) return "stay";
  const today = todayLocalIso();
  if (today >= start && today <= end) return "current";
  if (today < start) return "upcoming";
  return "past";
}

const STAY_KIND_UI: Record<
  StayKind,
  { label: string; badge: string } | null
> = {
  current: {
    label: "Current stay",
    badge: "bg-primary-tint text-primary",
  },
  upcoming: {
    label: "Upcoming",
    badge: "bg-sky-50 text-sky-700",
  },
  past: {
    label: "Past",
    badge: "bg-surface text-text-secondary",
  },
  stay: null,
};

export function AccommodationSheet({
  open,
  onClose,
  trip,
  items,
  onSaveAll,
  /** When true, open directly on the add form instead of the list. */
  startInForm = false,
}: {
  open: boolean;
  onClose: () => void;
  trip: TripPlannerDoc;
  items: TripAccommodation[];
  onSaveAll: (items: TripAccommodation[]) => Promise<void>;
  startInForm?: boolean;
}) {
  const [view, setView] = useState<"list" | "form">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mode, setMode] = useState<AccommodationMode>("link");
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [notes, setNotes] = useState("");
  const [address, setAddress] = useState("");
  const [placeId, setPlaceId] = useState<string | undefined>();
  const [lat, setLat] = useState<number | undefined>();
  const [lon, setLon] = useState<number | undefined>();
  const [cityName, setCityName] = useState<string | undefined>();
  const [countryName, setCountryName] = useState<string | undefined>();
  const [source, setSource] = useState<TripAccommodation["source"]>("link");
  const [dateRange, setDateRange] = useState<DateRangeValue>({});
  const [datesOpen, setDatesOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<AccommodationSearchResult[]>([]);
  const [mapResolving, setMapResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  /** Last place name we auto-filled from a booking link (so edits aren't overwritten). */
  const [autoFilledName, setAutoFilledName] = useState<string | null>(null);
  const nameId = useId();
  const linkId = useId();
  const notesId = useId();
  const primaryDest = primaryTripDestination(trip);

  const editing = editingId
    ? items.find((item) => item.id === editingId) ?? null
    : null;

  function resetForm(initial: TripAccommodation | null) {
    setMode(
      initial?.source === "map" || initial?.source === "search" ? "map" : "link"
    );
    setName(initial?.name ?? "");
    setLink(initial?.link ?? "");
    setNotes(initial?.notes ?? "");
    setAddress(initial?.address ?? "");
    setPlaceId(initial?.placeId);
    setLat(initial?.lat);
    setLon(initial?.lon);
    setCityName(initial?.cityName);
    setCountryName(initial?.countryName);
    setSource(initial?.source ?? "link");
    setDateRange(
      initial?.startDate && initial?.endDate
        ? {
            from: parseLocalIsoDate(initial.startDate),
            to: parseLocalIsoDate(initial.endDate),
          }
        : {}
    );
    setDatesOpen(Boolean(initial?.startDate && initial?.endDate));
    setSearchQuery("");
    setResults([]);
    setAutoFilledName(null);
  }

  function applyNameFromBookingLink(rawLink: string) {
    const derived = hotelNameFromBookingUrl(rawLink);
    if (!derived) return;
    const current = name.trim();
    // Fill when empty, or when the field still holds a previous auto-fill.
    if (!current || (autoFilledName && current === autoFilledName)) {
      setName(derived);
      setAutoFilledName(derived);
    }
  }

  useEffect(() => {
    if (!open) return;
    setMenuOpenId(null);
    if (startInForm || items.length === 0) {
      setEditingId(null);
      resetForm(null);
      setView("form");
    } else {
      setView("list");
      setEditingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when sheet opens
  }, [open, startInForm]);

  useEffect(() => {
    if (!menuOpenId) return;
    const onDoc = () => setMenuOpenId(null);
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [menuOpenId]);

  useEffect(() => {
    if (!open || view !== "form" || mode !== "map") return;
    const q = searchQuery.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchAccommodationByGeocode({
        query: q,
        destinationCity: primaryDest.cityName,
        destinationCountry: primaryDest.countryName,
        countryId: primaryDest.countryId,
      })
        .then((places) => {
          if (!cancelled) setResults(places);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    open,
    view,
    mode,
    searchQuery,
    primaryDest.cityName,
    primaryDest.countryName,
    primaryDest.countryId,
  ]);

  const mapMarkers = useMemo(() => {
    if (lat == null || lon == null) {
      if (primaryDest.lat != null && primaryDest.lon != null) {
        return [
          {
            id: "__destination__",
            lat: primaryDest.lat,
            lon: primaryDest.lon,
            title: primaryDest.cityName,
            kind: "city" as const,
          },
        ];
      }
      return [];
    }
    return [
      {
        id: "__stay__",
        lat,
        lon,
        title: name || "Stay",
        kind: "place" as const,
      },
    ];
  }, [lat, lon, name, primaryDest]);

  const canSave =
    Boolean(name.trim()) ||
    Boolean(link.trim()) ||
    Boolean(address.trim()) ||
    (lat != null && lon != null);

  const stayDatesLabel =
    dateRange.from && dateRange.to
      ? formatStayDates(toLocalIsoDate(dateRange.from), toLocalIsoDate(dateRange.to))
      : "Add stay dates (optional)";

  function startAdd() {
    setEditingId(null);
    resetForm(null);
    setView("form");
  }

  function startEdit(item: TripAccommodation) {
    setEditingId(item.id ?? null);
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

  async function handleMapPick(coords: { lat: number; lng: number }) {
    setMapResolving(true);
    setSource("map");
    setLat(coords.lat);
    setLon(coords.lng);
    setPlaceId(undefined);
    try {
      const place = await reverseGeocode(coords.lat, coords.lng);
      if (place) {
        const label =
          [place.city, place.country].filter(Boolean).join(", ") || undefined;
        setAddress(
          label ?? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
        );
        setCityName(place.city || undefined);
        setCountryName(place.country || undefined);
        if (!name.trim() && place.city) {
          setName(place.city);
        }
      } else {
        setAddress(`${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`);
      }
    } finally {
      setMapResolving(false);
    }
  }

  function pickSearchResult(place: AccommodationSearchResult) {
    setSource("search");
    setName(place.title);
    setAddress(place.address);
    setPlaceId(place.placeId);
    setLat(place.lat);
    setLon(place.lon);
    setCityName(place.cityName);
    setCountryName(place.countryName);
    setSearchQuery(place.title);
    setResults([]);
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      let nextLat = lat;
      let nextLon = lon;
      let nextAddress = address.trim() || undefined;
      let nextPlaceId = placeId?.trim() || undefined;
      let nextCityName = cityName?.trim() || undefined;
      let nextCountryName = countryName?.trim() || undefined;

      const nextSource =
        mode === "link"
          ? ("link" as const)
          : source === "search"
            ? ("search" as const)
            : ("map" as const);

      if (
        (nextLat == null || nextLon == null) &&
        (mode === "link" || Boolean(name.trim()) || Boolean(link.trim()))
      ) {
        const resolved = await resolveAccommodationLocation({
          name: name.trim() || undefined,
          link: normalizeUrl(link),
          lat: nextLat,
          lon: nextLon,
          address: nextAddress,
          placeId: nextPlaceId,
          cityName: nextCityName,
          countryName: nextCountryName,
          destinationCity: primaryDest.cityName,
          destinationCountry: primaryDest.countryName,
          countryId: primaryDest.countryId,
        });
        nextLat = resolved.lat ?? nextLat;
        nextLon = resolved.lon ?? nextLon;
        nextAddress = resolved.address || nextAddress;
        nextPlaceId = resolved.placeId || nextPlaceId;
        nextCityName = resolved.cityName || nextCityName;
        nextCountryName = resolved.countryName || nextCountryName;
        if (resolved.lat != null && resolved.lon != null) {
          setLat(resolved.lat);
          setLon(resolved.lon);
          if (resolved.address) setAddress(resolved.address);
          if (resolved.placeId) setPlaceId(resolved.placeId);
          if (resolved.cityName) setCityName(resolved.cityName);
          if (resolved.countryName) setCountryName(resolved.countryName);
        }
      }

      const id = editing?.id?.trim() || crypto.randomUUID();
      const payload: TripAccommodation = {
        id,
        name: name.trim() || undefined,
        link: normalizeUrl(link),
        address: nextAddress,
        placeId: nextPlaceId,
        lat: nextLat,
        lon: nextLon,
        cityName: nextCityName || primaryDest.cityName || undefined,
        countryName: nextCountryName || primaryDest.countryName || undefined,
        notes: notes.trim() || undefined,
        source: nextSource,
        ...(dateRange.from && dateRange.to
          ? {
              startDate: toLocalIsoDate(dateRange.from),
              endDate: toLocalIsoDate(dateRange.to),
            }
          : {}),
      };

      const withoutCurrent = items.filter((item) => item.id !== id);
      const existingIndex = items.findIndex((item) => item.id === id);
      const nextItems =
        existingIndex >= 0
          ? items.map((item) => (item.id === id ? payload : item))
          : [...items, payload];
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
      if (editingId === id) {
        setView("list");
        setEditingId(null);
      }
    } finally {
      setSaving(false);
    }
  }

  const formTitle = editing ? "Edit stay" : "Add stay";
  const formDescription = editing
    ? "Update this stay for your trip."
    : "Add your accommodation for this trip.";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={view === "form" ? formTitle : "Accommodation"}
      description={
        view === "form"
          ? formDescription
          : "Add and manage your stays for this trip"
      }
      leading={
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-tint text-primary">
          <BedDouble className="h-5 w-5" aria-hidden />
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
              {items.map((stay) => {
                const stayKey = stay.id ?? stay.name ?? stay.address ?? "stay";
                const kind = classifyStay(stay);
                const kindUi = STAY_KIND_UI[kind];
                const title =
                  stay.name?.trim() || stay.address?.trim() || "Stay";
                const checkIn = formatStayDate(stay.startDate);
                const checkOut = formatStayDate(stay.endDate);
                const bookingHref = stay.link
                  ? normalizeUrl(stay.link)
                  : undefined;
                const menuOpen = menuOpenId === stayKey;

                return (
                  <li key={stayKey}>
                    <div className="relative rounded-2xl border border-border bg-white p-3.5">
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => startEdit(stay)}
                          className="flex h-[4.75rem] w-[4.75rem] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary-tint text-primary"
                          aria-label={`Edit ${title}`}
                        >
                          <BedDouble className="h-7 w-7" aria-hidden />
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-2">
                            <button
                              type="button"
                              onClick={() => startEdit(stay)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <span className="block truncate text-sm font-semibold text-text">
                                {title}
                              </span>
                            </button>
                            {kindUi ? (
                              <span
                                className={cx(
                                  "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                                  kindUi.badge
                                )}
                              >
                                {kindUi.label}
                              </span>
                            ) : null}
                            <div className="relative shrink-0">
                              <button
                                type="button"
                                aria-label="Stay options"
                                aria-expanded={menuOpen}
                                disabled={saving}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setMenuOpenId(menuOpen ? null : stayKey);
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
                                      startEdit(stay);
                                    }}
                                  >
                                    <Pencil className="h-3.5 w-3.5 text-text-muted" />
                                    Edit
                                  </button>
                                  {stay.id ? (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-error hover:bg-error-background"
                                      onClick={() => {
                                        setMenuOpenId(null);
                                        void handleRemove(stay.id!);
                                      }}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      Remove
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>

                          {stay.address?.trim() ? (
                            <p className="mt-1 flex items-start gap-1 text-xs leading-snug text-text-secondary">
                              <MapPin
                                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                                aria-hidden
                              />
                              <span className="line-clamp-2">
                                {stay.address.trim()}
                              </span>
                            </p>
                          ) : null}

                          {bookingHref ? (
                            <a
                              href={bookingHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Link2 className="h-3.5 w-3.5" aria-hidden />
                              Booking link
                              <ExternalLink
                                className="h-3 w-3 opacity-80"
                                aria-hidden
                              />
                            </a>
                          ) : null}

                          {checkIn || checkOut ? (
                            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3">
                              <div className="min-w-0 border-r border-border pr-3">
                                <p className="inline-flex items-center gap-1 text-[11px] font-medium text-text-muted">
                                  <CalendarDays
                                    className="h-3 w-3"
                                    aria-hidden
                                  />
                                  Check-in
                                </p>
                                <p className="mt-0.5 text-sm font-medium text-text">
                                  {checkIn ?? "—"}
                                </p>
                              </div>
                              <div className="min-w-0">
                                <p className="inline-flex items-center gap-1 text-[11px] font-medium text-text-muted">
                                  <CalendarDays
                                    className="h-3 w-3"
                                    aria-hidden
                                  />
                                  Check-out
                                </p>
                                <p className="mt-0.5 text-sm font-medium text-text">
                                  {checkOut ?? "—"}
                                </p>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-text-secondary">
              No stays yet. Add a hotel, apartment, or booking link.
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              variant="primary"
              icon={Plus}
              onClick={startAdd}
            >
              Add stay
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className={ESSENTIALS_FORM_STACK}>
          <div
            role="tablist"
            aria-label="Stay input mode"
            className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1"
          >
            {(
              [
                { id: "link" as const, label: "Booking link", Icon: Link2 },
                { id: "map" as const, label: "On map", Icon: MapPin },
              ] as const
            ).map((tab) => {
              const active = mode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setMode(tab.id)}
                  className={cx(
                    "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-white text-primary shadow-sm ring-1 ring-border"
                      : "text-text-secondary hover:text-text"
                  )}
                >
                  <tab.Icon className="h-3.5 w-3.5" aria-hidden />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <EssentialsField label="Place name" htmlFor={nameId}>
            <TextInput
              id={nameId}
              icon={BedDouble}
              value={name}
              onChange={(e) => {
                const next = e.target.value;
                setName(next);
                if (autoFilledName && next.trim() !== autoFilledName) {
                  setAutoFilledName(null);
                }
              }}
              placeholder="Hotel, apartment, hostel…"
              className="!shadow-none"
            />
          </EssentialsField>

          {mode === "link" ? (
            <EssentialsField label="Booking link" htmlFor={linkId}>
              <TextInput
                id={linkId}
                icon={Link2}
                value={link}
                onChange={(e) => {
                  const next = e.target.value;
                  setLink(next);
                  applyNameFromBookingLink(next);
                }}
                onBlur={() => applyNameFromBookingLink(link)}
                placeholder="https://booking.com/…"
                inputMode="url"
                className="!shadow-none"
              />
            </EssentialsField>
          ) : (
            <div className="space-y-3">
              <EssentialsField label="Search on map">
                <TextInput
                  icon={MapPin}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search stays in ${primaryDest.cityName}`}
                  className="!shadow-none"
                />
              </EssentialsField>
              {searching ? (
                <p className="text-xs text-text-muted">Searching…</p>
              ) : null}
              {results.length > 0 ? (
                <ul className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-border bg-white p-1">
                  {results.map((place) => (
                    <li key={place.placeId}>
                      <button
                        type="button"
                        onClick={() => pickSearchResult(place)}
                        className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-primary-tint"
                      >
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-text">
                            {place.title}
                          </span>
                          <span className="block truncate text-xs text-text-secondary">
                            {place.address}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="overflow-hidden rounded-2xl border border-border bg-white">
                <div className="border-b border-border bg-primary-tint px-3 py-2 text-xs font-medium text-primary">
                  {mapResolving
                    ? "Finding address…"
                    : "Tap the map to drop a pin for your stay"}
                </div>
                <div className="h-52">
                  <TravelMap
                    className="h-full w-full"
                    markers={mapMarkers}
                    interactionMode="pick-place"
                    fitToMarkers={mapMarkers.length > 0}
                    centerOnCurrentLocation={false}
                    showCurrentLocation={false}
                    onMapClick={(coords) => {
                      void handleMapPick(coords);
                    }}
                  />
                </div>
              </div>

              {address ? (
                <p className="text-xs text-text-secondary">
                  <span className="font-medium text-text">Address: </span>
                  {address}
                </p>
              ) : null}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                Stay dates
                <span className="font-normal text-text-muted">(optional)</span>
              </p>
              {dateRange.from || dateRange.to ? (
                <button
                  type="button"
                  onClick={() => {
                    setDateRange({});
                    setDatesOpen(false);
                  }}
                  className="text-xs font-medium text-text-muted transition-colors hover:text-text"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setDatesOpen((v) => !v)}
              className={cx(
                "relative mt-1.5 flex w-full min-h-11 items-center gap-2 rounded-xl border border-border bg-white py-2.5 pl-9 pr-9 text-left text-sm transition-colors hover:border-primary/40",
                datesOpen && "border-primary ring-2 ring-primary/20"
              )}
            >
              <CalendarDays
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
                aria-hidden
              />
              <span
                className={cx(
                  "min-w-0 flex-1 truncate",
                  dateRange.from && dateRange.to
                    ? "text-text"
                    : "text-text-muted"
                )}
              >
                {stayDatesLabel}
              </span>
              <ChevronDown
                className={cx(
                  "pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted transition-transform",
                  datesOpen && "rotate-180"
                )}
              />
            </button>
            {datesOpen ? (
              <div className="mt-2">
                <DateRangePicker
                  key={`${dateRange.from?.getTime() ?? 0}-${dateRange.to?.getTime() ?? 0}-${datesOpen}`}
                  value={dateRange}
                  minDate={null}
                  onCancel={() => setDatesOpen(false)}
                  onApply={(next) => {
                    setDateRange(next);
                    setDatesOpen(false);
                  }}
                />
              </div>
            ) : null}
          </div>

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
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Check-in time, confirmation code, host notes…"
                className="block w-full resize-y rounded-xl border border-border bg-white py-2.5 pl-9 pr-3 text-sm leading-relaxed text-text outline-none transition-colors placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-xl bg-primary-tint px-3.5 py-3 text-sm text-primary">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              {mode === "map"
                ? "Drop a pin or search to save the stay location on your trip map."
                : "Stay dates are optional — add them when you know check-in and check-out."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              variant="primary"
              icon={BedDouble}
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
            {editing?.id ? (
              <Button
                type="button"
                variant="secondary"
                icon={Trash2}
                className="ml-auto !text-error"
                disabled={saving}
                onClick={() => void handleRemove(editing.id!)}
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
