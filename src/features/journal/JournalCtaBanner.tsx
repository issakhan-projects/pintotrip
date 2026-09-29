"use client";

import Link from "next/link";
import { ArrowRight, Bookmark, MapPin, Plane } from "lucide-react";
import { formatJournalCategory } from "./categories";

type Props = {
  categories: string[];
  /** Prefer the article cover; falls back to a travel photo. */
  imageUrl?: string;
};

const FALLBACK_IMAGE =
  "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?auto=format&fit=crop&w=1600&q=80";

const FEATURES = [
  { icon: MapPin, label: "Save places on a map" },
  { icon: Bookmark, label: "Build your travel list" },
  { icon: Plane, label: "Plan future trips" },
] as const;

function ctaHeadline(categories: string[]): string {
  const primary = categories[0];
  if (!primary) return "Add these places to your travel list";
  const label = formatJournalCategory(primary).toLowerCase();
  return `Add these ${label} to your travel list`;
}

/**
 * End-of-article magazine CTA — text + wavy photo panel (no device mockup).
 */
export function JournalCtaBanner({ categories, imageUrl }: Props) {
  const photo = imageUrl?.trim() || FALLBACK_IMAGE;

  return (
    <section className="relative overflow-hidden rounded-3xl bg-slate-50">
      <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
        {/* Copy */}
        <div className="relative z-10 px-6 py-8 sm:px-9 sm:py-10 lg:px-11 lg:py-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text">
            <span className="text-text">Pinto</span>
            <span className="text-text-muted">Trip</span>
          </p>

          <h2 className="mt-5 max-w-md font-[family-name:var(--font-manrope)] text-2xl font-bold tracking-tight text-text sm:text-3xl sm:leading-tight">
            {ctaHeadline(categories)}
          </h2>

          <p className="mt-3 max-w-md text-sm leading-relaxed text-text-secondary sm:text-base">
            Save the places that inspire you and build your next cultural
            journey with PinToTrip.
          </p>

          {/* Dashed flight path (decorative) */}
          <div
            className="pointer-events-none absolute top-[7.5rem] right-4 hidden w-44 text-primary lg:block xl:right-8"
            aria-hidden
          >
            <svg
              viewBox="0 0 176 100"
              fill="none"
              className="h-24 w-full overflow-visible"
            >
              <path
                d="M8 88 C 48 78, 78 36, 128 24"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="4 5"
                strokeLinecap="round"
                opacity="0.55"
              />
            </svg>
            <Plane className="absolute top-2 right-2 h-5 w-5 -rotate-[28deg] text-primary" />
          </div>

          <Link
            href="/login"
            className="mt-7 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-hover"
          >
            Plan your trip
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>

          <ul className="mt-8 flex flex-col gap-4 sm:mt-10 sm:flex-row sm:flex-wrap sm:items-center sm:gap-0">
            {FEATURES.map((feature, i) => {
              const Icon = feature.icon;
              return (
                <li
                  key={feature.label}
                  className="flex items-center gap-2.5 sm:px-4 sm:first:pl-0 sm:last:pr-0"
                >
                  {i > 0 ? (
                    <span
                      className="mr-4 hidden h-8 w-px bg-border sm:block"
                      aria-hidden
                    />
                  ) : null}
                  <Icon
                    className="h-4 w-4 shrink-0 text-text-muted"
                    aria-hidden
                  />
                  <span className="text-sm text-text-secondary">
                    {feature.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Photo panel — wavy edge, no phone */}
        <div className="relative min-h-[220px] sm:min-h-[280px] lg:min-h-full">
          {/* eslint-disable-next-line @next/next/no-img-element -- dynamic cover / Unsplash */}
          <img
            src={photo}
            alt=""
            loading="lazy"
            decoding="async"
            className="journal-cta-photo absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-slate-50 to-transparent lg:hidden" />
        </div>
      </div>
    </section>
  );
}
