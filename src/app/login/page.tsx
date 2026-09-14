"use client";

import { Suspense, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bookmark,
  BookOpen,
  Camera,
  MapPin,
} from "lucide-react";
import { AuthTabs } from "@/features/auth/AuthTabs";
import { useAuth } from "@/hooks/useAuth";

const AUTH_SIDE_IMAGE =
  "https://images.unsplash.com/photo-1672622851784-0dbd3df4c088?q=80&w=930&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D";

const SIDE_FEATURES = [
  {
    icon: Camera,
    label: "Find places from photos",
  },
  {
    icon: Bookmark,
    label: "Save to your personal map",
  },
  {
    icon: BookOpen,
    label: "Plan your future adventures",
  },
] as const;

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) {
      router.replace("/map");
    }
  }, [loading, user, router]);

  if (loading || user) {
    return (
      <main className="flex flex-1 items-center justify-center text-sm text-text-secondary">
        Loading…
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-1">
      <aside className="relative hidden w-[48%] overflow-hidden lg:block">
        <Image
          src={AUTH_SIDE_IMAGE}
          alt="Oia, Santorini at sunset"
          fill
          priority
          className="object-cover"
          sizes="48vw"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/20 to-black/10" />

        <div className="relative z-10 flex h-full min-h-dvh flex-col p-10 text-white">
          <Link
            href="/"
            className="inline-flex font-[family-name:var(--font-lobster)] font-normal tracking-wide text-xl text-accent items-center gap-2"
          >
            <Image
              src="/icon.svg"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8"
              priority
            />
            PinToTrip
          </Link>

          <div className="mt-auto max-w-md pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/75">
              Discover · Save · Explore
            </p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">
              Turn your travel inspiration into a real journey.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/80">
              See a place you love, find where it is, and save it to your map —
              so inspiration becomes your next trip.
            </p>

            <ul className="mt-8 space-y-3">
              {SIDE_FEATURES.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-3 text-sm">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  {label}
                </li>
              ))}
            </ul>

            <p
              className="mt-10 text-xl text-white/90"
              style={{
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontStyle: "italic",
              }}
            >
              Collect moments, not just photos.
            </p>
          </div>

          <p className="mt-6 flex items-center gap-1.5 text-xs text-white/70">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            Oia, Santorini, Greece
          </p>
        </div>
      </aside>

      <section className="relative flex flex-1 flex-col bg-surface">
        <div className="flex min-h-dvh flex-col items-center justify-safe-center px-6 py-12 sm:px-10 lg:min-h-full">
          <Link
            href="/"
            className="mb-8 inline-flex items-center gap-2 font-[family-name:var(--font-lobster)] text-xl font-normal tracking-wide text-text lg:hidden"
          >
            <Image
              src="/icon.svg"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8"
            />
            PinToTrip
          </Link>

          <Suspense
            fallback={
              <div className="w-full max-w-md rounded-2xl border border-border bg-surface-elevated p-8 text-center text-sm text-text-secondary">
                Loading…
              </div>
            }
          >
            <AuthTabs />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
