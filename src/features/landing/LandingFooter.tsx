"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Mail } from "lucide-react";
import { useI18n } from "@/i18n";
import { openCookieSettings } from "@/lib/cookies";

/**
 * Landing footer — three-column brand / product / CTA layout.
 */
export function LandingFooter() {
  const { t } = useI18n();
  const year = new Date().getFullYear();

  const productLinks = [
    { href: "#pricing", label: t("landing.nav.pricing") },
    { href: "#trip-planner", label: t("landing.nav.tripPlanner") },
    { href: "#how-it-works", label: t("landing.nav.howItWorks") },
    { href: "#explore", label: t("landing.nav.explore") },
    { href: "/journal", label: t("landing.nav.journal") },
    { href: "/login", label: t("landing.nav.startForFree") },
  ] as const;

  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto max-w-6xl px-4 pt-14 pb-8 sm:px-6 sm:pt-16 sm:pb-10">
        <div className="grid gap-12 md:grid-cols-3 md:gap-10 lg:gap-16">
          <div className="max-w-sm">
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <Image
                src="/icon.svg"
                alt=""
                width={28}
                height={28}
                className="h-7 w-7"
              />
              <span className="text-base font-semibold tracking-tight text-text">
                PinToTrip
              </span>
            </Link>

            <p className="mt-4 text-sm leading-relaxed text-text-secondary">
              {t("landing.footer.tagline")}
            </p>

            <ul className="mt-6 space-y-3">
              <li>
                <a
                  href="mailto:support@pintototrip.app"
                  className="inline-flex items-center gap-2.5 text-sm text-text-secondary transition-colors hover:text-text"
                >
                  <Mail className="h-4 w-4 shrink-0" aria-hidden />
                  support@pintototrip.app
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-text">
              {t("landing.footer.product")}
            </h2>
            <ul className="mt-5 space-y-3">
              {productLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-text-secondary transition-colors hover:text-text"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-text">
              {t("landing.footer.start")}
            </h2>
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-text-secondary">
              {t("landing.footer.startBody")}
            </p>
            <Link
              href="/login"
              className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-text/20 bg-white px-5 text-sm font-medium text-text transition-all duration-200 hover:border-primary hover:bg-primary-tint hover:text-primary active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t("landing.nav.startForFree")}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-border pt-6 sm:mt-14 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-text-muted">
            {t("landing.footer.copyright", { year })}
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            <li>
              <Link
                href="/privacy"
                className="text-xs text-text-muted transition-colors hover:text-text-secondary"
              >
                {t("landing.footer.privacy")}
              </Link>
            </li>
            <li>
              <Link
                href="/terms"
                className="text-xs text-text-muted transition-colors hover:text-text-secondary"
              >
                {t("landing.footer.terms")}
              </Link>
            </li>
            <li>
              <Link
                href="/refund"
                className="text-xs text-text-muted transition-colors hover:text-text-secondary"
              >
                {t("landing.footer.refund")}
              </Link>
            </li>
            <li>
              <button
                type="button"
                onClick={() => openCookieSettings()}
                className="text-xs text-text-muted transition-colors hover:text-text-secondary"
              >
                {t("landing.footer.cookies")}
              </button>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
