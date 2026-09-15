"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BedDouble,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Stamp,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Button, TextInput } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { TravelMap } from "@/features/map/TravelMap";
import {
  searchPlacesByName,
  type SearchedPlace,
} from "@/features/add-place/placeSearch";
import { listTravelDocuments } from "@/lib/documents";
import { reverseGeocode } from "@/lib/maps";
import { cx } from "@/lib/utils";
import {
  TRAVEL_DOCUMENT_KIND_LABELS,
  type TravelDocument,
} from "@/types/travel-document";
import type {
  TripAccommodation,
  TripDocumentDetails,
  TripPlannerDoc,
  TripVisaDetails,
  TripVisaStatus,
} from "@/types/trip-planner";
import { resolveAccommodationLocation } from "./resolveAccommodationLocation";

const VISA_STATUS_OPTIONS: Array<{ value: TripVisaStatus; label: string }> = [
  { value: "unknown", label: "Not sure yet" },
  { value: "not_needed", label: "Not needed" },
  { value: "not_started", label: "Not started" },
  { value: "applied", label: "Applied" },
  { value: "approved", label: "Approved" },
];

type AccommodationMode = "link" | "map";

interface TripEssentialsSectionProps {
  trip: TripPlannerDoc;
  userId: string;
  onUpdateAccommodation: (value: TripAccommodation | null) => Promise<void>;
  onUpdateDocuments: (value: TripDocumentDetails | null) => Promise<void>;
  onUpdateVisa: (value: TripVisaDetails | null) => Promise<void>;
}

export function TripEssentialsSection({
  trip,
  userId,
  onUpdateAccommodation,
  onUpdateDocuments,
  onUpdateVisa,
}: TripEssentialsSectionProps) {
  const [accommodationOpen, setAccommodationOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [visaOpen, setVisaOpen] = useState(false);

  const accommodation =
    trip.tripEssentials?.accommodation?.[0] ??
    trip.preparation.accommodation ??
    null;
  const documents = trip.preparation.documents ?? null;
  const visa = trip.preparation.visa ?? null;

  const visaHint =
    trip.cityIntelligence.result?.visaRequirements?.summary ||
    trip.cityIntelligence.result?.details?.visa?.description ||
    null;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-text">Trip essentials</h3>
        <p className="mt-0.5 text-sm text-text-secondary">
          Save where you are staying, travel documents, and visa details.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <EssentialCard
          icon={BedDouble}
          title="Accommodation"
          empty={
            !accommodation?.name &&
            !accommodation?.link &&
            !accommodation?.address
          }
          onEdit={() => setAccommodationOpen(true)}
          summary={
            accommodation ? (
              <AccommodationSummary value={accommodation} />
            ) : (
              "Add a booking link or pick a place on the map."
            )
          }
        />
        <EssentialCard
          icon={FileText}
          title="Documents"
          empty={!hasDocumentDetails(documents)}
          onEdit={() => setDocumentsOpen(true)}
          summary={
            documents && hasDocumentDetails(documents) ? (
              <DocumentsSummary value={documents} userId={userId} />
            ) : (
              "Track passport, ID, and docs for this trip."
            )
          }
        />
        <EssentialCard
          icon={Stamp}
          title="Visa"
          empty={
            !visa ||
            (visa.status === "unknown" &&
              !visa.type &&
              !visa.notes &&
              !visa.applicationLink)
          }
          onEdit={() => setVisaOpen(true)}
          summary={
            visa &&
            (visa.status !== "unknown" ||
              visa.type ||
              visa.notes ||
              visa.applicationLink) ? (
              <VisaSummary value={visa} />
            ) : (
              <p className="line-clamp-3">
                {visaHint || "Add visa status, type, and application notes."}
              </p>
            )
          }
        />
      </div>

      <AccommodationSheet
        open={accommodationOpen}
        onClose={() => setAccommodationOpen(false)}
        trip={trip}
        initial={accommodation}
        onSave={async (value) => {
          await onUpdateAccommodation(value);
          setAccommodationOpen(false);
        }}
        onClear={async () => {
          await onUpdateAccommodation(null);
          setAccommodationOpen(false);
        }}
      />

      <DocumentsSheet
        open={documentsOpen}
        onClose={() => setDocumentsOpen(false)}
        userId={userId}
        initial={documents}
        onSave={async (value) => {
          await onUpdateDocuments(value);
          setDocumentsOpen(false);
        }}
        onClear={async () => {
          await onUpdateDocuments(null);
          setDocumentsOpen(false);
        }}
      />

      <VisaSheet
        open={visaOpen}
        onClose={() => setVisaOpen(false)}
        initial={visa}
        hint={visaHint}
        destinationCountry={trip.destination.countryName}
        onSave={async (value) => {
          await onUpdateVisa(value);
          setVisaOpen(false);
        }}
        onClear={async () => {
          await onUpdateVisa(null);
          setVisaOpen(false);
        }}
      />
    </section>
  );
}

function EssentialCard({
  icon: Icon,
  title,
  summary,
  empty,
  onEdit,
}: {
  icon: LucideIcon;
  title: string;
  summary: ReactNode;
  empty: boolean;
  onEdit: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEdit();
        }
      }}
      className="flex h-full cursor-pointer flex-col rounded-2xl border border-border bg-surface-elevated p-4 text-left shadow-sm transition-colors hover:border-primary/30"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-tint text-primary">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
          {empty ? (
            <>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add
            </>
          ) : (
            <>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              Edit
            </>
          )}
        </span>
      </div>
      <p className="mt-3 text-sm font-semibold text-text">{title}</p>
      <div
        className={cx(
          "mt-1 text-xs leading-relaxed",
          empty ? "text-text-muted" : "text-text-secondary"
        )}
      >
        {summary}
      </div>
    </div>
  );
}

function AccommodationSummary({ value }: { value: TripAccommodation }) {
  return (
    <div className="space-y-1">
      {value.name ? (
        <p className="font-medium text-text">{value.name}</p>
      ) : null}
      {value.address ? <p className="truncate">{value.address}</p> : null}
      {value.link ? (
        <p className="inline-flex items-center gap-1 text-primary">
          <Link2 className="h-3 w-3" aria-hidden />
          Booking link saved
        </p>
      ) : null}
    </div>
  );
}

function DocumentsSummary({
  value,
  userId,
}: {
  value: TripDocumentDetails;
  userId: string;
}) {
  const linked = value.linkedDocumentIds?.length ?? 0;
  const ready = [
    value.passportReady ? "Passport" : null,
    value.idReady ? "ID" : null,
    value.insuranceReady ? "Insurance" : null,
  ].filter(Boolean);

  const docs = linked > 0 ? listTravelDocuments(userId) : [];
  const linkedLabels = docs
    .filter((d) => value.linkedDocumentIds?.includes(d.id))
    .map((d) => d.label.trim() || TRAVEL_DOCUMENT_KIND_LABELS[d.kind])
    .slice(0, 2);

  return (
    <div className="space-y-1">
      {ready.length > 0 ? <p>Ready: {ready.join(", ")}</p> : null}
      {linkedLabels.length > 0 ? (
        <p>
          Linked: {linkedLabels.join(", ")}
          {linked > linkedLabels.length
            ? ` +${linked - linkedLabels.length}`
            : ""}
        </p>
      ) : null}
      {value.notes?.trim() ? (
        <p className="line-clamp-2">{value.notes.trim()}</p>
      ) : null}
    </div>
  );
}

function VisaSummary({ value }: { value: TripVisaDetails }) {
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const status =
    VISA_STATUS_OPTIONS.find((o) => o.value === value.status)?.label ??
    value.status;
  const type = value.type?.trim() || "";
  const notes = value.notes?.trim() || "";
  const applicationLink = value.applicationLink;

  useEffect(() => {
    setExpanded(false);
  }, [applicationLink, notes, status, type]);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || expanded) return;

    const measure = () => {
      setCanExpand(el.scrollHeight > el.clientHeight + 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [applicationLink, expanded, notes, status, type]);

  return (
    <div className="flex items-start gap-1">
      <div
        ref={textRef}
        className={cx(
          "min-w-0 flex-1",
          expanded ? "space-y-1" : "line-clamp-3"
        )}
      >
        <p className="font-medium text-text">{status}</p>
        {type ? <p>{type}</p> : null}
        {applicationLink ? (
          <p className="inline-flex items-center gap-1 text-primary">
            <ExternalLink className="h-3 w-3" aria-hidden />
            Application link
          </p>
        ) : null}
        {notes ? <p>{notes}</p> : null}
      </div>
      {canExpand ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse visa details" : "Expand visa details"}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((current) => !current);
          }}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface hover:text-text"
        >
          <ChevronDown
            className={cx(
              "h-3.5 w-3.5 transition-transform duration-200",
              expanded && "rotate-180"
            )}
            aria-hidden
          />
        </button>
      ) : null}
    </div>
  );
}

function hasDocumentDetails(value: TripDocumentDetails | null): boolean {
  if (!value) return false;
  return Boolean(
    value.notes?.trim() ||
      value.passportReady ||
      value.idReady ||
      value.insuranceReady ||
      (value.linkedDocumentIds && value.linkedDocumentIds.length > 0)
  );
}

function normalizeUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function AccommodationSheet({
  open,
  onClose,
  trip,
  initial,
  onSave,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  trip: TripPlannerDoc;
  initial: TripAccommodation | null;
  onSave: (value: TripAccommodation) => Promise<void>;
  onClear: () => Promise<void>;
}) {
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchedPlace[]>([]);
  const [mapResolving, setMapResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameId = useId();
  const linkId = useId();

  useEffect(() => {
    if (!open) return;
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
    setSearchQuery("");
    setResults([]);
  }, [open, initial]);

  useEffect(() => {
    if (!open || mode !== "map") return;
    const q = searchQuery.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchPlacesByName(
        `${q} hotel ${trip.destination.cityName}`.trim()
      )
        .then((places) => {
          if (!cancelled) setResults(places);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, mode, searchQuery, trip.destination.cityName]);

  const mapMarkers = useMemo(() => {
    if (lat == null || lon == null) {
      if (trip.destination.lat != null && trip.destination.lon != null) {
        return [
          {
            id: "__destination__",
            lat: trip.destination.lat,
            lon: trip.destination.lon,
            title: trip.destination.cityName,
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
  }, [lat, lon, name, trip.destination]);

  const canSave =
    Boolean(name.trim()) ||
    Boolean(link.trim()) ||
    Boolean(address.trim()) ||
    (lat != null && lon != null);

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

  function pickSearchResult(place: SearchedPlace) {
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

      // Link mode (and map without a pin yet) — best-effort resolve coords.
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
          destinationCity: trip.destination.cityName,
          destinationCountry: trip.destination.countryName,
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

      const payload: TripAccommodation = {
        id: initial?.id || crypto.randomUUID(),
        name: name.trim() || undefined,
        link: normalizeUrl(link),
        address: nextAddress,
        placeId: nextPlaceId,
        lat: nextLat,
        lon: nextLon,
        cityName: nextCityName,
        countryName: nextCountryName,
        notes: notes.trim() || undefined,
        source: nextSource,
      };
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Accommodation" size="lg">
      <div className="space-y-4">
        <div className="flex gap-4 border-b border-divider">
          {(
            [
              { id: "link" as const, label: "Booking link" },
              { id: "map" as const, label: "On map" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMode(tab.id)}
              className={cx(
                "relative -mb-px pb-2.5 text-sm font-medium transition-colors",
                mode === tab.id
                  ? "text-primary"
                  : "text-text-secondary hover:text-text"
              )}
            >
              {tab.label}
              {mode === tab.id ? (
                <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />
              ) : null}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div>
            <label
              htmlFor={nameId}
              className="text-xs font-medium text-text-secondary"
            >
              Place name
            </label>
            <TextInput
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Hotel, apartment, hostel…"
              className="mt-1.5"
            />
          </div>

          {mode === "link" ? (
            <div>
              <label
                htmlFor={linkId}
                className="text-xs font-medium text-text-secondary"
              >
                Booking link
              </label>
              <TextInput
                id={linkId}
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://booking.com/…"
                inputMode="url"
                className="mt-1.5"
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <TextInput
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search stays in ${trip.destination.cityName}`}
                  className="!pl-9"
                />
              </div>
              {searching ? (
                <p className="text-xs text-text-muted">Searching…</p>
              ) : null}
              {results.length > 0 ? (
                <ul className="max-h-36 space-y-1 overflow-y-auto">
                  {results.map((place) => (
                    <li key={place.placeId}>
                      <button
                        type="button"
                        onClick={() => pickSearchResult(place)}
                        className="flex w-full items-start gap-2 rounded-xl border border-transparent px-3 py-2 text-left hover:border-primary/25 hover:bg-surface"
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

              <div className="overflow-hidden rounded-2xl border border-border">
                <div className="border-b border-divider bg-primary-tint px-3 py-2 text-xs font-medium text-primary">
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
            <label className="text-xs font-medium text-text-secondary">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Check-in time, confirmation code, host notes…"
              className="mt-1.5 block w-full rounded-xl border border-border bg-surface-elevated px-3 py-2.5 text-sm text-text shadow-sm outline-none transition-colors placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave || saving}
            className="min-w-[7rem]"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {initial ? (
            <Button
              type="button"
              variant="secondary"
              icon={Trash2}
              className="ml-auto !text-error"
              onClick={() => void onClear()}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}

function DocumentsSheet({
  open,
  onClose,
  userId,
  initial,
  onSave,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  initial: TripDocumentDetails | null;
  onSave: (value: TripDocumentDetails) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [notes, setNotes] = useState("");
  const [passportReady, setPassportReady] = useState(false);
  const [idReady, setIdReady] = useState(false);
  const [insuranceReady, setInsuranceReady] = useState(false);
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [docs, setDocs] = useState<TravelDocument[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNotes(initial?.notes ?? "");
    setPassportReady(Boolean(initial?.passportReady));
    setIdReady(Boolean(initial?.idReady));
    setInsuranceReady(Boolean(initial?.insuranceReady));
    setLinkedIds(initial?.linkedDocumentIds ?? []);
    setDocs(listTravelDocuments(userId));
  }, [open, initial, userId]);

  function toggleLinked(id: string) {
    setLinkedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        notes: notes.trim() || undefined,
        passportReady: passportReady || undefined,
        idReady: idReady || undefined,
        insuranceReady: insuranceReady || undefined,
        linkedDocumentIds: linkedIds.length > 0 ? linkedIds : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Documents" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Track what you need for this trip. Passport numbers and IDs stay in{" "}
          <span className="font-medium text-text">My Documents</span> on this
          device only.
        </p>

        <div className="space-y-2">
          <ReadyToggle
            label="Passport ready"
            checked={passportReady}
            onChange={setPassportReady}
          />
          <ReadyToggle
            label="ID / travel document ready"
            checked={idReady}
            onChange={setIdReady}
          />
          <ReadyToggle
            label="Travel insurance docs ready"
            checked={insuranceReady}
            onChange={setInsuranceReady}
          />
        </div>

        <div>
          <p className="text-xs font-medium text-text-secondary">
            Link from My Documents
          </p>
          {docs.length === 0 ? (
            <p className="mt-2 rounded-xl bg-surface px-3 py-3 text-sm text-text-muted">
              No documents on this device yet. Add them from Profile → My
              Documents.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {docs.map((doc) => {
                const selected = linkedIds.includes(doc.id);
                const title =
                  doc.label.trim() || TRAVEL_DOCUMENT_KIND_LABELS[doc.kind];
                return (
                  <li key={doc.id}>
                    <button
                      type="button"
                      onClick={() => toggleLinked(doc.id)}
                      className={cx(
                        "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                        selected
                          ? "border-primary bg-primary-tint"
                          : "border-border hover:border-primary/30"
                      )}
                    >
                      <span
                        className={cx(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                          selected
                            ? "border-primary bg-primary text-white"
                            : "border-border bg-white"
                        )}
                      >
                        {selected ? (
                          <Check className="h-3 w-3" strokeWidth={3} />
                        ) : null}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-text">
                          {title}
                        </span>
                        <span className="text-xs text-text-secondary">
                          {TRAVEL_DOCUMENT_KIND_LABELS[doc.kind]}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <label className="text-xs font-medium text-text-secondary">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Copies needed, embassy appointments, packing reminders…"
            className="mt-1.5 block w-full rounded-xl border border-border bg-surface-elevated px-3 py-2.5 text-sm text-text shadow-sm outline-none transition-colors placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="min-w-[7rem]"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {initial && hasDocumentDetails(initial) ? (
            <Button
              type="button"
              variant="secondary"
              icon={Trash2}
              className="ml-auto !text-error"
              onClick={() => void onClear()}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}

function ReadyToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface-elevated px-3 py-3 text-left transition-colors hover:border-primary/30"
    >
      <span
        className={cx(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
          checked
            ? "border-primary bg-primary text-white"
            : "border-border bg-white"
        )}
      >
        {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
      </span>
      <span className="text-sm font-medium text-text">{label}</span>
    </button>
  );
}

function VisaSheet({
  open,
  onClose,
  initial,
  hint,
  destinationCountry,
  onSave,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  initial: TripVisaDetails | null;
  hint: string | null;
  destinationCountry: string;
  onSave: (value: TripVisaDetails) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [status, setStatus] = useState<TripVisaStatus>("unknown");
  const [type, setType] = useState("");
  const [applicationLink, setApplicationLink] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const typeId = useId();
  const linkId = useId();

  useEffect(() => {
    if (!open) return;
    setStatus(initial?.status ?? "unknown");
    setType(initial?.type ?? "");
    setApplicationLink(initial?.applicationLink ?? "");
    setNotes(initial?.notes ?? "");
  }, [open, initial]);

  const hasContent =
    status !== "unknown" ||
    Boolean(type.trim()) ||
    Boolean(applicationLink.trim()) ||
    Boolean(notes.trim());

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        status,
        type: type.trim() || undefined,
        applicationLink: normalizeUrl(applicationLink),
        notes: notes.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Visa details" size="lg">
      <div className="space-y-4">
        {hint ? (
          <div className="rounded-xl bg-primary-tint px-3 py-2.5 text-xs leading-relaxed text-primary">
            For {destinationCountry}: {hint}
          </div>
        ) : null}

        <div>
          <p className="text-xs font-medium text-text-secondary">Status</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {VISA_STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setStatus(option.value)}
                className={cx(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  status === option.value
                    ? "border-primary bg-primary-tint text-primary"
                    : "border-border bg-white text-text-secondary hover:border-primary/30"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label
            htmlFor={typeId}
            className="text-xs font-medium text-text-secondary"
          >
            Visa type
          </label>
          <TextInput
            id={typeId}
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="Tourist, eVisa, transit…"
            className="mt-1.5"
          />
        </div>

        <div>
          <label
            htmlFor={linkId}
            className="text-xs font-medium text-text-secondary"
          >
            Application / official link
          </label>
          <TextInput
            id={linkId}
            value={applicationLink}
            onChange={(e) => setApplicationLink(e.target.value)}
            placeholder="https://…"
            inputMode="url"
            className="mt-1.5"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-text-secondary">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Appointment dates, embassy contacts, supporting docs…"
            className="mt-1.5 block w-full rounded-xl border border-border bg-surface-elevated px-3 py-2.5 text-sm text-text shadow-sm outline-none transition-colors placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !hasContent}
            className="min-w-[7rem]"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {initial &&
          (initial.status !== "unknown" ||
            initial.type ||
            initial.notes ||
            initial.applicationLink) ? (
            <Button
              type="button"
              variant="secondary"
              icon={Trash2}
              className="ml-auto !text-error"
              onClick={() => void onClear()}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}
