import type { Metadata } from "next";
import { headers } from "next/headers";
import { resolvePaddleCountryCode } from "@/lib/paddle/country";
import { PricingView } from "@/features/pricing/PricingView";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Choose Free, Plus, or Pro — localized prices with secure Paddle Checkout.",
};

export default async function PricingPage() {
  const headersList = await headers();
  const countryCode = resolvePaddleCountryCode(headersList);

  return <PricingView countryCode={countryCode} />;
}
