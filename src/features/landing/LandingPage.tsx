"use client";

import { LandingNav } from "./LandingNav";
import { LandingFooter } from "./LandingFooter";
import { HeroSection } from "./sections/HeroSection";
import { MagicSection } from "./sections/MagicSection";
import { MapSection } from "./sections/MapSection";
import { ExploreSection } from "./sections/ExploreSection";
import { TripPlannerSection } from "./sections/TripPlannerSection";
import { PricingSection } from "./sections/PricingSection";
import { FinalCtaSection } from "./sections/FinalCtaSection";
import { CookieSettings } from "@/features/cookies";

/**
 * Public marketing landing — visual-first travel product story.
 * Hero → Magic → Map → Explore → Trip Planner → Pricing → Final CTA.
 */
export function LandingPage() {
  return (
    <div className="min-h-full bg-background text-text">
      <meta
        name="impact-site-verification"
        {...{ value: "a1382dd1-7347-4032-931b-fcea8b545d8b" }}
      />
      <LandingNav />
      <main>
        <HeroSection />
        <MagicSection />
        <MapSection />
        <ExploreSection />
        <TripPlannerSection />
        <PricingSection />
        <FinalCtaSection />
      </main>
      <LandingFooter />
      <CookieSettings />
    </div>
  );
}
