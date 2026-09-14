"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CircleDollarSign,
  Coins,
  Landmark,
  Lightbulb,
  Stamp,
} from "lucide-react";
import { TOKYO_PREVIEW } from "../constants";

const FEATURES = [
  { label: "Best time to visit", Icon: CalendarDays },
  { label: "Daily budget", Icon: CircleDollarSign },
  { label: "Currency", Icon: Coins },
  { label: "Visa", Icon: Stamp },
  { label: "Top attractions", Icon: Landmark },
  { label: "Local tips", Icon: Lightbulb },
] as const;

export function ExploreSection() {
  return (
    <section
      id="explore"
      className="scroll-mt-16 border-t border-border bg-surface py-12 sm:py-16"
    >
      <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.15fr_0.95fr] lg:gap-8 lg:items-start">
        {/* Left copy */}
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text sm:text-3xl">
            More than a pin.
          </h2>
          <p className="mt-2 text-sm text-text-secondary sm:text-base">
            Know the place before you go.
          </p>

          <ul className="mt-6 space-y-3">
            {FEATURES.map(({ label, Icon }) => (
              <li
                key={label}
                className="flex items-center gap-3 text-sm text-text-secondary"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-primary shadow-sm ring-1 ring-border">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                {label}
              </li>
            ))}
          </ul>

          <Link href="/login" className="btn-secondary mt-7 h-10 gap-2 px-4">
            Explore Tokyo
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>

        {/* Center imagery */}
        <div>
          <div className="relative aspect-[4/5] overflow-hidden rounded-2xl sm:aspect-[5/6]">
            <Image
              src={TOKYO_PREVIEW.image}
              alt="Tokyo with Mount Fuji"
              fill
              sizes="(max-width: 1024px) 100vw, 40vw"
              className="object-cover"
            />
          </div>
          {/* <div className="mt-3 grid grid-cols-4 gap-2">
            {TOKYO_PREVIEW.gallery.map((src) => (
              <div
                key={src}
                className="relative aspect-square overflow-hidden rounded-xl"
              >
                <Image
                  src={src}
                  alt=""
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              </div>
            ))}
          </div> */}
        </div>

        {/* Right info card */}
        <article className="rounded-2xl border border-border bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
            {TOKYO_PREVIEW.country}
          </p>
          <h3 className="mt-1 text-2xl font-semibold tracking-tight text-text">
            {TOKYO_PREVIEW.city}
          </h3>

          <dl className="mt-5 space-y-4">
            <InfoRow label="Best time" value={TOKYO_PREVIEW.bestTime} />
            <InfoRow label="Daily budget" value={TOKYO_PREVIEW.budget} />
            <InfoRow label="Currency" value={TOKYO_PREVIEW.currency} />
            <InfoRow label="Visa" value={TOKYO_PREVIEW.visa} />
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                Top attractions
              </dt>
              <dd className="mt-1.5 flex flex-wrap gap-1.5">
                {TOKYO_PREVIEW.attractions.map((item) => (
                  <span
                    key={item}
                    className="rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-text"
                  >
                    {item}
                  </span>
                ))}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                Local tips
              </dt>
              <dd className="mt-1 text-sm text-text-secondary">
                {TOKYO_PREVIEW.tips.join(" · ")}
              </dd>
            </div>
          </dl>
        </article>
      </div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-text">{value}</dd>
    </div>
  );
}
