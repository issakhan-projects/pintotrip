"use client";

import Image from "next/image";
import { useI18n } from "@/i18n";
import { LANDING_IMAGES } from "../constants";

export function MapSection() {
  const { t } = useI18n();

  return (
    <section className="border-t border-border bg-background py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-text sm:text-3xl">
            {t("landing.map.title")}
          </h2>
          <p className="mt-2 text-sm text-text-secondary sm:text-base">
            {t("landing.map.sub")}
          </p>
        </div>

        <div className="mt-6 sm:mt-8">
          <Image
            src={LANDING_IMAGES.mapVisual}
            alt={t("landing.map.alt")}
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
            {t("landing.map.planned")}
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-visited" />
            {t("landing.map.visited")}
          </span>
        </div>
      </div>
    </section>
  );
}
