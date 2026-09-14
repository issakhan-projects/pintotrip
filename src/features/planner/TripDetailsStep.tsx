"use client";

import {
  Briefcase,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  Expand,
  FileText,
  Flag,
  Map as MapIcon,
  MapPin,
  Pencil,
  Plane,
  Tag,
} from "lucide-react";
import type { TripPlannerDoc } from "@/types/trip-planner";
import { tripDayCount } from "@/services/trip-planner";
import { Button } from "@/components/ui";
import {
  formatCoordinates,
  formatTripCompactDateRange,
} from "./tripUtils";
import { TripCityIntelligenceBlock } from "./TripCityIntelligenceBlock";
import { TripWeatherBlock } from "./TripWeatherBlock";

interface TripDetailsStepProps {
  trip: TripPlannerDoc;
  galleryImages?: string[];
  onEdit?: () => void;
  onRetryCityIntelligence?: () => void;
  onGoToPreparation?: () => void;
  onGoToPlaces?: () => void;
}

export function TripDetailsStep({
  trip,
  galleryImages = [],
  onEdit,
  onRetryCityIntelligence,
  onGoToPreparation,
  onGoToPlaces,
}: TripDetailsStepProps) {
  const fromLabel = [trip.from.cityName, trip.from.countryName]
    .filter(Boolean)
    .join(", ");
  const destLabel = [trip.destination.cityName, trip.destination.countryName]
    .filter(Boolean)
    .join(", ");
  const days = tripDayCount(trip.startDate, trip.endDate);
  const hasCoords =
    trip.destination.lat != null && trip.destination.lon != null;
  const coverUrl =
    trip.destination.photos?.find(Boolean) ||
    galleryImages.find(Boolean) ||
    null;
  const mapsLink = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${trip.destination.lat},${trip.destination.lon}`
    : null;

  const thumbs = galleryImages.slice(0, 4);
  const extraCount = Math.max(galleryImages.length - 3, 0);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold tracking-tight text-text">
          Trip details
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          Your trip information and useful insights about your destination.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <section className="rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm lg:col-span-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-tint text-primary">
                <Briefcase className="h-4 w-4" />
              </span>
              <h3 className="text-sm font-semibold text-text">
                Basic information
              </h3>
            </div>
            <Button
              variant="secondary"
              icon={Pencil}
              className="!h-8 !rounded-lg !px-2.5 !text-xs"
              type="button"
              onClick={onEdit}
            >
              Edit
            </Button>
          </div>

          <div className="divide-y divide-divider">
            <InfoRow icon={Tag} label="Trip name" value={trip.name} />
            <InfoRow
              icon={MapPin}
              label="Destination"
              value={destLabel}
              chevron
            />
            <InfoRow
              icon={Plane}
              label="From"
              value={fromLabel || "—"}
              chevron
            />
            <InfoRow
              icon={CalendarDays}
              label="Dates"
              value={`${formatTripCompactDateRange(trip.startDate, trip.endDate)}, ${days} day${days === 1 ? "" : "s"}`}
              chevron
            />
            <InfoRow
              icon={CircleDollarSign}
              label="Currency"
              value={`${trip.currency.name} (${trip.currency.code})`}
              chevron
              last
            />
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-sm lg:col-span-2">
          <div className="relative aspect-square bg-gradient-to-br from-primary via-primary-light to-primary-hover">
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- remote Google Place / user image URLs
              <img
                src={coverUrl}
                alt={destLabel}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-white/80">
                <MapPin className="h-8 w-8" />
                <span className="text-sm">{destLabel || "Destination"}</span>
              </div>
            )}
            {mapsLink ? (
              <a
                href={mapsLink}
                target="_blank"
                rel="noreferrer"
                aria-label="Open in Google Maps"
                className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 text-text shadow-sm ring-1 ring-border hover:bg-white"
              >
                <Expand className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </div>

          <div className="border-t border-divider px-4 py-3">
            <p className="text-sm font-semibold text-text">{destLabel}</p>
            {hasCoords ? (
              <p className="mt-0.5 text-xs text-text-secondary">
                {formatCoordinates(
                  trip.destination.lat!,
                  trip.destination.lon!
                )}
              </p>
            ) : null}

            {thumbs.length > 0 ? (
              <div className="mt-3 grid grid-cols-4 gap-2">
                {thumbs.map((url, index) => {
                  const isOverflow = index === 3 && extraCount > 0;
                  return (
                    <div
                      key={`${url}-${index}`}
                      className="relative aspect-square overflow-hidden rounded-lg bg-surface"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                      {isOverflow ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-semibold text-white">
                          +{extraCount}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <TripCityIntelligenceBlock
        status={trip.cityIntelligence.status}
        result={trip.cityIntelligence.result}
        errorMessage={trip.cityIntelligence.errorMessage}
        lastUpdatedAt={trip.cityIntelligence.lastUpdatedAt}
        onRetry={onRetryCityIntelligence}
      />

      <TripWeatherBlock trip={trip} />

      <section>
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-tint text-primary">
            <Flag className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-text">Next steps</h3>
            <p className="text-xs text-text-secondary">
              Continue with your trip preparation.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NextStepCard
            icon={FileText}
            accent
            title="Go to Before you go"
            subtitle="Complete your checklist"
            onClick={onGoToPreparation}
          />
          <NextStepCard
            icon={MapIcon}
            title="Add places to your trip"
            subtitle="Organize and plan your itinerary"
            onClick={onGoToPlaces}
          />
        </div>
      </section>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  chevron,
}: {
  icon: typeof Tag;
  label: string;
  value: string;
  chevron?: boolean;
  last?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface text-text-secondary">
        <Icon className="h-4 w-4" />
      </span>
      <span className="w-28 shrink-0 text-sm text-text-secondary sm:w-32">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate text-right text-sm font-medium text-text">
        {value}
      </span>
      {chevron ? (
        <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
      ) : (
        <span className="w-4 shrink-0" />
      )}
    </div>
  );
}

function NextStepCard({
  icon: Icon,
  title,
  subtitle,
  onClick,
  accent,
}: {
  icon: typeof Briefcase;
  title: string;
  subtitle: string;
  onClick?: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl border border-border bg-surface-elevated px-4 py-4 text-left shadow-sm transition-colors hover:border-primary/30 hover:bg-primary-tint/40"
    >
      <span
        className={
          accent
            ? "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-tint text-primary"
            : "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface text-text-secondary"
        }
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-text">{title}</span>
        <span className="mt-0.5 block text-xs text-text-secondary">
          {subtitle}
        </span>
      </span>
      <ChevronRight
        className={
          accent
            ? "h-5 w-5 shrink-0 text-primary"
            : "h-5 w-5 shrink-0 text-text-muted"
        }
      />
    </button>
  );
}
