"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useI18n } from "@/i18n";
import { LANDING_IMAGES } from "../constants";

export function FinalCtaSection() {
  const { t } = useI18n();

  return (
    <section className="border-t border-border bg-background">
      <div className="mx-auto">
        <div className="relative overflow-hidden">
          <div className="relative min-h-[320px] sm:min-h-[380px]">
            <Image
              src={LANDING_IMAGES.finalCta}
              alt=""
              fill
              sizes="100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/45 to-black/20" />

            <div className="absolute inset-0 flex flex-col justify-end p-6 sm:justify-center sm:p-10 lg:p-14">
              <h2 className="max-w-md text-2xl font-semibold tracking-tight text-white sm:text-3xl sm:leading-tight">
                {t("landing.cta.title")}
              </h2>
              <p className="mt-2 text-sm text-white/85 sm:text-base">
                {t("landing.cta.sub")}
              </p>
              <Link
                href="/login"
                className="btn-primary mt-6 h-11 w-fit gap-2 px-5"
              >
                {t("landing.nav.startForFree")}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
