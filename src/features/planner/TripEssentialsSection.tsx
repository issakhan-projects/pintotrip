"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BedDouble,
  CalendarDays,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Pencil,
  Plane,
  Plus,
  Save,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Button, TextInput } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { listTravelDocuments } from "@/lib/documents";
import { cx } from "@/lib/utils";
import {
  TRAVEL_DOCUMENT_KIND_LABELS,
  type TravelDocument,
} from "@/types/travel-document";
import type {
  TripAccommodation,
  TripDocumentDetails,
  TripFlightAirport,
  TripFlightEssential,
  TripPlannerDoc,
  TripVisaDetails,
  TripVisaStatus,
} from "@/types/trip-planner";
import { AccommodationSheet } from "./AccommodationSheet";
import { FlightSheet } from "./FlightSheet";
import {
  flightAirportCode,
  formatFlightWhen,
  formatStayDates,
  listTripAccommodations,
  normalizeUrl,
} from "./essentialsHelpers";
import { listFlightRouteCities, flightRouteLabel, primaryTripDestination } from "./tripDestinations";

const VISA_STATUS_OPTIONS: Array<{ value: TripVisaStatus; label: string }> = [
  { value: "unknown", label: "Not sure yet" },
  { value: "not_needed", label: "Not needed" },
  { value: "not_started", label: "Not started" },
  { value: "applied", label: "Applied" },
  { value: "approved", label: "Approved" },
];

interface TripEssentialsSectionProps {
  trip: TripPlannerDoc;
  userId: string;
  onUpdateAccommodations: (items: TripAccommodation[]) => Promise<void>;
  onUpdateFlights: (items: TripFlightEssential[]) => Promise<void>;
  onUpdateRouteAirports: (
    airports: TripFlightAirport[],
    key: string
  ) => Promise<void>;
  onUpdateDocuments: (value: TripDocumentDetails | null) => Promise<void>;
  onUpdateVisa: (value: TripVisaDetails | null) => Promise<void>;
}

export function TripEssentialsSection({
  trip,
  userId,
  onUpdateAccommodations,
  onUpdateFlights,
  onUpdateRouteAirports,
  onUpdateDocuments,
  onUpdateVisa,
}: TripEssentialsSectionProps) {
  const [accommodationOpen, setAccommodationOpen] = useState(false);
  const [flightOpen, setFlightOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [visaOpen, setVisaOpen] = useState(false);

  const accommodations = listAccommodations(trip);
  const flights = listFlights(trip);
  const documents = trip.preparation.documents ?? null;
  const visa = trip.preparation.visa ?? null;

  const visaHint =
    trip.cityIntelligence.results?.[0]?.visa?.description || null;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-text">Trip essentials</h3>
        <p className="mt-0.5 text-sm text-text-secondary">
          Save flights, where you are staying, and travel documents.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <EssentialCard
          icon={Plane}
          title="Flight"
          empty={flights.length === 0}
          onEdit={() => setFlightOpen(true)}
          summary={
            flights.length > 0 ? (
              <FlightsSummary items={flights} trip={trip} />
            ) : (
              "Add flights for your trip route."
            )
          }
        />
        <EssentialCard
          icon={BedDouble}
          title="Accommodation"
          empty={accommodations.length === 0}
          onEdit={() => setAccommodationOpen(true)}
          summary={
            accommodations.length > 0 ? (
              <AccommodationsSummary items={accommodations} />
            ) : (
              "Add one or more stays — dates optional."
            )
          }
        />
        {/* <EssentialCard
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
        /> */}
      </div>

      <FlightSheet
        open={flightOpen}
        onClose={() => setFlightOpen(false)}
        trip={trip}
        items={flights}
        onSaveAll={async (items) => {
          await onUpdateFlights(items);
        }}
        onSaveRouteAirports={onUpdateRouteAirports}
      />

      <AccommodationSheet
        open={accommodationOpen}
        onClose={() => setAccommodationOpen(false)}
        trip={trip}
        items={accommodations}
        onSaveAll={async (items) => {
          await onUpdateAccommodations(items);
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
        destinationCountry={primaryTripDestination(trip).countryName}
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

function listAccommodations(trip: TripPlannerDoc): TripAccommodation[] {
  return listTripAccommodations(trip);
}

function AccommodationsSummary({ items }: { items: TripAccommodation[] }) {
  const visible = items.slice(0, 2);
  return (
    <div className="space-y-2">
      {visible.map((stay) => {
        const dates = formatStayDates(stay.startDate, stay.endDate);
        return (
          <div key={stay.id ?? stay.name ?? stay.link} className="space-y-0.5">
            <p className="font-medium text-text">
              {stay.name?.trim() || stay.address?.trim() || "Stay"}
            </p>
            {dates ? (
              <p className="inline-flex items-center gap-1">
                <CalendarDays className="h-3 w-3" aria-hidden />
                {dates}
              </p>
            ) : stay.address ? (
              <p className="truncate">{stay.address}</p>
            ) : stay.link ? (
              <p className="inline-flex items-center gap-1 text-primary">
                <Link2 className="h-3 w-3" aria-hidden />
                Booking link
              </p>
            ) : null}
          </div>
        );
      })}
      {items.length > 2 ? (
        <p className="text-text-muted">+{items.length - 2} more</p>
      ) : items.length > 1 ? (
        <p className="text-text-muted">
          {items.length} stay{items.length === 1 ? "" : "s"}
        </p>
      ) : null}
    </div>
  );
}

function listFlights(_trip: TripPlannerDoc): TripFlightEssential[] {
  return [];
}

function FlightsSummary({
  items,
  trip,
}: {
  items: TripFlightEssential[];
  trip: TripPlannerDoc;
}) {
  const routeCities = listFlightRouteCities(trip);
  const fallbackRoute = flightRouteLabel(routeCities);
  const visible = items.slice(0, 2);

  return (
    <div className="space-y-2">
      {visible.map((flight) => {
        const route =
          flight.routeLabel?.trim() ||
          [flight.fromCityName, flight.toCityName].filter(Boolean).join(" → ") ||
          fallbackRoute;
        const codes = [
          flightAirportCode(flight, "departure"),
          flightAirportCode(flight, "arrival"),
        ].filter(Boolean);
        return (
          <div key={flight.id} className="space-y-0.5">
            {route ? <p className="font-medium text-text">{route}</p> : null}
            {codes.length > 0 ? <p>{codes.join(" → ")}</p> : null}
            {flight.departureAt?.trim() ? (
              <p className="truncate">{formatFlightWhen(flight.departureAt)}</p>
            ) : null}
            {flight.bookingLink ? (
              <p className="inline-flex items-center gap-1 text-primary">
                <Link2 className="h-3 w-3" aria-hidden />
                Booking link
              </p>
            ) : null}
          </div>
        );
      })}
      {items.length > 2 ? (
        <p className="text-text-muted">+{items.length - 2} more</p>
      ) : items.length > 1 ? (
        <p className="text-text-muted">
          {items.length} flight{items.length === 1 ? "" : "s"}
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
            icon={Save}
            color="primary"
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
              color="error"
              className="ml-auto"
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
