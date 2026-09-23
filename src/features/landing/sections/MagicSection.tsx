"use client";

import Image from "next/image";
import { Check, Loader2, Sparkles } from "lucide-react";
import { useI18n } from "@/i18n";
import { LANDING_IMAGES } from "../constants";

const STEP_KEYS = ["drop", "find", "map"] as const;

export function MagicSection() {
  const { t } = useI18n();
  const steps = STEP_KEYS.map((key) => ({
    key,
    title: t(`landing.magic.steps.${key}.title`),
    body: t(`landing.magic.steps.${key}.body`),
  }));

  return (
    <section
      id="how-it-works"
      className="scroll-mt-16 border-t border-border bg-surface py-12 sm:py-16"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="max-w-xl text-2xl font-semibold tracking-tight text-text sm:text-3xl">
          {t("landing.magic.title")}
          <span className="mt-1 block text-text-secondary">
            {t("landing.magic.subtitle")}
          </span>
        </h2>

        <div className="mt-8 grid gap-4 sm:mt-10 md:grid-cols-3">
          {/* Step 1 */}
          <article className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
            <div className="relative aspect-[4/3]">
              <Image
                src={LANDING_IMAGES.petra}
                alt="Travel photo to identify"
                fill
                sizes="(max-width: 768px) 100vw, 33vw"
                className="object-cover"
              />
              <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-text shadow-sm">
                1 · {steps[0].title}
              </span>
            </div>
            <div className="px-4 py-3">
              <p className="text-sm text-text-secondary">{steps[0].body}</p>
            </div>
          </article>

          {/* Step 2 */}
          <article className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
            <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 bg-primary-tint px-4">
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-text shadow-sm">
                2 · {steps[1].title}
              </span>
              <div className="flex items-center gap-2 rounded-xl border border-primary/15 bg-white px-4 py-3 shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm font-medium text-text">
                  {t("landing.magic.finding")}
                </span>
                <Sparkles className="h-4 w-4 text-primary-light" />
              </div>
            </div>
            <div className="px-4 py-3">
              <p className="text-sm text-text-secondary">{steps[1].body}</p>
            </div>
          </article>

          {/* Step 3 */}
          <article className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
            <div className="relative flex aspect-[4/3] flex-col justify-between p-4">
              <Image
                src="/petramap.png"
                alt=""
                fill
                sizes="(max-width: 768px) 100vw, 33vw"
                className="object-cover"
              />
              <span className="relative z-10 w-fit rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-text shadow-sm">
                3 · {steps[2].title}
              </span>
              <div className="relative z-10 rounded-xl border border-border bg-white/95 p-3 shadow-sm backdrop-blur-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-primary">
                      {t("landing.demo.city")}, {t("landing.demo.country")}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-text">
                      {t("landing.demo.placeName")}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-success-background px-2 py-0.5 text-[10px] font-semibold text-success">
                    <Check className="h-3 w-3" strokeWidth={3} />
                    {t("landing.magic.saved")}
                  </span>
                </div>
              </div>
            </div>
            <div className="border-t border-divider px-4 py-3">
              <p className="text-sm text-text-secondary">{steps[2].body}</p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
