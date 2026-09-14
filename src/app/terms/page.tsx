import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { TermsOfServiceContent } from "@/features/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms governing your access to and use of PinToTrip and related services.",
};

export default function TermsPage() {
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

        <TermsOfServiceContent />
      </div>
    </main>
  );
}
