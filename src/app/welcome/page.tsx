import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { APP_NAME } from "@/features/legal";
import { LANDING_IMAGES } from "@/features/landing/constants";

export const metadata: Metadata = {
  title: "Welcome",
  description: `Thanks for subscribing to ${APP_NAME}.`,
  robots: { index: false, follow: false },
};

export default function WelcomePage() {
  return (
    <main className="relative min-h-dvh overflow-hidden" data-theme="light">
      <Image
        src={LANDING_IMAGES.santorini}
        alt="Whitewashed cliffside village overlooking the Aegean Sea"
        fill
        priority
        sizes="100vw"
        className="object-cover object-[center_40%]"
      />
      <div
        className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/40 to-black/72"
        aria-hidden
      />

      <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-5 py-16 sm:px-8">
        <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
          <div className="landing-float">
            <div className="landing-pin-drop">
              <Image
                src="/icon.svg"
                alt=""
                width={56}
                height={56}
                priority
                className="h-14 w-14 drop-shadow-lg sm:h-16 sm:w-16"
              />
            </div>
          </div>

          <p
            className="landing-fade-up mt-6 font-[family-name:var(--font-lobster)] text-5xl tracking-wide text-white sm:text-6xl"
            style={{ animationDelay: "100ms" }}
          >
            {APP_NAME}
          </p>

          <h1
            className="landing-fade-up mt-5 text-2xl font-semibold tracking-tight text-white sm:text-3xl"
            style={{ animationDelay: "180ms" }}
          >
            Welcome aboard
          </h1>

          <p
            className="landing-fade-up mt-3 max-w-sm text-sm leading-relaxed text-white/85 sm:text-base"
            style={{ animationDelay: "260ms" }}
          >
            Your checkout completed successfully. Paid plan access appears after
            Paddle confirms the subscription (usually within a few seconds). Open
            your map and start planning.
          </p>

          <div
            className="landing-fade-up mt-9 flex w-full max-w-xs flex-col gap-3 sm:max-w-none sm:w-auto sm:flex-row sm:justify-center"
            style={{ animationDelay: "340ms" }}
          >
            <Link
              href="/map"
              className="btn-primary h-12 gap-2 px-6 shadow-lg shadow-black/25"
            >
              Open map
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex h-12 items-center justify-center rounded-lg border border-white/35 bg-white/10 px-6 text-[13px] font-medium text-white backdrop-blur-sm transition-all duration-200 hover:bg-white/20 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-white/40"
            >
              View plans
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
