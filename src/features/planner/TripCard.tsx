"use client";

import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Map as MapIcon,
  MapPin,
  MoreHorizontal,
  Plane,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Timestamp } from "firebase/firestore";
import { DeleteConfirmModal } from "@/components/ui";
import type { TripPlannerDoc, TripStatus } from "@/types/trip-planner";
import type { SavedLocation } from "@/hooks/useLocations";
import { tripDayCount } from "@/services/trip-planner";
import { placesProgress, tripStatusLabel } from "./tripUtils";
import {
  listTripDestinations,
  primaryTripDestination,
} from "./tripDestinations";
import { cx } from "@/lib/utils";

interface TripCardProps {
  trip: TripPlannerDoc;
  locations: SavedLocation[];
  onOpen: () => void;
  onDelete?: () => void | Promise<void>;
}

function tripCoverUrl(
  trip: TripPlannerDoc,
  locations: SavedLocation[]
): string | null {
  if (trip.photoUrl) return trip.photoUrl;

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

function formatCardStartDate(startDate: Timestamp): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(startDate.toDate());
}

function statusBadgeClass(status: TripStatus): string {
  switch (status) {
    case "planning":
    case "upcoming":
      return "bg-warning-background text-warning";
    case "completed":
      return "bg-success-background text-success";
    case "cancelled":
      return "bg-error-background text-error";
    default:
      return "bg-primary-tint text-primary";
  }
}

function statusDotClass(status: TripStatus): string {
  switch (status) {
    case "planning":
    case "upcoming":
      return "bg-warning";
    case "completed":
      return "bg-success";
    case "cancelled":
      return "bg-error";
    default:
      return "bg-primary";
  }
}


export function TripCard({
  trip,
  locations,
  onOpen,
  onDelete,
}: TripCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const progress = placesProgress(trip, locations);
  const days = tripDayCount(trip.startDate, trip.endDate);
  const destinations = listTripDestinations(trip);
  const primary = primaryTripDestination(trip);
  const title =
    destinations
      .map((dest) => dest.cityName)
      .filter(Boolean)
      .join(" · ") || primary.countryName;
  const coverUrl = tripCoverUrl(trip, locations);
  const coverCity = primary.cityName || destinations[0]?.cityName || "";
  const placesLabel =
    progress.total === 0
      ? "No places added yet"
      : `${progress.visited}/${progress.total} visited`;

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

  async function handleConfirmDelete() {
    if (!onDelete || deleting) return;
    setDeleting(true);
    try {
      await onDelete();
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article className="relative overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-sm transition-colors hover:border-primary/30">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full min-h-[9.5rem] text-left sm:min-h-[11rem]"
      >
        <div className="relative w-[7.25rem] shrink-0 self-stretch overflow-hidden bg-gradient-to-br from-primary via-primary-light to-primary-hover sm:w-40 md:w-44">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote cover / user image URLs
            <img
              src={coverUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : null}
          {coverCity ? (
            <span className="absolute bottom-2.5 left-2.5 inline-flex max-w-[calc(100%-1.25rem)] items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-[2px]">
              <MapPin className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{coverCity}</span>
            </span>
          ) : null}
        </div>

        <div className="relative flex min-w-0 flex-1 flex-col justify-between gap-2.5 overflow-hidden p-3 sm:gap-3 sm:p-4">
          <div className="relative min-w-0 pr-8">
            <span
              className={cx(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                statusBadgeClass(trip.status)
              )}
            >
              <span
                className={cx(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  statusDotClass(trip.status)
                )}
                aria-hidden
              />
              {tripStatusLabel(trip.status)}
            </span>

            <h3 className="mt-2 truncate text-[15px] font-semibold tracking-tight text-text sm:text-base">
              {title}
            </h3>

            <p className="mt-1 flex items-center gap-1.5 text-sm text-text-secondary">
              <CalendarDays
                className="h-3.5 w-3.5 shrink-0 text-text-muted"
                aria-hidden
              />
              <span className="truncate">
                {formatCardStartDate(trip.startDate)}{" "}
                <span className="text-text-muted">(day {days})</span>
              </span>
            </p>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-0 gap-y-1.5 text-xs text-text-secondary sm:text-[13px]">
              <span className="inline-flex items-center gap-1.5 pr-2.5 sm:pr-3">
                <Plane className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
                {days} day{days === 1 ? "" : "s"}
              </span>
              <span
                className="hidden h-3.5 w-px bg-border sm:block"
                aria-hidden
              />
              <span className="inline-flex items-center gap-1.5 px-2.5 sm:px-3">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
                {progress.total} place{progress.total === 1 ? "" : "s"}
              </span>
              <span
                className="hidden h-3.5 w-px bg-border sm:block"
                aria-hidden
              />
              <span className="inline-flex min-w-0 items-center gap-1.5 pl-2.5 sm:pl-3">
                <MapIcon className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
                <span className="truncate">{placesLabel}</span>
              </span>
            </div>
          </div>

          <div className="relative flex min-w-0 items-end gap-2">
            {destinations.length > 0 ? (
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {destinations.map((dest, index) => {
                  const thumb = dest.photos?.find(Boolean) || coverUrl;
                  return (
                    <div
                      key={`${dest.cityId ?? dest.cityName}-${index}`}
                      className="flex shrink-0 items-center gap-1.5"
                    >
                      {index > 0 ? (
                        <ArrowRight
                          className="h-3.5 w-3.5 shrink-0 text-text-muted"
                          aria-hidden
                        />
                      ) : null}
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-1.5 py-1 pr-2.5 text-xs font-medium text-text-secondary ring-1 ring-border/70">
                        <span className="relative h-5 w-5 shrink-0 overflow-hidden rounded-full bg-primary-tint">
                          {thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element -- remote cover / user image URLs
                            <img
                              src={thumb}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <MapPin className="absolute inset-0 m-auto h-3 w-3 text-primary/70" />
                          )}
                        </span>
                        <span className="max-w-[6.5rem] truncate">
                          {dest.cityName}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="min-w-0 flex-1 font-[family-name:var(--font-lobster)] text-sm text-text-muted/80">
                A more meaningful journey
              </p>
            )}

            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary sm:h-9 sm:w-9"
              aria-hidden
            >
              <ChevronRight className="h-4 w-4" />
            </span>
          </div>
        </div>
      </button>

      {/* Sibling of open button — nested <button> is invalid HTML. */}
      <div className="absolute right-2.5 top-2.5 z-10 sm:right-3.5 sm:top-3.5" ref={menuRef}>
        <button
          type="button"
          aria-label="Trip options"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="rounded-full bg-surface/90 p-1.5 text-text-muted shadow-sm ring-1 ring-border/80 backdrop-blur-sm hover:bg-surface hover:text-text"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {menuOpen && onDelete ? (
          <div className="absolute right-0 mt-1 min-w-[9rem] rounded-xl border border-border bg-surface-elevated py-1 shadow-lg">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-error hover:bg-error-background"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                setDeleteOpen(true);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete trip
            </button>
          </div>
        ) : null}
      </div>

      <DeleteConfirmModal
        open={deleteOpen}
        entity="trip"
        description={
          <>
            This removes{" "}
            <span className="font-medium text-text">{title}</span> and its
            itinerary. This can’t be undone.
          </>
        }
        loading={deleting}
        onCancel={() => {
          if (!deleting) setDeleteOpen(false);
        }}
        onConfirm={() => void handleConfirmDelete()}
      />
    </article>
  );
}
