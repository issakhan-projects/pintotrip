"use client";

import Image from "next/image";
import { LANDING_IMAGES } from "../constants";

export function MapSection() {
  return (
    <section className="border-t border-border bg-background py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-text sm:text-3xl">
            Your world, saved.
          </h2>
          <p className="mt-2 text-sm text-text-secondary sm:text-base">
            Every place you want to visit, in one map.
          </p>
        </div>

        <div className="mt-6 sm:mt-8">
          <Image
            src={LANDING_IMAGES.mapVisual}
            alt="Map with saved travel places around the world"
            width={1600}
            height={900}
            className="h-auto w-full"
            sizes="(max-width: 1152px) 100vw, 1152px"
            priority={false}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-xs text-text-secondary">
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-primary" />
            Planned
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-visited" />
            Visited
          </span>
        </div>
      </div>
    </section>
  );
}
