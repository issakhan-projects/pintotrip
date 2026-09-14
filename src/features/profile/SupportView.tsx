"use client";

import { useState } from "react";
import {
  Bug,
  CreditCard,
  HelpCircle,
  MapPin,
  Route,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui";
import { SUPPORT_EMAIL } from "@/features/legal/constants";
import { cx } from "@/lib/utils";

const SUPPORT_TYPES = [
  { id: "bug", label: "Bug report", icon: Bug },
  { id: "account", label: "Account", icon: UserRound },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "places", label: "Places & map", icon: MapPin },
  { id: "trips", label: "Trip planner", icon: Route },
  { id: "other", label: "Other", icon: HelpCircle },
] as const;

type SupportTypeId = (typeof SUPPORT_TYPES)[number]["id"];

const MIN_QUESTION_LENGTH = 20;
const MAX_QUESTION_LENGTH = 2000;

interface SupportViewProps {
  /** Prefills the user’s email in the outbound message when available. */
  userEmail?: string;
}

export function SupportView({ userEmail }: SupportViewProps) {
  const [type, setType] = useState<SupportTypeId | null>(null);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const trimmed = question.trim();
  const canSubmit =
    type !== null &&
    trimmed.length >= MIN_QUESTION_LENGTH &&
    trimmed.length <= MAX_QUESTION_LENGTH;

  function handleSubmit() {
    if (!type) {
      setError("Please select a topic.");
      return;
    }
    if (trimmed.length < MIN_QUESTION_LENGTH) {
      setError(`Please write at least ${MIN_QUESTION_LENGTH} characters.`);
      return;
    }
    if (trimmed.length > MAX_QUESTION_LENGTH) {
      setError(`Please keep your question under ${MAX_QUESTION_LENGTH} characters.`);
      return;
    }

    const typeLabel =
      SUPPORT_TYPES.find((t) => t.id === type)?.label ?? "Support";
    const subject = encodeURIComponent(`[PinToTrip] ${typeLabel}`);
    const bodyLines = [
      `Topic: ${typeLabel}`,
      userEmail ? `From: ${userEmail}` : null,
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
        <h3 className="text-base font-semibold text-text">Message ready</h3>
        <p className="text-sm leading-relaxed text-text-secondary">
          Your email app should open with your question to{" "}
          <span className="font-medium text-text">{SUPPORT_EMAIL}</span>. Send
          it from there and we’ll get back to you as soon as we can.
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
          Ask another question
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-text-secondary">
        Choose a topic, write your question, and we’ll open an email to{" "}
        {SUPPORT_EMAIL}.
      </p>

      <Field label="Topic">
        <div className="grid grid-cols-2 gap-2">
          {SUPPORT_TYPES.map((item) => (
            <TypeChip
              key={item.id}
              label={item.label}
              icon={item.icon}
              selected={type === item.id}
              onSelect={() => setType(item.id)}
            />
          ))}
        </div>
      </Field>

      <Field label="Your question">
        <textarea
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
            setSent(false);
            if (error) setError(null);
          }}
          rows={6}
          maxLength={MAX_QUESTION_LENGTH}
          placeholder="Describe what you need help with…"
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
            ? ` · at least ${MIN_QUESTION_LENGTH} characters`
            : null}
        </p>
      </Field>

      {error ? <p className="text-sm text-error">{error}</p> : null}

      <Button
        disabled={!canSubmit}
        onClick={handleSubmit}
        className="w-full"
      >
        Continue to email
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
