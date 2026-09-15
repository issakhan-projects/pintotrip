"use client";

import { MoreHorizontal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TripPlannerDoc } from "@/types/trip-planner";
import type { SavedLocation } from "@/hooks/useLocations";
import { tripDayCount } from "@/services/trip-planner";
import {
  formatTripDateRange,
  placesProgress,
  tripMetaLine,
  tripStatusLabel,
} from "./tripUtils";
import { listTripDestinations } from "./tripDestinations";
import { cx } from "@/lib/utils";

interface TripCardProps {
  trip: TripPlannerDoc;
  locations: SavedLocation[];
  onOpen: () => void;
  onDelete?: () => void;
}

function tripCoverUrl(
  trip: TripPlannerDoc,
  locations: SavedLocation[]
): string | null {
  for (const dest of listTripDestinations(trip)) {
    const url = dest.photos?.find(Boolean);
    if (url) return url;
  }

  const byId = new Map(locations.map((l) => [l.id, l]));
  for (const id of trip.savedPlaceIds) {
    const url = byId.get(id)?.images[0]?.url;
    if (url) return url;
  }

  return null;
}

export function TripCard({
  trip,
  locations,
  onOpen,
  onDelete,
}: TripCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const progress = placesProgress(trip, locations);
  const days = tripDayCount(trip.startDate, trip.endDate);
  const destination =
    listTripDestinations(trip)
      .map((dest) => dest.cityName)
      .filter(Boolean)
      .join(" · ") || trip.destination.countryName;
  const coverUrl = tripCoverUrl(trip, locations);

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

  return (
    <article className="relative overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-sm transition-colors hover:border-primary/30">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full min-h-[7.5rem] text-left sm:min-h-[8.5rem]"
      >
        <div className="relative w-[6.5rem] shrink-0 self-stretch bg-gradient-to-br from-primary via-primary-light to-primary-hover sm:w-32">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote Google Place / user image URLs
            <img
              src={coverUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : null}
        </div>

        <div className="relative flex min-w-0 flex-1 flex-col justify-between gap-2 p-3 sm:p-4">
          <div className="min-w-0 pr-8">
            <span
              className={cx(
                "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
                trip.status === "planning" || trip.status === "upcoming"
                  ? "border-warning/45 bg-warning-background text-warning"
                  : trip.status === "completed"
                    ? "border-success/45 bg-success-background text-success"
                    : trip.status === "cancelled"
                      ? "border-error/45 bg-error-background text-error"
                      : "border-primary/30 bg-primary-tint text-primary"
              )}
            >
              {tripStatusLabel(trip.status)}
            </span>
            <h3 className="mt-1.5 truncate text-base font-semibold text-text">
              {destination}
            </h3>
            <p className="mt-0.5 text-sm text-text-secondary">
              {formatTripDateRange(trip.startDate, trip.endDate)}
            </p>
            <p className="mt-1 truncate text-sm text-text-secondary">
              {tripMetaLine(trip, locations)}
            </p>
          </div>

          {progress.total > 0 ? (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-text-secondary">
                <span>
                  {progress.visited}/{progress.total} visited
                </span>
                <span className="tabular-nums">{progress.percent}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="text-xs text-text-muted">
              {days} day{days === 1 ? "" : "s"} · no places added yet
            </p>
          )}
        </div>
      </button>

      {/* Sibling of open button — nested <button> is invalid HTML. */}
      <div className="absolute right-2 top-2 z-10" ref={menuRef}>
        <button
          type="button"
          aria-label="Trip options"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="rounded-lg p-1.5 text-text-muted hover:bg-surface hover:text-text"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {menuOpen ? (
          <div className="absolute right-0 mt-1 min-w-[9rem] rounded-xl border border-border bg-surface-elevated py-1 shadow-lg">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-error hover:bg-error-background"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onDelete?.();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete trip
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
