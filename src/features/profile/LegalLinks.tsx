"use client";

import { PrivacyPolicyContent, TermsOfServiceContent } from "@/features/legal";
import { ProfileMenuRow } from "@/features/profile/ProfileMenuRow";
import {
  FileText,
  HelpCircle,
  Info,
  Shield,
} from "lucide-react";

interface LegalLinksProps {
  onOpen: (page: "help" | "privacy" | "terms" | "about") => void;
}

export function LegalLinks({ onOpen }: LegalLinksProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface-elevated">
      <ProfileMenuRow
        icon={<HelpCircle className="h-4 w-4" />}
        title="Help & Support"
        onClick={() => onOpen("help")}
      />
      <ProfileMenuRow
        icon={<Shield className="h-4 w-4" />}
        title="Privacy Policy"
        onClick={() => onOpen("privacy")}
      />
      <ProfileMenuRow
        icon={<FileText className="h-4 w-4" />}
        title="Terms of Service"
        onClick={() => onOpen("terms")}
      />
      <ProfileMenuRow
        icon={<Info className="h-4 w-4" />}
        title="About"
        onClick={() => onOpen("about")}
      />
    </div>
  );
}

export function LegalContent({
  page,
}: {
  page: "privacy" | "terms" | "about";
}) {
  if (page === "privacy") {
    return <PrivacyPolicyContent compact />;
  }
  if (page === "terms") {
    return <TermsOfServiceContent compact />;
  }
  return (
    <Copy
      title="About PinToTrip"
      body="PinToTrip is a travel map for discovering places, saving them, and turning inspiration into real trips. Discover → Identify → Save → Map → Visit."
    />
  );
}

function Copy({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-text">{title}</h3>
      <p className="text-sm leading-relaxed text-text-secondary">{body}</p>
    </div>
  );
}
