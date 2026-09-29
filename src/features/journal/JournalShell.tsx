"use client";

import Image from "next/image";
import Link from "next/link";
import { cx } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/", label: "Destinations" },
  { href: "/journal", label: "Journal" },
  { href: "/#how-it-works", label: "About" },
] as const;

type JournalShellProps = {
  children: React.ReactNode;
  className?: string;
};

/**
 * Magazine-style public chrome for journal pages.
 */
export function JournalShell({ children, className }: JournalShellProps) {
  return (
    <div className={cx("min-h-screen bg-white text-text", className)}>
      <header className="sticky top-0 z-40 border-b border-border/70 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Image
              src="/icon.svg"
              alt=""
              width={26}
              height={26}
              className="h-7 w-7"
            />
            <span className="font-[family-name:var(--font-lobster)] text-xl tracking-wide text-text">
              PinToTrip
            </span>
          </Link>

          <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <Link
            href="/login"
            className="inline-flex h-10 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Plan Your Trip
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
