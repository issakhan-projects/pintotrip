"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Coins, Download, RefreshCw, Share2, X } from "lucide-react";
import { Button } from "@/components/ui";
import { lockBodyScroll } from "@/lib/bodyScrollLock";
import { shareTripStory } from "@/services/functions";
import {
  AI_CREDIT_COSTS,
  formatInsufficientCreditsMessage,
  isInsufficientAICreditsError,
} from "@/types/credits";
import type { ShareTripStorySuccess } from "@/types/trip-share";
import { cx } from "@/lib/utils";

const STORY_CREDIT_COST = AI_CREDIT_COSTS.shareTripStory;

export interface ShareTripModalProps {
  open: boolean;
  userId: string;
  tripId: string;
  tripName: string;
  /** Existing story URL from the trip doc, if any. */
  existingImageUrl?: string | null;
  onClose: () => void;
  onGenerated?: (imageUrl: string) => void;
}

/**
 * Generate / preview / share a 9:16 Instagram Story image for a completed trip.
 */
export function ShareTripModal({
  open,
  userId: _userId,
  tripId,
  tripName,
  existingImageUrl,
  onClose,
  onGenerated,
}: ShareTripModalProps) {
  void _userId;
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const [backdropArmed, setBackdropArmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShareTripStorySuccess | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [storyBlob, setStoryBlob] = useState<Blob | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setBackdropArmed(false);
      setLoading(false);
      setError(null);
      setResult(null);
      setStoryBlob(null);
      setPreviewUrl((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }

    const armId = window.setTimeout(() => setBackdropArmed(true), 120);
    const unlock = lockBodyScroll();

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await shareTripStory({ tripId });
        applyStoryResult(data);
        onGenerated?.(data.imageUrl);
      } catch (err) {
        if (isInsufficientAICreditsError(err)) {
          setError(formatInsufficientCreditsMessage(err));
        } else {
          setError(
            err instanceof Error
              ? err.message
              : "Could not generate your trip story."
          );
        }
        if (existingImageUrl?.trim()) {
          setResult({
            success: true,
            imageUrl: existingImageUrl.trim(),
            imageBase64: "",
            cached: true,
            model: "cached",
            creditsCharged: 0,
            remainingCredits: 0,
            stats: {
              destinationLabel: tripName,
              cityNames: [],
              cityCount: 0,
              dateLabel: "",
              dayCount: 0,
              placesTotal: 0,
              placesVisited: 0,
              photoCount: 0,
            },
          });
          setPreviewUrl(existingImageUrl.trim());
          setStoryBlob(null);
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      window.clearTimeout(armId);
      unlock();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open/tripId gate
  }, [open, tripId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loading, onClose]);

  function applyStoryResult(data: ShareTripStorySuccess) {
    setResult(data);
    const blob = data.imageBase64
      ? blobFromBase64Png(data.imageBase64)
      : null;
    setStoryBlob(blob);
    setPreviewUrl((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      if (blob) return URL.createObjectURL(blob);
      return data.imageUrl;
    });
  }

  async function handleRegenerate() {
    setLoading(true);
    setError(null);
    try {
      const data = await shareTripStory({
        tripId,
        forceRegenerate: true,
      });
      applyStoryResult(data);
      onGenerated?.(data.imageUrl);
    } catch (err) {
      if (isInsufficientAICreditsError(err)) {
        setError(formatInsufficientCreditsMessage(err));
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Could not regenerate your trip story."
        );
      }
    } finally {
      setLoading(false);
    }
  }

  function requireStoryBlob(): Blob {
    if (storyBlob) return storyBlob;
    if (result?.imageBase64) {
      const blob = blobFromBase64Png(result.imageBase64);
      setStoryBlob(blob);
      return blob;
    }
    throw new Error(
      "Story file isn’t ready to save yet. Tap Regenerate, then Download."
    );
  }

  async function handleShare() {
    setError(null);
    try {
      const blob = requireStoryBlob();
      const file = new File(
        [blob],
        `${slugify(tripName || "trip")}-story.png`,
        { type: "image/png" }
      );
      if (
        typeof navigator !== "undefined" &&
        navigator.share &&
        (!navigator.canShare || navigator.canShare({ files: [file] }))
      ) {
        await navigator.share({
          title: tripName || "My PinToTrip",
          text: "My trip on PinToTrip",
          files: [file],
        });
        return;
      }
      downloadBlob(blob, file.name);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(
        err instanceof Error
          ? err.message
          : "Could not share the story image. Try Download instead."
      );
    }
  }

  function handleDownload() {
    setError(null);
    try {
      const blob = requireStoryBlob();
      downloadBlob(blob, `${slugify(tripName || "trip")}-story.png`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not download the story image."
      );
    }
  }

  if (!open || !mounted) return null;

  const canSave = Boolean(storyBlob || result?.imageBase64);

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Dismiss"
        disabled={loading}
        className="absolute inset-0 bg-text/40"
        onClick={() => {
          if (backdropArmed && !loading) onClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[min(92vh,44rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-text">
              Share trip
            </h2>
            <p className="mt-0.5 truncate text-sm text-text-secondary">
              {tripName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-text-secondary hover:bg-surface disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div
            className={cx(
              "mx-auto aspect-[9/16] w-full max-w-[220px] overflow-hidden rounded-2xl bg-surface ring-1 ring-border",
              loading && "animate-pulse"
            )}
          >
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- blob / storage preview
              <img
                src={previewUrl}
                alt={`Instagram story for ${tripName}`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-xs text-text-muted">
                {loading
                  ? "Creating your story…"
                  : "Story preview will appear here"}
              </div>
            )}
          </div>

          {result?.stats ? (
            <p className="mt-3 text-center text-xs text-text-muted">
              {result.stats.dayCount} day
              {result.stats.dayCount === 1 ? "" : "s"} ·{" "}
              {result.stats.cityCount} cit
              {result.stats.cityCount === 1 ? "y" : "ies"} ·{" "}
              {result.stats.placesVisited} place
              {result.stats.placesVisited === 1 ? "" : "s"} visited
              {result.cached ? <> · saved</> : null}
            </p>
          ) : null}

          {error ? (
            <p className="mt-3 text-center text-sm text-error">{error}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 border-t border-border px-5 py-4">
          <Button
            icon={Share2}
            onClick={() => void handleShare()}
            disabled={!canSave || loading}
            className="btn-primary w-full"
          >
            Share story
          </Button>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              icon={Download}
              onClick={handleDownload}
              disabled={!canSave || loading}
              className="!border-border !bg-surface !text-text flex-1"
            >
              Download
            </Button>
            <Button
              variant="secondary"
              icon={RefreshCw}
              onClick={() => void handleRegenerate()}
              loading={loading}
              disabled={loading}
              className="!border-border !bg-surface !text-text flex-1"
            >
              <span className="inline-flex items-center gap-2">
                Regenerate
                <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-warning">
                  <Coins className="h-3 w-3" aria-hidden />
                  {STORY_CREDIT_COST}
                </span>
              </span>
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "trip"
  );
}

function blobFromBase64Png(base64: string): Blob {
  const clean = base64.includes(",")
    ? base64.slice(base64.indexOf(",") + 1)
    : base64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: "image/png" });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
