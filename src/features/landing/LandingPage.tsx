"use client";

import Script from "next/script";
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
      <Script id="impact-affiliate" strategy="afterInteractive">
        {`(function(i,m,p,a,c,t){c.ire_o=p;c[p]=c[p]||function(){(c[p].a=c[p].a||[]).push(arguments)};t=a.createElement(m);var z=a.getElementsByTagName(m)[0];t.async=1;t.src=i;z.parentNode.insertBefore(t,z)})('https://utt.impactcdn.com/P-A7780252-cc41-4f4a-ac9f-f9f45834affa1.js','script','impactStat',document,window);impactStat('transformLinks');impactStat('trackImpression');`}
      </Script>
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
