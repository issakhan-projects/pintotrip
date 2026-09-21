"use client";

import { useEffect, useState } from "react";
import {
  Briefcase,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  Compass,
  Expand,
  FileText,
  Flag,
  Map as MapIcon,
  MapPin,
  Pencil,
  Plane,
  Tag,
  Wallet,
} from "lucide-react";
import { getFlagEmoji } from "country-flag-select";
import type { SavedLocation } from "@/hooks/useLocations";
import type { TripDestinationStop, TripPlannerDoc, TripRoute } from "@/types/trip-planner";
import { SPEND_MONEY_OPTIONS } from "@/types/trip-planner";
import { LEISURE_TYPE_OPTIONS } from "@/types/trip-plan";
import { tripDayCount } from "@/services/trip-planner";
import { subscribeTripRoutes } from "@/services/trip-routes";
import { Button } from "@/components/ui";
import {
  formatCoordinates,
  formatTripCompactDateRange,
} from "./tripUtils";
import { TripCityIntelligenceBlock } from "./TripCityIntelligenceBlock";
//import { TripWeatherBlock } from "./TripWeatherBlock";
import { TripRouteTimeBreakdownSection } from "./TripRouteTimeBreakdown";
import { destinationForLocation } from "./matchTripPlaces";
import {
  listTripDestinations,
  destinationCityKey,
  destinationCountryKey,
  primaryTripDestination,
  formatCityStopDates,
  groupTripDestinationsByCountry,
} from "./tripDestinations";

interface TripDetailsStepProps {
  trip: TripPlannerDoc;
  userId: string;
  galleryImages?: string[];
  locations?: SavedLocation[];
  onEdit?: () => void;
  onRetryCityIntelligence?: () => void;
  onGoToPreparation?: () => void;
  onGoToPlaces?: () => void;
}

function useTripRoutes(userId: string, tripId: string): TripRoute[] {
  const [routes, setRoutes] = useState<TripRoute[]>([]);

  useEffect(() => {
    return subscribeTripRoutes(userId, tripId, setRoutes);
  }, [userId, tripId]);

  return routes;
}

export function TripDetailsStep(props: TripDetailsStepProps) {
  const routes = useTripRoutes(props.userId, props.trip.id);
  const cities = listTripDestinations(props.trip);
  if (cities.length > 1) {
    return <MultiCityTripDetails {...props} cities={cities} routes={routes} />;
  }
  return <SingleCityTripDetails {...props} routes={routes} />;
}

function SingleCityTripDetails({
  trip,
  routes,
  galleryImages = [],
  onEdit,
  onRetryCityIntelligence,
  onGoToPreparation,
  onGoToPlaces,
}: TripDetailsStepProps & { routes: TripRoute[] }) {
  const primaryDest = primaryTripDestination(trip);
  const fromLabel = [trip.from.cityName, trip.from.countryName]
    .filter(Boolean)
    .join(", ");
  const destLabel = [primaryDest.cityName, primaryDest.countryName]
    .filter(Boolean)
    .join(", ");
  const days = tripDayCount(trip.startDate, trip.endDate);
  const hasCoords = primaryDest.lat != null && primaryDest.lon != null;
  const coverUrl =
    primaryDest.photos?.find(Boolean) || galleryImages.find(Boolean) || null;
  const mapsLink = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${primaryDest.lat},${primaryDest.lon}`
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
              label="Home Currency" 
              value={`${trip.currency.name} (${trip.currency.code})`}
              chevron
              last
            />


            
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-sm lg:col-span-2">
          <div className="relative aspect-square bg-gradient-to-br from-primary via-primary-light to-primary-hover">
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- remote cover / user image URLs
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
                {formatCoordinates(primaryDest.lat!, primaryDest.lon!)}
              </p>
            ) : null}

            {/* {thumbs.length > 0 ? (
              <div className="mt-3 grid grid-cols-4 gap-2">
                {thumbs.map((url, index) => {
                  const isOverflow = index === 3 && extraCount > 0;
                  return (
                    <div
                      key={`${url}-${index}`}
                      className="relative aspect-square overflow-hidden rounded-lg bg-surface"
                    >
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
            ) : null} */}
          </div>
        </section>
      </div>

      <TripRouteTimeBreakdownSection trip={trip} routes={routes} />

      <TripCityIntelligenceBlock
        status={trip.cityIntelligence.status}
        results={trip.cityIntelligence.results}
        errorMessage={trip.cityIntelligence.errorMessage}
        lastUpdatedAt={trip.cityIntelligence.lastUpdatedAt}
        onRetry={onRetryCityIntelligence}
      />

      {/* <TripWeatherBlock trip={trip} /> */}

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

function MultiCityTripDetails({
  trip,
  routes,
  galleryImages = [],
  locations = [],
  cities,
  onEdit,
  onRetryCityIntelligence,
  onGoToPreparation,
  onGoToPlaces,
}: TripDetailsStepProps & {
  cities: TripDestinationStop[];
  routes: TripRoute[];
}) {
  const fromLabel = [trip.from.cityName, trip.from.countryName]
    .filter(Boolean)
    .join(", ");
  const days = tripDayCount(trip.startDate, trip.endDate);
  const groups = groupTripDestinationsByCountry(cities);
  const coverCity =
    cities.find((city) => city.photos?.some(Boolean)) ?? cities[0]!;
  const coverUrl =
    coverCity.photos?.find(Boolean) ||
    galleryImages.find(Boolean) ||
    null;
  const hasCoords =
    coverCity.lat != null && coverCity.lon != null;
  const mapsLink = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${coverCity.lat},${coverCity.lon}`
    : null;
  const coverLabel = cities.map((city) => city.cityName).join(", ");
  const thumbs = galleryImages.slice(0, 4);
  const extraCount = Math.max(galleryImages.length - 3, 0);
  const leisureLabel = trip.leisureType
    ? trip.leisureType === "custom" && trip.leisureCustom?.trim()
      ? `Custom — ${trip.leisureCustom.trim()}`
      : LEISURE_TYPE_OPTIONS.find((o) => o.value === trip.leisureType)?.label ??
        trip.leisureType
    : null;
  const spendLabel = trip.spendMoney
    ? SPEND_MONEY_OPTIONS.find((o) => o.id === trip.spendMoney)?.label ??
      trip.spendMoney
    : null;

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
              last={!leisureLabel && !spendLabel}
            />
            {leisureLabel ? (
              <InfoRow icon={Compass} label="Type of leisure" value={leisureLabel} />
            ) : null}
            {spendLabel ? (
              <InfoRow icon={Wallet} label="Spend money" value={spendLabel} last />
            ) : null}
          </div>

          <div className="mt-4 space-y-3">
            {groups.map((group) => {
              const flag = group.countryCode
                ? getFlagEmoji(group.countryCode)
                : "";
              return (
                <div
                  key={group.countryKey}
                  className="rounded-2xl border border-border bg-surface px-3 py-3"
                >
                  <p className="text-sm font-semibold text-text">
                    {flag ? `${flag} ` : ""}
                    {group.countryName}
                  </p>
                  <ul className="mt-2 space-y-3">
                    {group.cities.map((city, index) => {
                      const photo = city.photos?.find(Boolean) ?? null;
                      const placeCount = savedPlaceCountForCity(
                        city,
                        cities,
                        locations,
                        trip.savedPlaceIds
                      );
                      const datesLabel = formatCityStopDates(city);
                      const datesSet = Boolean(city.startDate && city.endDate);
                      return (
                        <li
                          key={`${destinationCityKey(city.cityName, city.cityId)}-${index}`}
                          className="flex items-start gap-3"
                        >
                          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-divider">
                            {photo ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={photo}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center text-text-muted">
                                <MapPin className="h-4 w-4" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-text">
                              {city.cityName}
                            </p>
                            <p
                              className={
                                datesSet
                                  ? "mt-0.5 text-xs text-text-secondary"
                                  : "mt-0.5 text-xs text-text-muted"
                              }
                            >
                              {datesLabel}
                            </p>
                            {placeCount > 0 ? (
                              <p className="mt-0.5 text-xs text-text-secondary">
                                {placeCount}{" "}
                                {placeCount === 1 ? "saved place" : "saved places"}
                              </p>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-sm lg:col-span-2">
          <div className="relative aspect-square bg-gradient-to-br from-primary via-primary-light to-primary-hover">
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- remote cover / user image URLs
              <img
                src={coverUrl}
                alt={coverLabel}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-white/80">
                <MapPin className="h-8 w-8" />
                <span className="text-sm">{coverLabel || "Destinations"}</span>
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
            <p className="text-sm font-semibold text-text">{coverLabel}</p>
            {hasCoords ? (
              <p className="mt-0.5 text-xs text-text-secondary">
                {formatCoordinates(coverCity.lat!, coverCity.lon!)}
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

      <TripRouteTimeBreakdownSection trip={trip} routes={routes} />

      <TripCityIntelligenceBlock
        status={trip.cityIntelligence.status}
        results={trip.cityIntelligence.results}
        errorMessage={trip.cityIntelligence.errorMessage}
        lastUpdatedAt={trip.cityIntelligence.lastUpdatedAt}
        onRetry={onRetryCityIntelligence}
      />

      {/* <TripWeatherBlock trip={trip} /> */}

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

function savedPlaceCountForCity(
  city: TripDestinationStop,
  cities: TripDestinationStop[],
  locations: SavedLocation[],
  savedPlaceIds: string[]
): number {
  if (locations.length === 0 || savedPlaceIds.length === 0) return 0;
  const ids = new Set(savedPlaceIds);
  const cityKey = destinationCityKey(city.cityName, city.cityId);
  const countryKey = destinationCountryKey(city.countryName, city.countryId);
  return locations.filter((place) => {
    if (!ids.has(place.id) || place.status === "cancelled") return false;
    const owner = destinationForLocation(place, cities);
    if (!owner) return false;
    return (
      destinationCityKey(owner.cityName, owner.cityId) === cityKey &&
      destinationCountryKey(owner.countryName, owner.countryId) === countryKey
    );
  }).length;
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
