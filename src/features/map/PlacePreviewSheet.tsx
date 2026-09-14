"use client";

import { useEffect, useRef, useState } from "react";
import {
  MapPinned,
  MoreHorizontal,
  NotebookPen,
  ArrowRight,
  Share2,
  Trash2,
} from "lucide-react";
import { Button, ConfirmModal, TextInput } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { SavedLocation } from "@/hooks/useLocations";
import { formatConfidenceCopy } from "@/lib/utils";

interface PlacePreviewSheetProps {
  place: SavedLocation | null;
  open: boolean;
  onClose: () => void;
  onOpenDetails: (place: SavedLocation) => void;
  onSaveNote?: (note: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  onViewOnMap?: (place: SavedLocation) => void;
}

export function PlacePreviewSheet({
  place,
  open,
  onClose,
  onOpenDetails,
  onSaveNote,
  onDelete,
  onViewOnMap,
}: PlacePreviewSheetProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
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
  const image = current.images[0]?.url;
  const confidence = formatConfidenceCopy(current.confidence);

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

      <div ref={menuRef} className="relative">
        <button
          type="button"
          aria-label="More options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
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
    <Sheet
      open={open}
      onClose={onClose}
      title={current.title}
      size="sm"
      actions={headerActions}
    >
      <ConfirmModal
        open={confirmDeleteOpen}
        title="Delete this place?"
        description={
          <>
            <span className="font-medium text-text">{current.title}</span> will
            be removed from your map and places. This can’t be undone.
          </>
        }
        confirmLabel="Delete"
        cancelLabel="Keep"
        tone="danger"
        loading={deleting}
        onCancel={() => {
          if (!deleting) setConfirmDeleteOpen(false);
        }}
        onConfirm={() => void handleConfirmDelete()}
      />

      <div className="flex flex-col gap-4">
        {image ? (
          <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image}
              alt={current.title}
              className="h-full w-full object-cover"
            />
          </div>
        ) : (
          <div className="flex aspect-[16/10] items-center justify-center rounded-xl bg-primary-tint text-sm text-primary">
            No photo yet
          </div>
        )}

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={current.status} />
            <span className="text-sm text-text-secondary">
              {current.city.name}, {current.country.name}
            </span>
          </div>
          <p className="mt-2 text-sm text-text-muted">{confidence.label}</p>
        </div>

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
                onClick={() => {
                  setNote(current.note ?? "");
                  setNoteOpen(false);
                }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                loading={savingNote}
                onClick={() => void handleSaveNote()}
                className="btn-primary flex-1"
              >
                Save note
              </Button>
            </div>
          </div>
        ) : null}

        <Button
          color="primary"
          icon={ArrowRight}
          onClick={() => onOpenDetails(current)}
          className="w-full"
        >
          Open details
        </Button>
      </div>
    </Sheet>
  );
}
