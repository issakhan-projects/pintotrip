"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BedDouble,
  Briefcase,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  CloudSun,
  Compass,
  CreditCard,
  FileText,
  Flag,
  Luggage,
  Map as MapIcon,
  MapPin,
  Pencil,
  Plane,
  Stamp,
  Tag,
  Utensils,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { getFlagEmoji } from "country-flag-select";
import type { SavedLocation } from "@/hooks/useLocations";
import type {
  TripDestinationStop,
  TripPlannerDoc,
  TripRoute,
} from "@/types/trip-planner";
import {
  MEAL_TYPE_OPTIONS,
  MEAL_TYPES,
  SPEND_MONEY_OPTIONS,
} from "@/types/trip-planner";
import { LEISURE_TYPE_OPTIONS } from "@/types/trip-plan";
import { tripDayCount } from "@/services/trip-planner";
import { subscribeTripRoutes } from "@/services/trip-routes";
import { Button } from "@/components/ui";
import { cx } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { formatTripCompactDateRange } from "./tripUtils";
import { TripCityIntelligenceBlock } from "./TripCityIntelligenceBlock";
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
import {
  computeTripReadiness,
  type ReadinessItem,
  type ReadinessItemId,
} from "./tripReadiness";

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

function leisureLabelForTrip(
  trip: TripPlannerDoc,
  t: (key: string, params?: Record<string, string | number>) => string
): string | null {
  if (!trip.leisureType) return null;
  if (trip.leisureType === "custom" && trip.leisureCustom?.trim()) {
    return t("planner.details.customLeisure", {
      text: trip.leisureCustom.trim(),
    });
  }
  return (
    LEISURE_TYPE_OPTIONS.find((o) => o.value === trip.leisureType)?.label ??
    trip.leisureType
  );
}

function mealLabelForTrip(
  trip: TripPlannerDoc,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  const mealType =
    trip.mealType && (MEAL_TYPES as readonly string[]).includes(trip.mealType)
      ? trip.mealType
      : "default";
  if (mealType === "other" && trip.mealCustom?.trim()) {
    return t("planner.details.otherMeal", { text: trip.mealCustom.trim() });
  }
  return MEAL_TYPE_OPTIONS.find((o) => o.id === mealType)?.label ?? mealType;
}

function spendLabelForTrip(trip: TripPlannerDoc): string | null {
  if (!trip.spendMoney) return null;
  return (
    SPEND_MONEY_OPTIONS.find((o) => o.id === trip.spendMoney)?.label ??
    trip.spendMoney
  );
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
  locations = [],
  onEdit,
  onRetryCityIntelligence,
  onGoToPreparation,
  onGoToPlaces,
}: TripDetailsStepProps & { routes: TripRoute[] }) {
  const { t } = useI18n();
  const primaryDest = primaryTripDestination(trip);
  const fromLabel = [trip.from.cityName, trip.from.countryName]
    .filter(Boolean)
    .join(", ");
  const destLabel = [primaryDest.cityName, primaryDest.countryName]
    .filter(Boolean)
    .join(", ");
  const days = tripDayCount(trip.startDate, trip.endDate);
  const readiness = computeTripReadiness(trip, routes, locations);
  const leisureLabel = leisureLabelForTrip(trip, t);
  const mealLabel = mealLabelForTrip(trip, t);
  const spendLabel = spendLabelForTrip(trip);

  return (
    <TripDetailsShell
      onEdit={onEdit}
      readiness={readiness}
      onGoToPreparation={onGoToPreparation}
      onGoToPlaces={onGoToPlaces}
      trip={trip}
      routes={routes}
      locations={locations}
      onRetryCityIntelligence={onRetryCityIntelligence}
      basicInfo={
        <>
          <InfoRow icon={Tag} label={t("planner.details.tripName")} value={trip.name} />
          <InfoRow
            icon={MapPin}
            label={t("planner.details.destination")}
            value={destLabel}
            accent="destination"
          />
          <InfoRow
            icon={Plane}
            label={t("planner.details.from")}
            value={fromLabel || "—"}
            accent="transport"
          />
          <InfoRow
            icon={CalendarDays}
            label={t("planner.details.dates")}
            value={formatDatesValue(trip, days, t)}
            accent="dates"
          />
          <InfoRow
            icon={CircleDollarSign}
            label={t("planner.details.homeCurrency")}
            value={`${trip.currency.name} (${trip.currency.code})`}
            accent="money"
          />
          {leisureLabel ? (
            <InfoRow
              icon={Compass}
              label={t("planner.details.leisure")}
              value={leisureLabel}
              accent="leisure"
            />
          ) : null}
          <InfoRow
            icon={Utensils}
            label={t("planner.details.mealType")}
            value={mealLabel}
            accent="food"
          />
          {spendLabel ? (
            <InfoRow
              icon={Wallet}
              label={t("planner.details.spendMoney")}
              value={spendLabel}
              accent="money"
            />
          ) : null}
        </>
      }
    />
  );
}

function MultiCityTripDetails({
  trip,
  routes,
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
  const { t } = useI18n();
  const fromLabel = [trip.from.cityName, trip.from.countryName]
    .filter(Boolean)
    .join(", ");
  const days = tripDayCount(trip.startDate, trip.endDate);
  const groups = groupTripDestinationsByCountry(cities);
  const readiness = computeTripReadiness(trip, routes, locations);
  const leisureLabel = leisureLabelForTrip(trip, t);
  const mealLabel = mealLabelForTrip(trip, t);
  const spendLabel = spendLabelForTrip(trip);

  return (
    <TripDetailsShell
      onEdit={onEdit}
      readiness={readiness}
      onGoToPreparation={onGoToPreparation}
      onGoToPlaces={onGoToPlaces}
      trip={trip}
      routes={routes}
      locations={locations}
      onRetryCityIntelligence={onRetryCityIntelligence}
      basicInfo={
        <>
          <InfoRow icon={Tag} label={t("planner.details.tripName")} value={trip.name} />
          <InfoRow
            icon={Plane}
            label={t("planner.details.from")}
            value={fromLabel || "—"}
            accent="transport"
          />
          <InfoRow
            icon={CalendarDays}
            label={t("planner.details.dates")}
            value={formatDatesValue(trip, days, t)}
            accent="dates"
          />
          <InfoRow
            icon={CircleDollarSign}
            label={t("planner.details.currency")}
            value={`${trip.currency.name} (${trip.currency.code})`}
            accent="money"
          />
          {leisureLabel ? (
            <InfoRow
              icon={Compass}
              label={t("planner.details.leisure")}
              value={leisureLabel}
              accent="leisure"
            />
          ) : null}
          <InfoRow
            icon={Utensils}
            label={t("planner.details.mealType")}
            value={mealLabel}
            accent="food"
          />
          {spendLabel ? (
            <InfoRow
              icon={Wallet}
              label={t("planner.details.spendMoney")}
              value={spendLabel}
              accent="money"
            />
          ) : null}
        </>
      }
      destinations={
        <div className="mt-4 space-y-3 border-t border-divider pt-4">
          <p className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
            {t("planner.details.destinations")}
          </p>
          {groups.map((group) => {
            const flag = group.countryCode
              ? getFlagEmoji(group.countryCode)
              : "";
            return (
              <div
                key={group.countryKey}
                className="rounded-2xl border border-border/80 bg-surface/80 px-3 py-3 ring-1 ring-border/40"
              >
                <p className="text-sm font-semibold text-text">
                  {flag ? `${flag} ` : ""}
                  {group.countryName}
                </p>
                <ul className="mt-2.5 space-y-2.5">
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
                        className="flex items-start gap-3 rounded-xl bg-white/70 px-2 py-2 ring-1 ring-border/50 transition-transform duration-200 hover:-translate-y-0.5"
                      >
                        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-divider shadow-sm">
                          {photo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={photo}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center bg-primary-tint text-primary">
                              <MapPin className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-text">
                            {city.cityName}
                          </p>
                          <p
                            className={cx(
                              "mt-0.5 text-xs",
                              datesSet
                                ? "text-text-secondary"
                                : "text-text-muted"
                            )}
                          >
                            {datesLabel}
                          </p>
                          {placeCount > 0 ? (
                            <p className="mt-0.5 text-xs text-text-secondary">
                              {t(
                                placeCount === 1
                                  ? "planner.details.savedPlace_one"
                                  : "planner.details.savedPlace_other",
                                { count: placeCount }
                              )}
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
      }
    />
  );
}

function formatDatesValue(
  trip: TripPlannerDoc,
  days: number,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  const range = formatTripCompactDateRange(trip.startDate, trip.endDate);
  const daysLabel = t(
    days === 1 ? "planner.details.day_one" : "planner.details.day_other"
  );
  return t("planner.details.datesWithDays", {
    range,
    count: days,
    daysLabel,
  });
}

function TripDetailsShell({
  onEdit,
  readiness,
  onGoToPreparation,
  onGoToPlaces,
  trip,
  routes,
  locations,
  onRetryCityIntelligence,
  basicInfo,
  destinations,
}: {
  onEdit?: () => void;
  readiness: ReturnType<typeof computeTripReadiness>;
  onGoToPreparation?: () => void;
  onGoToPlaces?: () => void;
  trip: TripPlannerDoc;
  routes: TripRoute[];
  locations: SavedLocation[];
  onRetryCityIntelligence?: () => void;
  basicInfo: ReactNode;
  destinations?: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            {t("planner.details.title")}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-text-secondary">
            {t("planner.details.subtitle")}
          </p>
        </div>
        {onEdit ? (
          <Button
            type="button"
            variant="secondary"
            icon={Pencil}
            className="shrink-0 self-start sm:self-auto"
            onClick={onEdit}
          >
            {t("planner.details.edit")}
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:gap-5">
        <section className="rounded-3xl border border-border bg-surface-elevated p-4 shadow-sm sm:p-5 lg:col-span-3">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-tint text-primary">
              <Briefcase className="h-4 w-4" aria-hidden />
            </span>
            <h3 className="text-sm font-semibold text-text">
              {t("planner.details.basicInfo")}
            </h3>
          </div>

          <div className="space-y-1">{basicInfo}</div>
          {destinations}
        </section>

        <TripReadinessCard
          readiness={readiness}
          onComplete={onGoToPreparation}
        />
      </div>

      <TripRouteTimeBreakdownSection
        trip={trip}
        routes={routes}
        locations={locations}
      />

      <TripCityIntelligenceBlock
        status={trip.cityIntelligence.status}
        results={trip.cityIntelligence.results}
        errorMessage={trip.cityIntelligence.errorMessage}
        lastUpdatedAt={trip.cityIntelligence.lastUpdatedAt}
        onRetry={onRetryCityIntelligence}
      />

      <section className="rounded-3xl border border-border bg-surface-elevated p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-tint text-primary">
            <Flag className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-text">
              {t("planner.details.nextSteps")}
            </h3>
            <p className="text-xs text-text-secondary">
              {t("planner.details.nextStepsBody")}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NextStepCard
            icon={FileText}
            accent
            title={t("planner.details.goPreparation")}
            subtitle={t("planner.details.goPreparationSub")}
            onClick={onGoToPreparation}
          />
          <NextStepCard
            icon={MapIcon}
            title={t("planner.details.goPlaces")}
            subtitle={t("planner.details.goPlacesSub")}
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

const READINESS_ICON: Record<ReadinessItemId, LucideIcon> = {
  flights: Plane,
  accommodation: BedDouble,
  places: MapPin,
  visa: Stamp,
  payments: CreditCard,
  weather: CloudSun,
  packing: Luggage,
};

const INFO_ACCENT: Record<string, string> = {
  destination: "bg-primary-tint text-primary",
  transport: "bg-[#EEF4FF] text-[#3B5BDB]",
  dates: "bg-[#ECFDF5] text-[#047857]",
  money: "bg-[#FEF9C3] text-[#A16207]",
  leisure: "bg-[#FDF2F8] text-[#BE185D]",
  food: "bg-[#FFF4E8] text-[#C2410C]",
  default: "bg-surface text-text-secondary",
};

function TripReadinessCard({
  readiness,
  onComplete,
}: {
  readiness: ReturnType<typeof computeTripReadiness>;
  onComplete?: () => void;
}) {
  const { t } = useI18n();
  const complete = readiness.percent >= 100;
  const doneCount = readiness.items.filter((item) => item.tone === "done").length;
  const leftCount = readiness.items.length - doneCount;

  return (
    <section className="relative flex flex-col overflow-hidden rounded-3xl border border-primary/10 bg-gradient-to-br from-primary-tint via-surface-elevated to-surface p-4 shadow-sm sm:p-5 lg:col-span-2">
      <div
        className="pointer-events-none absolute -top-14 -right-10 h-36 w-36 rounded-full bg-primary/10 blur-2xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-primary-light/10 blur-3xl"
        aria-hidden
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-primary uppercase shadow-sm ring-1 ring-primary/10">
            {complete ? (
              <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
            ) : null}
            {t("planner.details.readinessTitle", {
              percent: readiness.percent,
            })}
          </span>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-text tabular-nums">
            {readiness.percent}%
          </p>
          <p className="mt-1 text-xs leading-relaxed text-text-secondary">
            {complete
              ? t("planner.details.readinessReady")
              : t("planner.details.readinessTodo")}
          </p>
        </div>
      </div>

      <div className="relative mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-white/80 px-3 py-2.5 shadow-sm ring-1 ring-success/15">
          <p className="text-[10px] font-semibold tracking-wide text-text-muted uppercase">
            {t("planner.details.statusDone")}
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-success">
            {doneCount}
          </p>
        </div>
        <div className="rounded-2xl bg-white/70 px-3 py-2.5 shadow-sm ring-1 ring-border/70">
          <p className="text-[10px] font-semibold tracking-wide text-text-muted uppercase">
            {t("planner.details.statusLeft")}
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-text">
            {leftCount}
          </p>
        </div>
      </div>

      <div className="relative mt-4 h-2.5 overflow-hidden rounded-full bg-white/70 ring-1 ring-border/60">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${readiness.percent}%` }}
        />
      </div>

      <ul className="relative mt-4 flex-1 space-y-1">
        {readiness.items.map((item) => (
          <ReadinessRow key={item.id} item={item} />
        ))}
      </ul>

      {!complete ? (
        <Button
          type="button"
          color="primary"
          className="relative mt-4 w-full !rounded-xl"
          onClick={onComplete}
        >
          {t("planner.details.readinessCta")}
        </Button>
      ) : (
        <div className="relative mt-4 inline-flex items-center justify-center gap-1.5 rounded-xl bg-success-background px-3 py-2.5 text-sm font-medium text-success ring-1 ring-success/15">
          <Check className="h-4 w-4" aria-hidden />
          {t("planner.details.readinessDone")}
        </div>
      )}
    </section>
  );
}

function ReadinessRow({ item }: { item: ReadinessItem }) {
  const Icon = READINESS_ICON[item.id];
  return (
    <li className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 transition-colors hover:bg-white/50">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/80 text-text-secondary shadow-sm ring-1 ring-border/60">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-text">
        {item.label}
      </span>
      <ReadinessStatus item={item} />
    </li>
  );
}

function ReadinessStatus({ item }: { item: ReadinessItem }) {
  const { t } = useI18n();
  if (item.tone === "done") {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-success-background text-success ring-1 ring-success/15"
        aria-label={t("planner.details.statusDone")}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
    );
  }
  if (item.tone === "progress") {
    return (
      <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold tabular-nums text-text-secondary ring-1 ring-border/70">
        {item.score}%
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-warning-background text-warning ring-1 ring-warning/15"
      aria-label={t("planner.details.statusAttention")}
    >
      <AlertTriangle className="h-3.5 w-3.5" />
    </span>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  accent = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  accent?: keyof typeof INFO_ACCENT | string;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-2xl px-2 py-2.5 transition-colors hover:bg-surface">
      <span
        className={cx(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105",
          INFO_ACCENT[accent] ?? INFO_ACCENT.default
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="w-28 shrink-0 text-sm text-text-secondary sm:w-32">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate text-right text-sm font-medium text-text">
        {value}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
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
  icon: LucideIcon;
  title: string;
  subtitle: string;
  onClick?: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "group flex items-center gap-3 rounded-2xl border px-4 py-4 text-left shadow-sm transition-all duration-200",
        "hover:-translate-y-0.5 hover:shadow-md",
        accent
          ? "border-primary/20 bg-primary-tint/50 hover:border-primary/35 hover:bg-primary-tint"
          : "border-border bg-surface hover:border-primary/25 hover:bg-primary-tint/30"
      )}
    >
      <span
        className={cx(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-transform duration-200 group-hover:scale-105",
          accent
            ? "bg-white text-primary shadow-sm ring-1 ring-primary/10"
            : "bg-white text-text-secondary ring-1 ring-border"
        )}
      >
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-text">{title}</span>
        <span className="mt-0.5 block text-xs text-text-secondary">
          {subtitle}
        </span>
      </span>
      <ChevronRight
        className={cx(
          "h-5 w-5 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5",
          accent ? "text-primary" : "text-text-muted"
        )}
      />
    </button>
  );
}
