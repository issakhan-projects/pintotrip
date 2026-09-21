"use client";

import { useEffect, useRef, useState } from "react";
import {
  Binoculars,
  Building2,
  Check,
  CircleDot,
  Coffee,
  FerrisWheel,
  Landmark,
  MapPin,
  MapPinned,
  Moon,
  MoreHorizontal,
  Mountain,
  NotebookPen,
  Percent,
  Share2,
  ShoppingBag,
  Store,
  Tag,
  TrainFront,
  Trees,
  Trash2,
  UtensilsCrossed,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { Button, DeleteConfirmModal, TextInput } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { SavedLocation } from "@/hooks/useLocations";
import type { LocationStatus } from "@/types/location";
import {
  PLACE_CATEGORY_LABELS,
  type PlaceCategory,
} from "@/types/trip-plan";
import {
  confidencePercent,
  formatConfidenceCopy,
  cx,
} from "@/lib/utils";

const PLACE_CATEGORY_ICONS: Record<PlaceCategory, LucideIcon> = {
  attraction: FerrisWheel,
  beach: Waves,
  museum: Building2,
  landmark: Landmark,
  food: UtensilsCrossed,
  cafe: Coffee,
  park: Trees,
  viewpoint: Binoculars,
  nightlife: Moon,
  shopping: ShoppingBag,
  market: Store,
  nature: Trees,
  adventure: Mountain,
  wellness: Waves,
  neighborhood: Building2,
  transport: TrainFront,
  other: MapPin,
};

interface PlacePreviewSheetProps {
  place: SavedLocation | null;
  open: boolean;
  onClose: () => void;
  onUpdateStatus?: (status: LocationStatus) => Promise<void>;
  onSaveNote?: (note: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  onViewOnMap?: (place: SavedLocation) => void;
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

export function PlacePreviewSheet({
  place,
  open,
  onClose,
  onUpdateStatus,
  onSaveNote,
  onDelete,
  onViewOnMap,
  allowGooglePlacePhotos = false,
}: PlacePreviewSheetProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNote(place?.note ?? "");
  }, [place]);

  useEffect(() => {
    setMenuOpen(false);
    setNoteOpen(false);
    setConfirmDeleteOpen(false);
    setDeleting(false);
    setStatusBusy(false);
  }, [place?.id, open]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

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
  const confidenceValue =
    typeof current.confidence === "number" && Number.isFinite(current.confidence)
      ? current.confidence
      : 0;
  const confidence = formatConfidenceCopy(confidenceValue);
  const confidencePct = confidencePercent(confidenceValue);
  const CategoryIcon = current.category
    ? (PLACE_CATEGORY_ICONS[current.category] ?? MapPin)
    : null;

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

  async function handleSaveNote() {
    if (!onSaveNote) return;
    setSavingNote(true);
    try {
      await onSaveNote(note.trim());
      setNoteOpen(false);
    } finally {
      setSavingNote(false);
    }
  }

  async function handleStatus(status: LocationStatus) {
    if (!onUpdateStatus || status === current.status) return;
    setStatusBusy(true);
    try {
      await onUpdateStatus(status);
    } finally {
      setStatusBusy(false);
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
      <span className="mr-auto flex min-w-0 items-center gap-1.5 pr-2 text-sm text-text-secondary">
        <MapPin className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
        <span className="truncate">
          {current.city.name}, {current.country.name}
        </span>
      </span>

      <button
        type="button"
        aria-label="Share"
        disabled={shareBusy}
        onClick={() => void handleShare()}
        className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-surface hover:text-text disabled:opacity-60"
      >
        <Share2 className="h-5 w-5" />
      </button>

      <div ref={menuRef} className="relative">
        <button
          type="button"
          aria-label="More options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => {
            setNoteOpen(false);
            setMenuOpen((v) => !v);
          }}
          className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-surface hover:text-text"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
        {menuOpen ? (
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 min-w-[11rem] overflow-hidden rounded-xl border border-border bg-surface-elevated py-1 shadow-lg"
          >
            {onSaveNote ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-surface"
                onClick={() => {
                  setMenuOpen(false);
                  setNoteOpen(true);
                }}
              >
                <NotebookPen className="h-3.5 w-3.5 text-text-muted" />
                {current.note?.trim() ? "Edit my note" : "Add my note"}
              </button>
            ) : null}
            {onViewOnMap ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-surface"
                onClick={() => {
                  setMenuOpen(false);
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
                  setMenuOpen(false);
                  setConfirmDeleteOpen(true);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <Sheet open={open} onClose={onClose} size="lg" actions={headerActions}>
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
        ) : (
          <div className="flex aspect-[16/10] items-center justify-center rounded-xl bg-primary-tint text-sm text-primary">
            No photo yet
          </div>
        )}

        <div>
          <h2 className="text-base font-semibold tracking-tight text-text">
            {current.title}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="inline-flex w-24 shrink-0 items-center gap-1.5 text-sm font-medium text-text-secondary">
              <CircleDot className="h-3.5 w-3.5 text-text-muted" aria-hidden />
              Status
            </span>
            <StatusBadge status={current.status} />
          </div>
          {current.category && CategoryIcon ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="inline-flex w-24 shrink-0 items-center gap-1.5 text-sm font-medium text-text-secondary">
                <Tag className="h-3.5 w-3.5 text-text-muted" aria-hidden />
                Tags
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/45 bg-primary-tint px-2.5 py-1 text-xs font-medium text-primary">
                <CategoryIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {PLACE_CATEGORY_LABELS[current.category] ?? current.category}
              </span>
            </div>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="inline-flex w-24 shrink-0 items-center gap-1.5 text-sm font-medium text-text-secondary">
              <Percent className="h-3.5 w-3.5 text-text-muted" aria-hidden />
              Confidence
            </span>
            <span
              className={cx(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                confidenceValue >= 0.85
                  ? "border-success/45 bg-success-background text-success"
                  : confidenceValue >= 0.7
                    ? "border-warning/45 bg-warning-background text-warning"
                    : "border-error/45 bg-error-background text-error"
              )}
            >
              {confidencePct}% · {confidence.label}
            </span>
          </div>
        </div>

        {current.ai?.why ? (
          <div className="rounded-xl bg-surface px-3 py-3">
            <p className="text-sm text-text-secondary">
              <span className="font-medium text-text">Why we think this: </span>
              {current.ai.why}
            </p>
            {confidence.detail ? (
              <p className="mt-1 text-sm text-text-muted">{confidence.detail}</p>
            ) : null}
          </div>
        ) : confidence.detail ? (
          <div className="rounded-xl bg-surface px-3 py-3">
            <p className="text-sm text-text-muted">{confidence.detail}</p>
          </div>
        ) : null}

        {onUpdateStatus && current.status === "planned" ? (
          <Button
            color="primary"
            icon={Check}
            disabled={statusBusy}
            onClick={() => void handleStatus("visited")}
            className="w-full"
          >
            Mark as visited
          </Button>
        ) : onUpdateStatus && current.status === "visited" ? (
          <Button color="primary" icon={Check} disabled className="w-full">
            Visited
          </Button>
        ) : null}

        {noteOpen && onSaveNote ? (
          <div className="rounded-xl border border-border bg-surface p-3">
            <label className="mb-2 block text-sm font-medium text-text">
              My note
            </label>
            <TextInput
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Go at sunset…"
              autoFocus
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
                loading={savingNote}
                onClick={() => void handleSaveNote()}
                className="flex-1"
              >
                Save note
              </Button>
            </div>
          </div>
        ) : current.note?.trim() ? (
          <div className="rounded-xl bg-surface px-3 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              My note
            </p>
            <p className="mt-1 text-sm text-text">{current.note}</p>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
