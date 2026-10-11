"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { LanguageMenu } from "@/components/LanguageMenu";
import { useI18n } from "@/i18n";
import { cx } from "@/lib/utils";

export function LandingNav() {
  const { t } = useI18n();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  const navLinks = [
    { href: "#explore", label: t("landing.nav.explore") },
    { href: "#trip-planner", label: t("landing.nav.tripPlanner") },
    { href: "#how-it-works", label: t("landing.nav.howItWorks") },
    { href: "#pricing", label: t("landing.nav.pricing") },
    // TODO: re-enable when journal section is improved
    // { href: "/journal", label: t("landing.nav.journal") },
  ] as const;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={cx(
        "sticky top-0 z-50 border-b bg-white/95 backdrop-blur-md transition-[border-color,box-shadow] duration-200",
        scrolled || open ? "border-border shadow-sm" : "border-transparent"
      )}
    >
      <nav className="mx-auto grid h-14 max-w-6xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 sm:px-6 md:gap-4">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Image
            src="/icon.svg"
            alt=""
            width={26}
            height={26}
            className="h-7 w-7"
            priority
          />
          <span className="font-[family-name:var(--font-lobster)] font-normal tracking-wide text-xl text-accent">
            PinToTrip
          </span>
        </Link>

        <div className="hidden min-w-0 items-center justify-center gap-0.5 overflow-x-auto md:flex lg:gap-1">
          {navLinks.map((link) =>
            link.href.startsWith("#") ? (
              <a
                key={link.href}
                href={link.href}
                className="shrink-0 rounded-md px-2 py-2 text-sm text-text-secondary transition-colors hover:text-text lg:px-3"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className="shrink-0 rounded-md px-2 py-2 text-sm text-text-secondary transition-colors hover:text-text lg:px-3"
              >
                {link.label}
              </Link>
            )
          )}
        </div>

        <div className="col-start-3 flex items-center justify-end gap-1 sm:gap-2">
          <LanguageMenu variant="nav" className="relative z-10" />
          <div className="hidden items-center gap-1 md:flex">
            <Link
              href="/login"
              className="rounded-md px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text"
            >
              {t("landing.nav.logIn")}
            </Link>
            <Link href="/login" className="btn-primary ml-1 h-9 px-4">
              {t("landing.nav.startForFree")}
            </Link>
          </div>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-text hover:bg-surface md:hidden"
            aria-expanded={open}
            aria-controls="landing-mobile-nav"
            aria-label={
              open ? t("landing.nav.closeMenu") : t("landing.nav.openMenu")
            }
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {open ? (
        <div
          id="landing-mobile-nav"
          className="border-t border-border bg-white px-4 py-3 md:hidden"
        >
          <div className="flex flex-col gap-0.5">
            {navLinks.map((link) =>
              link.href.startsWith("#") ? (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-text"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-text"
                >
                  {link.label}
                </Link>
              )
            )}
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2.5 text-sm font-medium text-text"
            >
              {t("landing.nav.logIn")}
            </Link>
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="btn-primary mt-2 w-full"
            >
              {t("landing.nav.startForFree")}
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
