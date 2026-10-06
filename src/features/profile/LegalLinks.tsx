"use client";

import { PrivacyPolicyContent, TermsOfServiceContent } from "@/features/legal";
import { ProfileMenuRow } from "@/features/profile/ProfileMenuRow";
import { useI18n } from "@/i18n";
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
  const { t } = useI18n();

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface-elevated">
      <ProfileMenuRow
        icon={<HelpCircle className="h-4 w-4" />}
        title={t("profile.legal.help")}
        onClick={() => onOpen("help")}
      />
      <ProfileMenuRow
        icon={<Shield className="h-4 w-4" />}
        title={t("profile.legal.privacy")}
        onClick={() => onOpen("privacy")}
      />
      <ProfileMenuRow
        icon={<FileText className="h-4 w-4" />}
        title={t("profile.legal.terms")}
        onClick={() => onOpen("terms")}
      />
      <ProfileMenuRow
        icon={<Info className="h-4 w-4" />}
        title={t("profile.legal.about")}
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
  const { t } = useI18n();
  if (page === "privacy") {
    return <PrivacyPolicyContent compact />;
  }
  if (page === "terms") {
    return <TermsOfServiceContent compact />;
  }
  return (
    <Copy
      title={t("profile.about.title")}
      body={t("profile.about.body")}
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
