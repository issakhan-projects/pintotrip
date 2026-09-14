import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RefundPolicyContent } from "@/features/legal";

export const metadata: Metadata = {
  title: "Refund Policy",
  description:
    "How refunds and cancellations work for PinToTrip subscriptions.",
};

export default function RefundPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 pb-20 pt-6 sm:px-6">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 rounded-md text-sm text-text-secondary transition-colors hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back
        </Link>

        <RefundPolicyContent />
      </div>
    </main>
  );
}
