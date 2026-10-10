"use client";

import { useState } from "react";
import {
  Bug,
  CreditCard,
  HelpCircle,
  MapPin,
  Route,
  Send,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui";
import { SUPPORT_EMAIL } from "@/features/legal/constants";
import { useI18n } from "@/i18n";
import { cx } from "@/lib/utils";

const SUPPORT_TYPES = [
  { id: "bug", icon: Bug },
  { id: "account", icon: UserRound },
  { id: "billing", icon: CreditCard },
  { id: "places", icon: MapPin },
  { id: "planner", icon: Route },
  { id: "other", icon: HelpCircle },
] as const;

type SupportTypeId = (typeof SUPPORT_TYPES)[number]["id"];

const MIN_QUESTION_LENGTH = 20;
const MAX_QUESTION_LENGTH = 2000;

interface SupportViewProps {
  /** Prefills the user’s email in the outbound message when available. */
  userEmail?: string;
}

export function SupportView({ userEmail }: SupportViewProps) {
  const { t } = useI18n();
  const [type, setType] = useState<SupportTypeId | null>(null);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const trimmed = question.trim();
  const canSubmit =
    type !== null &&
    trimmed.length >= MIN_QUESTION_LENGTH &&
    trimmed.length <= MAX_QUESTION_LENGTH;

  function topicLabel(id: SupportTypeId): string {
    return t(`profile.support.topics.${id}`);
  }

  function handleSubmit() {
    if (!type) {
      setError(t("profile.support.selectTopic"));
      return;
    }
    if (trimmed.length < MIN_QUESTION_LENGTH) {
      setError(
        t("profile.support.minChars", { n: MIN_QUESTION_LENGTH })
      );
      return;
    }
    if (trimmed.length > MAX_QUESTION_LENGTH) {
      setError(
        t("profile.support.maxChars", { n: MAX_QUESTION_LENGTH })
      );
      return;
    }

    const typeLabel = topicLabel(type) || t("profile.support.fallbackTitle");
    const subject = encodeURIComponent(`[PinToTrip] ${typeLabel}`);
    const bodyLines = [
      t("profile.support.emailTopic", { topic: typeLabel }),
      userEmail
        ? t("profile.support.emailFrom", { email: userEmail })
        : null,
      "",
      trimmed,
    ].filter((line): line is string => line !== null);
    const body = encodeURIComponent(bodyLines.join("\n"));

    setError(null);
    setSent(true);
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-text">
          {t("profile.support.messageReady")}
        </h3>
        <p className="text-sm leading-relaxed text-text-secondary">
          {t("profile.support.messageReadyBody", { email: SUPPORT_EMAIL })}
        </p>
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => {
            setSent(false);
            setQuestion("");
            setType(null);
          }}
        >
          {t("profile.support.askAnother")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-text-secondary">
        {t("profile.support.intro", { email: SUPPORT_EMAIL })}
      </p>

      <Field label={t("profile.support.topic")}>
        <div className="grid grid-cols-2 gap-2">
          {SUPPORT_TYPES.map((item) => (
            <TypeChip
              key={item.id}
              label={topicLabel(item.id)}
              icon={item.icon}
              selected={type === item.id}
              onSelect={() => setType(item.id)}
            />
          ))}
        </div>
      </Field>

      <Field label={t("profile.support.question")}>
        <textarea
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
            setSent(false);
            if (error) setError(null);
          }}
          rows={6}
          maxLength={MAX_QUESTION_LENGTH}
          placeholder={t("profile.support.placeholder")}
          className={cx(
            "block w-full rounded-xl border border-border bg-surface-elevated",
            "px-3 py-2.5 text-sm text-text placeholder:text-text-muted",
            "shadow-sm outline-none transition-colors",
            "focus:border-primary focus:ring-2 focus:ring-primary/20",
            "resize-y"
          )}
        />
        <p className="mt-1.5 text-xs text-text-muted">
          {trimmed.length}/{MAX_QUESTION_LENGTH}
          {trimmed.length > 0 && trimmed.length < MIN_QUESTION_LENGTH
            ? ` ${t("profile.support.minCharsHint", { n: MIN_QUESTION_LENGTH })}`
            : null}
        </p>
      </Field>

      {error ? <p className="text-sm text-error">{error}</p> : null}

      <Button
        color="primary"
        icon={Send}
        disabled={!canSubmit}
        onClick={handleSubmit}
        className="w-full"
      >
        {t("profile.support.continueEmail")}
      </Button>
    </div>
  );
}

function TypeChip({
  label,
  icon: Icon,
  selected,
  onSelect,
}: {
  label: string;
  icon: LucideIcon;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cx(
        "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition-colors",
        selected
          ? "border-primary bg-primary-tint text-primary"
          : "border-border bg-surface-elevated text-text-secondary hover:bg-surface"
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="leading-snug">{label}</span>
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium text-text">{label}</span>
      {children}
    </div>
  );
}
