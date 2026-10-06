"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Crown,
  GripVertical,
  ListOrdered,
  Map as MapIcon,
  MapPin,
  Plane,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { useI18n } from "@/i18n";
import { cx } from "@/lib/utils";
import { LANDING_IMAGES } from "../constants";

const FEATURE_KEYS = [
  { key: "itinerary", Icon: CalendarDays },
  { key: "route", Icon: MapIcon },
  { key: "ease", Icon: Plane },
  { key: "flexible", Icon: SlidersHorizontal },
] as const;

const DAY1_PLACES = [
  {
    placeKey: "acropolis",
    categoryKey: "attraction",
    image: LANDING_IMAGES.athens,
    visited: true,
  },
  {
    placeKey: "plaka",
    categoryKey: "neighborhood",
    image: LANDING_IMAGES.plaka,
    visited: false,
  },
] as const;

const DAY2_PLACES = [
  {
    placeKey: "oia",
    categoryKey: "viewpoint",
    image: LANDING_IMAGES.oia,
    visited: false,
  },
  {
    placeKey: "fira",
    categoryKey: "town",
    image: LANDING_IMAGES.fira,
    visited: false,
  },
  {
    placeKey: "kamari",
    categoryKey: "beach",
    image: LANDING_IMAGES.kamari,
    visited: false,
  },
] as const;

const MAP_PINS = [
  { left: "22%", top: "58%", n: "1", placeKey: "oia" },
  { left: "48%", top: "34%", n: "2", placeKey: "fira" },
  { left: "74%", top: "62%", n: "3", placeKey: "kamari" },
] as const;

type PreviewView = "itinerary" | "map";

/**
 * Trip Planner — Pro feature story with product UI cards (no phone mockups).
 */
export function TripPlannerSection() {
  const { t } = useI18n();
  const [view, setView] = useState<PreviewView>("itinerary");

  return (
    <section
      id="trip-planner"
      className="relative scroll-mt-16 overflow-hidden border-t border-border py-14 sm:py-20"
    >
      <Image
        src={LANDING_IMAGES.santorini}
        alt=""
        fill
        sizes="100vw"
        className="object-cover object-[center_35%] opacity-40"
        priority={false}
      />
      <div
        className="absolute inset-0 bg-gradient-to-r from-white via-white/92 to-white/55"
        aria-hidden
      />
      <div
        className="absolute inset-0 bg-gradient-to-b from-white/40 via-transparent to-white/70"
        aria-hidden
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:gap-12">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-[#FDE3A1] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#78590C]">
            <Crown className="h-3 w-3" strokeWidth={2.5} aria-hidden />
            {t("landing.planner.badge")}
          </span>

          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            {t("landing.planner.title")}
          </h2>
          <p className="mt-2 text-base font-medium text-text sm:text-lg">
            {t("landing.planner.lead")}
          </p>
          <p className="mt-2 max-w-md text-sm text-text-secondary sm:text-base">
            {t("landing.planner.body")}
          </p>

          <ul className="mt-7 space-y-4">
            {FEATURE_KEYS.map(({ key, Icon }) => (
              <li key={key} className="flex gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-text shadow-sm ring-1 ring-border">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-semibold text-text">
                    {t(`landing.planner.features.${key}.title`)}
                  </p>
                  <p className="mt-0.5 text-sm text-text-secondary">
                    {t(`landing.planner.features.${key}.body`)}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="#pricing"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-text px-5 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-text/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <Crown
                className="h-4 w-4 text-amber-300"
                strokeWidth={2.25}
                aria-hidden
              />
              {t("landing.planner.upgrade")}
            </Link>
            <a
              href="#pricing"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary transition-colors hover:text-text"
            >
              {t("landing.planner.learnMore")}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-lg pb-14 pt-10 lg:max-w-none">
          <p
            className="pointer-events-none absolute -top-1 right-0 z-20 max-w-[9.5rem] text-right font-[family-name:var(--font-lobster)] text-[15px] leading-snug text-primary sm:-top-3 sm:right-2 sm:text-base"
            aria-hidden
          >
            {t("landing.planner.demoScript")}
            <svg
              className="ml-auto mt-0.5 h-8 w-10 text-primary/70"
              viewBox="0 0 40 32"
              fill="none"
              aria-hidden
            >
              <path
                d="M8 4c8 2 18 6 22 18"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <path
                d="M26 18l4 4-6 1"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </p>

          <div className="relative z-10 flex flex-col gap-4 rounded-2xl border border-border p-4 backdrop-blur-sm sm:p-5">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold tracking-tight text-text sm:text-xl">
                {t("landing.planner.demo.previewTitle")}
              </h3>
              <p className="mt-1 text-sm text-text-secondary">
                {t("landing.planner.demo.previewBody")}
              </p>
              <p className="mt-2 text-xs font-medium text-text-muted">
                {t("landing.planner.demo.tripMeta")}
              </p>
            </div>

            <div className="grid grid-cols-2 rounded-xl bg-surface p-1">
              <ViewTab
                active={view === "itinerary"}
                onClick={() => setView("itinerary")}
                icon={<ListOrdered className="h-4 w-4" />}
                label={t("landing.planner.demo.itinerary")}
              />
              <ViewTab
                active={view === "map"}
                onClick={() => setView("map")}
                icon={<MapIcon className="h-4 w-4" />}
                label={t("landing.planner.demo.map")}
              />
            </div>

            {view === "map" ? <MapPreview /> : <ItineraryPreview />}
          </div>

          <p
            className="pointer-events-none absolute -bottom-1 left-1 z-20 max-w-[10rem] font-[family-name:var(--font-lobster)] text-[14px] leading-snug text-primary sm:left-0 sm:text-[15px]"
            aria-hidden
          >
            <svg
              className="mb-0.5 h-7 w-9 text-primary/70"
              viewBox="0 0 36 28"
              fill="none"
              aria-hidden
            >
              <path
                d="M28 4C18 8 10 14 6 24"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <path
                d="M12 20L6 24l5-4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {t("landing.planner.demo.scriptMore")}
          </p>

          <p
            className="pointer-events-none absolute right-0 top-[42%] z-20 hidden max-w-[7rem] text-right font-[family-name:var(--font-lobster)] text-[14px] leading-snug text-primary sm:block"
            aria-hidden
          >
            {t("landing.planner.demo.scriptPlan")}
            <svg
              className="ml-auto mt-0.5 h-6 w-8 text-primary/70"
              viewBox="0 0 32 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M26 6C16 8 10 12 4 18"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <path
                d="M10 14L4 18l5-2"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </p>
        </div>
      </div>
    </section>
  );
}

function ViewTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-surface-elevated text-primary shadow-sm"
          : "text-text-secondary hover:text-text"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function ItineraryPreview() {
  const { t } = useI18n();

  const days = [
    {
      day: 1,
      dayKey: "day1" as const,
      places: DAY1_PLACES,
    },
    {
      day: 2,
      dayKey: "day2" as const,
      places: DAY2_PLACES,
    },
  ];

  return (
    <div className="space-y-4">
      {days.map((day) => (
        <section
          key={day.day}
          className="rounded-2xl border border-border bg-surface-elevated p-4"
        >
          <header>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-text">
                {t("landing.planner.demo.dayHeading", {
                  day: day.day,
                  date: t(`landing.planner.demo.${day.dayKey}.dateLabel`),
                })}
              </p>
              <span className="inline-flex shrink-0 items-center gap-1 text-xs text-text-secondary">
                {t("landing.planner.demo.placesCount", {
                  count: day.places.length,
                })}
                <ChevronDown className="h-4 w-4" />
              </span>
            </div>
            <h4 className="mt-1 text-base font-semibold text-text">
              {t(`landing.planner.demo.${day.dayKey}.title`)}
            </h4>
            <p className="mt-0.5 text-sm text-text-secondary">
              {t(`landing.planner.demo.${day.dayKey}.description`)}
            </p>
          </header>

          <ul className="mt-4 space-y-1">
            {day.places.map((place) => (
              <li
                key={place.placeKey}
                className="flex items-start gap-3 rounded-xl px-1 py-2"
              >
                <span
                  className={cx(
                    "mt-3 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                    place.visited
                      ? "border-primary bg-primary text-white"
                      : "border-border bg-white"
                  )}
                  aria-hidden
                >
                  {place.visited ? <Check className="h-3 w-3" /> : null}
                </span>

                <div className="relative mt-0.5 h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-divider">
                  <Image
                    src={place.image}
                    alt=""
                    fill
                    sizes="44px"
                    className="object-cover"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-semibold text-text">
                      {t(
                        `landing.planner.demo.places.${place.placeKey}.title`
                      )}
                    </p>
                    <span className="shrink-0 rounded-full bg-primary-tint px-2 py-0.5 text-[10px] font-medium text-primary">
                      {t(
                        `landing.planner.demo.categories.${place.categoryKey}`
                      )}
                    </span>
                  </div>
                  <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-text-secondary">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                      {t(
                        `landing.planner.demo.places.${place.placeKey}.city`
                      )}
                    </span>
                  </p>
                </div>

                <span className="mt-3 text-text-muted" aria-hidden>
                  <GripVertical className="h-4 w-4" />
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-surface px-3 py-3 text-sm font-medium text-text-secondary">
            <Plus className="h-4 w-4" />
            {t("landing.planner.demo.addPlace")}
          </div>
        </section>
      ))}
    </div>
  );
}

function MapPreview() {
  const { t } = useI18n();

  return (
    <div className="relative h-[min(52vh,420px)] min-h-[280px] overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_40%,#d4e4f0,transparent_55%),radial-gradient(ellipse_at_75%_65%,#c5d8e8,transparent_50%),linear-gradient(160deg,#eef3f7,#e2ebf2)]" />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 360 320"
        fill="none"
        aria-hidden
      >
        <path
          d="M80 190C130 150 170 95 220 110c48 14 78 78 140 62"
          stroke="var(--color-primary)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="7 6"
          className="opacity-80"
        />
      </svg>

      {MAP_PINS.map((pin) => (
        <span
          key={pin.n}
          className="absolute z-10 flex -translate-x-1/2 -translate-y-full flex-col items-center"
          style={{ left: pin.left, top: pin.top }}
        >
          <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-semibold text-text shadow-sm ring-1 ring-border">
            {t(`landing.planner.demo.places.${pin.placeKey}.title`)}
          </span>
          <span className="mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white shadow-md ring-2 ring-white">
            {pin.n}
          </span>
        </span>
      ))}

      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/45 to-transparent px-3 pb-3 pt-10">
        <div className="rounded-xl bg-surface-elevated/95 px-3 py-3 shadow-sm ring-1 ring-border backdrop-blur-sm">
          <p className="text-sm font-medium text-text">
            {t("landing.planner.demo.mapDay")}
          </p>
          <p className="mt-0.5 text-xs text-text-secondary">
            {t("landing.planner.demo.mapHint")}
          </p>
        </div>
      </div>
    </div>
  );
}
