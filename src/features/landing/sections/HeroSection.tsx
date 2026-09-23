"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Camera,
  Info,
  MapPinned,
  Play,
} from "lucide-react";
import { useI18n } from "@/i18n";
import { HERO_FEATURE_KEYS, LANDING_IMAGES } from "../constants";

const FEATURE_ICONS = [Camera, MapPinned, Info] as const;

/**
 * Hero — copy left, travel photo + floating product cards right.
 * No phone mockup.
 */
export function HeroSection() {
  const { t } = useI18n();
  const demoCity = t("landing.demo.city");
  const demoCountry = t("landing.demo.country");
  const demoPlace = `${demoCity}, ${demoCountry}`;

  return (
    <section className="bg-background">
      <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-10 sm:gap-10 sm:px-6 sm:py-14 lg:grid-cols-2 lg:gap-12">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
            {t("landing.hero.eyebrow")}
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-text sm:text-5xl lg:text-[3.25rem] lg:leading-[1.08]">
            {t("landing.hero.title")}
          </h1>
          <p className="mt-3 max-w-md text-base text-text-secondary sm:text-lg">
            {t("landing.hero.sub")}
          </p>

          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <Link href="/login" className="btn-primary h-11 gap-2 px-5">
              {t("landing.nav.startForFree")}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <a href="#how-it-works" className="btn-secondary h-11 gap-2 px-5">
              <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
              {t("landing.hero.seeHow")}
            </a>
          </div>

          <ul className="mt-8 space-y-3">
            {HERO_FEATURE_KEYS.map((key, i) => {
              const Icon = FEATURE_ICONS[i]!;
              const label = t(`landing.hero.features.${key}`);
              return (
                <li
                  key={key}
                  className="flex items-center gap-3 text-sm text-text-secondary"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-tint text-primary">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  {label}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Product visual — photo + floating UI, no phone */}
        <div className="relative mx-auto w-full max-w-lg lg:max-w-none">
          <div className="relative aspect-[4/5] overflow-hidden rounded-3xl sm:aspect-[5/6]">
            <Image
              src={LANDING_IMAGES.heroPetra}
              alt="Travel photo of Petra, Jordan"
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
          </div>

          {/* Floating map card */}
          <div className="absolute top-5 right-3 w-[46%] overflow-hidden rounded-2xl border border-white/60 bg-white/95 shadow-lg backdrop-blur sm:top-8 sm:right-5 sm:w-[42%]">
            <div className="relative aspect-[5/4] bg-[#e8eef3]">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_40%_45%,#d4e4f0,transparent_60%)]" />
              <div className="absolute left-1/2 top-[48%] -translate-x-1/2 -translate-y-full">
                <MapPinned className="h-7 w-7 fill-planned text-planned drop-shadow" />
              </div>
              <p className="absolute bottom-2 left-2 right-2 truncate rounded-md bg-white/90 px-2 py-1 text-[10px] font-semibold text-text shadow-sm">
                {demoPlace}
              </p>
            </div>
          </div>

          {/* Floating place card */}
          <div className="absolute bottom-5 left-3 right-3 rounded-2xl border border-white/70 bg-white p-3.5 shadow-xl sm:bottom-8 sm:left-5 sm:right-auto sm:w-[58%]">
            <div className="flex gap-3">
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl">
                <Image
                  src={LANDING_IMAGES.petra}
                  alt=""
                  fill
                  className="object-cover"
                  sizes="56px"
                />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                  {demoPlace}
                </p>
                <p className="mt-0.5 truncate text-sm font-semibold text-text">
                  {t("landing.demo.placeName")}
                </p>
                <p className="mt-1 text-[11px] text-success">
                  {t("landing.hero.saved")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
