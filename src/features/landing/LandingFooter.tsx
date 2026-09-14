"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Mail } from "lucide-react";
import { openCookieSettings } from "@/lib/cookies";

const PRODUCT_LINKS = [
  { href: "#pricing", label: "Pricing" },
  { href: "#trip-planner", label: "Trip Planner" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#explore", label: "Explore" },
  { href: "/login", label: "Start for free" },
] as const;

/**
 * Landing footer — three-column brand / product / CTA layout.
 */
export function LandingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto max-w-6xl px-4 pt-14 pb-8 sm:px-6 sm:pt-16 sm:pb-10">
        <div className="grid gap-12 md:grid-cols-3 md:gap-10 lg:gap-16">
          {/* Brand + contact */}
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
              Turn any travel photo into a place on your map.
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

          {/* Product links */}
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-text">
              Product
            </h2>
            <ul className="mt-5 space-y-3">
              {PRODUCT_LINKS.map((link) => (
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

          {/* Start CTA */}
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-text">
              Start
            </h2>
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-text-secondary">
              Your next destination might already be in your camera roll.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-text/20 bg-white px-5 text-sm font-medium text-text transition-all duration-200 hover:border-primary hover:bg-primary-tint hover:text-primary active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Start for free
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 flex flex-col gap-4 border-t border-border pt-6 sm:mt-14 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-text-muted">
            © {year} PinToTrip. All rights reserved.
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            <li>
              <Link
                href="/privacy"
                className="text-xs text-text-muted transition-colors hover:text-text-secondary"
              >
                Privacy Policy
              </Link>
            </li>
            <li>
              <Link
                href="/terms"
                className="text-xs text-text-muted transition-colors hover:text-text-secondary"
              >
                Terms of Use
              </Link>
            </li>
            <li>
              <button
                type="button"
                onClick={() => openCookieSettings()}
                className="text-xs text-text-muted transition-colors hover:text-text-secondary"
              >
                Cookie Settings
              </button>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
