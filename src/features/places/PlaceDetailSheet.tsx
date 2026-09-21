"use client";

import { Button, DeleteConfirmModal } from "@/components/ui";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  MapPinned,
  MoreHorizontal,
  NotebookPen,
  Save,
  Share2,
  Trash2,
} from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { SavedLocation } from "@/hooks/useLocations";
import type { LocationStatus } from "@/types/location";
import { PLACE_CATEGORY_LABELS } from "@/types/trip-plan";
import { formatConfidenceCopy, cx } from "@/lib/utils";

interface PlaceDetailSheetProps {
  place: SavedLocation | null;
  open: boolean;
  onClose: () => void;
  onUpdateStatus: (status: LocationStatus) => Promise<void>;
  onSaveNote: (note: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  onViewOnMap?: (place: SavedLocation) => void;
  onOpenCity?: (city: {
    cityName: string;
    countryName: string;
    lat: number;
    lon: number;
  }) => void;
  /**
   * When false (Free / Plus), skip Google Places / Maps photo URLs so the
   * sheet does not trigger Place Photos billing. User uploads and Pexels stay.
   * Pro should pass true.
   */
  allowGooglePlacePhotos?: boolean;
}

/** Billable Place Photos / Maps image hosts — avoid loading on Free/Plus. */
function isGoogleMapsPhotoUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "maps.googleapis.com" ||
      host === "places.googleapis.com" ||
      host.endsWith(".maps.googleapis.com")
    );
  } catch {
    return (
      url.includes("maps.googleapis.com") ||
      url.includes("places.googleapis.com")
    );
  }
}

const STATUSES: LocationStatus[] = ["planned", "visited", "cancelled"];

export function PlaceDetailSheet({
  place,
  open,
  onClose,
  onUpdateStatus,
  onSaveNote,
  onDelete,
  onViewOnMap,
  onOpenCity,
  allowGooglePlacePhotos = false,
}: PlaceDetailSheetProps) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const notePopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNote(place?.note ?? "");
  }, [place]);

  useEffect(() => {
    setStatusMenuOpen(false);
    setMoreMenuOpen(false);
    setNoteOpen(false);
    setDeleting(false);
    setConfirmDeleteOpen(false);
  }, [place?.id, open]);

  useEffect(() => {
    if (!statusMenuOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (!statusMenuRef.current?.contains(event.target as Node)) {
        setStatusMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [statusMenuOpen]);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (!moreMenuRef.current?.contains(event.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [moreMenuOpen]);

  useEffect(() => {
    if (!noteOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (!notePopoverRef.current?.contains(event.target as Node)) {
        setNote(place?.note ?? "");
        setNoteOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [noteOpen, place?.note]);

  if (!place) return null;

  const current = place;
  const images = current.images
    .filter((img) => {
      const url = img.url?.trim();
      if (!url) return false;
      if (!allowGooglePlacePhotos && isGoogleMapsPhotoUrl(url)) return false;
      return true;
    })
    .slice(0, 2);
  const confidence = formatConfidenceCopy(current.confidence);

  async function handleStatus(status: LocationStatus) {
    if (status === current.status) {
      setStatusMenuOpen(false);
      return;
    }
    setStatusBusy(true);
    setStatusMenuOpen(false);
    try {
      await onUpdateStatus(status);
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleNote() {
    setSaving(true);
    try {
      await onSaveNote(note.trim());
      setNoteOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleShare() {
    const text = [
      current.title,
      `${current.city.name}, ${current.country.name}`,
      current.description,
    ]
      .filter(Boolean)
      .join("\n");

    setShareBusy(true);
    try {
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function"
      ) {
        await navigator.share({
          title: current.title,
          text,
        });
        return;
      }
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      /* user cancelled share sheet or clipboard failed */
    } finally {
      setShareBusy(false);
    }
  }

  async function handleConfirmDelete() {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
      setConfirmDeleteOpen(false);
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  const headerActions = (
    <>
      <button
        type="button"
        aria-label="Share"
        disabled={shareBusy}
        onClick={() => void handleShare()}
        className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-surface hover:text-text disabled:opacity-60"
      >
        <Share2 className="h-5 w-5" />
      </button>

      <div ref={moreMenuRef} className="relative">
        <button
          type="button"
          aria-label="More options"
          aria-haspopup="menu"
          aria-expanded={moreMenuOpen}
          onClick={() => {
            setStatusMenuOpen(false);
            setNoteOpen(false);
            setMoreMenuOpen((v) => !v);
          }}
          className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-surface hover:text-text"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
        {moreMenuOpen ? (
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 min-w-[11rem] overflow-hidden rounded-xl border border-border bg-surface-elevated py-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-surface"
              onClick={() => {
                setMoreMenuOpen(false);
                setNote(current.note ?? "");
                setNoteOpen(true);
              }}
            >
              <NotebookPen className="h-3.5 w-3.5 text-text-muted" />
              {current.note?.trim() ? "Edit my note" : "Add my note"}
            </button>
            {onViewOnMap ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-surface"
                onClick={() => {
                  setMoreMenuOpen(false);
                  onViewOnMap(current);
                }}
              >
                <MapPinned className="h-3.5 w-3.5 text-text-muted" />
                View on map
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-error hover:bg-error-background"
                onClick={() => {
                  setMoreMenuOpen(false);
                  setConfirmDeleteOpen(true);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            ) : null}
          </div>
        ) : null}

        {noteOpen ? (
          <div
            ref={notePopoverRef}
            role="dialog"
            aria-label="My note"
            className="absolute right-0 z-30 mt-1 w-[min(18.5rem,calc(100vw-2.5rem))] rounded-xl border border-border bg-surface-elevated p-3 shadow-lg"
          >
            <label
              htmlFor="place-note"
              className="mb-2 block text-sm font-medium text-text"
            >
              My note
            </label>
            <textarea
              id="place-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Go at sunset…"
              rows={4}
              autoFocus
              className="block w-full resize-y rounded-xl border border-border bg-surface-elevated px-3 py-2.5 text-sm leading-relaxed text-text outline-none transition-colors placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <div className="mt-3 flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setNote(current.note ?? "");
                  setNoteOpen(false);
                }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                color="primary"
                icon={Save}
                loading={saving}
                onClick={() => void handleNote()}
                className="flex-1"
              >
                Save
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={current.title}
      size="lg"
      actions={headerActions}
    >
      <DeleteConfirmModal
        open={confirmDeleteOpen}
        entity="place"
        description={
          <>
            <span className="font-medium text-text">{current.title}</span> will
            be removed from your map and places. This can’t be undone.
          </>
        }
        loading={deleting}
        onCancel={() => {
          if (!deleting) setConfirmDeleteOpen(false);
        }}
        onConfirm={() => void handleConfirmDelete()}
      />
      <div className="flex flex-col gap-5">
        {images.length > 0 ? (
          <div
            className={cx(
              "grid gap-2",
              images.length > 1 ? "grid-cols-2" : "grid-cols-1"
            )}
          >
            {images.map((img) => (
              <div
                key={img.url}
                className="relative aspect-[4/3] overflow-hidden rounded-xl bg-surface"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={current.title}
                  className="h-full w-full object-cover"
                />
              </div>
            ))}
          </div>
        ) : null}

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {onOpenCity ? (
                <button
                  type="button"
                  className="text-left text-sm font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() =>
                    onOpenCity({
                      cityName: current.city.name,
                      countryName: current.country.name,
                      lat: current.lat,
                      lon: current.lon,
                    })
                  }
                >
                  {current.city.name}, {current.country.name}
                </button>
              ) : (
                <p className="text-sm text-text-secondary">
                  {current.city.name}, {current.country.name}
                </p>
              )}
              {current.category ? (
                <span className="rounded-full bg-primary-tint px-2.5 py-0.5 text-[11px] font-medium text-primary">
                  {PLACE_CATEGORY_LABELS[current.category] ?? current.category}
                </span>
              ) : null}
            </div>
            <div ref={statusMenuRef} className="relative shrink-0">
              <button
                type="button"
                disabled={statusBusy}
                aria-haspopup="menu"
                aria-expanded={statusMenuOpen}
                onClick={() => {
                  setMoreMenuOpen(false);
                  setNoteOpen(false);
                  setStatusMenuOpen((v) => !v);
                }}
                className="inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-1.5 transition-colors hover:bg-surface disabled:opacity-60"
              >
                <StatusBadge status={current.status} />
                <ChevronDown
                  className={cx(
                    "h-3.5 w-3.5 text-text-muted transition-transform",
                    statusMenuOpen && "rotate-180"
                  )}
                />
              </button>
              {statusMenuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 z-20 mt-1.5 min-w-[10.5rem] overflow-hidden rounded-xl border border-border bg-surface-elevated py-1 shadow-lg"
                >
                  {STATUSES.map((status) => {
                    const selected = current.status === status;
                    return (
                      <button
                        key={status}
                        type="button"
                        role="menuitem"
                        disabled={statusBusy}
                        onClick={() => void handleStatus(status)}
                        className={cx(
                          "flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors",
                          selected ? "bg-primary-tint" : "hover:bg-surface"
                        )}
                      >
                        <StatusBadge status={status} />
                        {selected ? (
                          <Check className="h-3.5 w-3.5 text-primary" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-text">
            {current.description}
          </p>
        </div>

        <div className="rounded-xl bg-surface px-3 py-3">
          <p className="text-sm font-medium text-text">{confidence.label}</p>
          {confidence.detail ? (
            <p className="mt-1 text-sm text-text-muted">{confidence.detail}</p>
          ) : null}
          <p className="mt-2 text-sm text-text-secondary">
            <span className="font-medium text-text">Why we think this: </span>
            {current.ai.why}
          </p>
        </div>

        {current.status === "planned" ? (
          <Button
            color="primary"
            icon={Check}
            disabled={statusBusy}
            onClick={() => void handleStatus("visited")}
            className="w-full"
          >
            Mark as visited
          </Button>
        ) : current.status === "visited" ? (
          <Button color="primary" icon={Check} disabled className="w-full">
            Visited
          </Button>
        ) : null}

        {current.note?.trim() ? (
          <button
            type="button"
            onClick={() => {
              setStatusMenuOpen(false);
              setMoreMenuOpen(false);
              setNote(current.note ?? "");
              setNoteOpen(true);
            }}
            className="rounded-xl bg-surface px-3 py-3 text-left transition-colors hover:bg-surface-elevated"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              My note
            </p>
            <p className="mt-1 text-sm text-text">{current.note}</p>
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}
