import type { ReactNode } from "react";
import {
  APP_NAME,
  SUPPORT_EMAIL,
} from "@/features/legal/constants";

/**
 * Full Refund Policy body — used on /refund and in-app legal views.
 */
export function RefundPolicyContent({
  compact = false,
}: {
  compact?: boolean;
}) {
  const sectionTitleClass = compact
    ? "text-sm font-semibold text-text"
    : "text-lg font-semibold text-text";
  const bodyClass = compact
    ? "text-sm leading-relaxed text-text-secondary"
    : "text-base leading-relaxed text-text-secondary";

  return (
    <article className={compact ? "space-y-6" : "space-y-10"}>
      <header className="space-y-2">
        {compact ? null : (
          <h1 className="text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            Refund Policy
          </h1>
        )}
        <p className="text-sm text-text-muted">Last updated: September 14, 2026</p>
      </header>

      <div className={`space-y-4 ${bodyClass}`}>
        <p>
          This Refund Policy explains how refunds work for paid {APP_NAME}{" "}
          subscriptions.
        </p>
      </div>

      <Section title="1. General Policy" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          {APP_NAME} subscriptions are generally non-refundable, except where
          required by applicable law or where a refund is approved by Paddle.
        </p>
      </Section>

      <Section title="2. Requesting a Review" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          If you experience an issue with your subscription or believe you were
          charged incorrectly, please contact us and we will review your
          request.
        </p>
        <p className={bodyClass}>
          You can reach us at{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-text underline underline-offset-2 transition-colors hover:text-primary"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </Section>

      <Section title="3. Cancellation" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          Canceling your subscription will stop future renewals. You will
          generally retain access to your subscription until the end of the
          current billing period.
        </p>
      </Section>

      <Section title="4. How Refunds Are Processed" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          Refunds, when approved, are processed through the original payment
          method.
        </p>
      </Section>
    </article>
  );
}

function Section({
  title,
  titleClass,
  children,
}: {
  title: string;
  titleClass: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className={titleClass}>{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
