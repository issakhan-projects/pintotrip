"use client";

import { LandingNav } from "./LandingNav";
import { LandingFooter } from "./LandingFooter";
import { HeroSection } from "./sections/HeroSection";
import { MagicSection } from "./sections/MagicSection";
import { MapSection } from "./sections/MapSection";
import { ExploreSection } from "./sections/ExploreSection";
import { PricingSection } from "./sections/PricingSection";
import { FinalCtaSection } from "./sections/FinalCtaSection";
import { CookieSettings } from "@/features/cookies";

/**
 * Public marketing landing — visual-first travel product story.
 * Six sections max: Hero → Magic → Map → Explore → Pricing → Final CTA.
 */
export function LandingPage() {
  return (
    <div className="min-h-full bg-background text-text">
      <LandingNav />
      <main>
        <HeroSection />
        <MagicSection />
        <MapSection />
        <ExploreSection />
        <PricingSection />
        <FinalCtaSection />
      </main>
      <LandingFooter />
      <CookieSettings />
    </div>
  );
}
