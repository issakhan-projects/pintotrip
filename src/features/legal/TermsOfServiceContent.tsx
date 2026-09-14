import type { ReactNode } from "react";
import {
  APP_NAME,
  COMPANY_NAME,
  DOMAIN,
  JURISDICTION,
  SITE_URL,
  SUPPORT_EMAIL,
} from "@/features/legal/constants";

/**
 * Full Terms of Service body — used on /terms and in-app legal views.
 */
export function TermsOfServiceContent({
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
  const listClass = `${bodyClass} list-disc space-y-1.5 pl-5`;

  return (
    <article className={compact ? "space-y-6" : "space-y-10"}>
      <header className="space-y-2">
        {compact ? null : (
          <h1 className="text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            Terms of Service
          </h1>
        )}
        <p className="text-sm text-text-muted">Last updated: September 10, 2026</p>
      </header>

      <div className={`space-y-4 ${bodyClass}`}>
        <p>Welcome to {APP_NAME} (“we”, “us”, or “our”).</p>
        <p>
          These Terms of Service (“Terms”) govern your access to and use of{" "}
          {DOMAIN} and related services (the “Service”).
        </p>
        <p>
          By creating an account or using the Service, you agree to these Terms.
          If you do not agree with these Terms, please do not use the Service.
        </p>
      </div>

      <Section title="1. The Service" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          {APP_NAME} is a travel discovery and organization service that allows
          users to:
        </p>
        <ul className={listClass}>
          <li>Discover and save travel locations</li>
          <li>Upload photos or screenshots of places</li>
          <li>Submit links to travel content</li>
          <li>Use AI to identify locations</li>
          <li>Save identified locations to a personal map</li>
          <li>Organize places by status</li>
          <li>Mark places as planned or visited</li>
          <li>View travel-related information about cities and destinations</li>
          <li>Use AI-powered travel features</li>
          <li>Access additional functionality through paid subscriptions</li>
        </ul>
        <p className={bodyClass}>
          We may add, modify, or remove features from the Service from time to
          time.
        </p>
      </Section>

      <Section title="2. Eligibility" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          You must meet the minimum age required by applicable law to use the
          Service.
        </p>
        <p className={bodyClass}>
          If you are under the applicable age of consent in your jurisdiction,
          you may only use the Service with appropriate parental or guardian
          consent where required.
        </p>
        <p className={bodyClass}>
          By using the Service, you represent that you meet the applicable
          eligibility requirements.
        </p>
      </Section>

      <Section title="3. Your Account" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          Some features require you to create an account.
        </p>
        <p className={bodyClass}>You are responsible for:</p>
        <ul className={listClass}>
          <li>Providing accurate information</li>
          <li>Maintaining the security of your account</li>
          <li>Keeping your login credentials confidential</li>
          <li>All activity occurring through your account</li>
        </ul>
        <p className={bodyClass}>
          You must notify us if you believe that your account has been accessed
          without authorization.
        </p>
        <p className={bodyClass}>
          We reserve the right to suspend or terminate accounts that violate
          these Terms.
        </p>
      </Section>

      <Section title="4. User Content" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          The Service allows you to upload, submit, or create content,
          including:
        </p>
        <ul className={listClass}>
          <li>Photos</li>
          <li>Screenshots</li>
          <li>Links</li>
          <li>Notes</li>
          <li>Location information</li>
          <li>Other travel-related content</li>
        </ul>
        <p className={bodyClass}>
          You retain ownership of content that you submit to the Service.
        </p>
        <p className={bodyClass}>
          By submitting content, you grant us a limited, non-exclusive license
          to use, store, process, reproduce, and display that content only as
          reasonably necessary to:
        </p>
        <ul className={listClass}>
          <li>Provide the Service</li>
          <li>Process AI requests</li>
          <li>Store your saved places</li>
          <li>Display your content within your account</li>
          <li>Improve and maintain the Service</li>
          <li>Maintain security and prevent abuse</li>
        </ul>
        <p className={bodyClass}>
          This license does not transfer ownership of your content to us.
        </p>
      </Section>

      <Section
        title="5. User Content Responsibility"
        titleClass={sectionTitleClass}
      >
        <p className={bodyClass}>
          You are responsible for the content you upload or submit.
        </p>
        <p className={bodyClass}>
          You must have the necessary rights or permissions to use content you
          upload to the Service.
        </p>
        <p className={bodyClass}>
          You agree not to upload or submit content that:
        </p>
        <ul className={listClass}>
          <li>Violates another person’s intellectual property rights</li>
          <li>Violates applicable laws</li>
          <li>Contains malicious software</li>
          <li>Is fraudulent or misleading</li>
          <li>Infringes another person’s privacy</li>
          <li>Is abusive, threatening, or harmful</li>
          <li>Attempts to compromise or interfere with the Service</li>
        </ul>
        <p className={bodyClass}>
          We may remove content that violates these Terms or applicable law.
        </p>
      </Section>

      <Section title="6. AI-Powered Features" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          The Service uses artificial intelligence to provide features such as
          location identification and travel intelligence.
        </p>
        <p className={bodyClass}>AI-generated results may contain errors.</p>
        <p className={bodyClass}>
          For example, the Service may incorrectly identify:
        </p>
        <ul className={listClass}>
          <li>A landmark</li>
          <li>A city</li>
          <li>A country</li>
          <li>Coordinates</li>
          <li>A viewpoint</li>
          <li>Travel information</li>
        </ul>
        <p className={bodyClass}>
          You should independently verify important information before making
          travel decisions.
        </p>
        <p className={bodyClass}>
          AI-generated information should not be considered authoritative or
          guaranteed to be accurate.
        </p>
      </Section>

      <Section title="7. Travel Information" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          The Service may provide information about:
        </p>
        <ul className={listClass}>
          <li>Visa requirements</li>
          <li>Currency</li>
          <li>Exchange rates</li>
          <li>Weather and climate</li>
          <li>Travel budgets</li>
          <li>Attractions</li>
          <li>Transportation</li>
          <li>Other travel-related information</li>
        </ul>
        <p className={bodyClass}>Travel information can change.</p>
        <p className={bodyClass}>
          We do not guarantee that travel information is:
        </p>
        <ul className={listClass}>
          <li>Complete</li>
          <li>Accurate</li>
          <li>Current</li>
          <li>Suitable for your specific circumstances</li>
        </ul>
        <p className={bodyClass}>
          Always verify important information with official sources before
          traveling.
        </p>
        <p className={bodyClass}>
          In particular, visa and entry requirements should be verified with the
          relevant government, embassy, or immigration authority.
        </p>
      </Section>

      <Section title="8. Location Accuracy" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          The Service may provide coordinates based on image analysis, external
          information, or other sources.
        </p>
        <p className={bodyClass}>Coordinates may represent:</p>
        <ul className={listClass}>
          <li>An exact location</li>
          <li>An approximate location</li>
          <li>A general area</li>
        </ul>
        <p className={bodyClass}>
          We do not guarantee that any location or coordinate provided by the
          Service is exact.
        </p>
        <p className={bodyClass}>
          Users should verify important locations independently.
        </p>
      </Section>

      <Section title="9. AI Credits" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          Certain AI features may require AI credits.
        </p>
        <p className={bodyClass}>
          AI credits may be used for features such as:
        </p>
        <ul className={listClass}>
          <li>Location identification</li>
          <li>City intelligence</li>
          <li>Regenerating AI results</li>
          <li>Other AI features introduced in the future</li>
        </ul>
        <p className={bodyClass}>
          The number of credits required for an operation may be displayed
          before the operation is performed.
        </p>
        <p className={bodyClass}>
          AI credits have no cash value and cannot be exchanged for money unless
          required by applicable law.
        </p>
        <p className={bodyClass}>
          We may change credit costs or introduce new credit-based features in
          the future.
        </p>
      </Section>

      <Section title="10. Free and Paid Plans" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          The Service may offer free and paid subscription plans.
        </p>
        <p className={bodyClass}>Current plans may include:</p>

        <SubSection title="Free" titleClass={sectionTitleClass}>
          <p className={bodyClass}>$0/month</p>
          <p className={bodyClass}>30 AI credits per month.</p>
        </SubSection>

        <SubSection title="Plus" titleClass={sectionTitleClass}>
          <p className={bodyClass}>$3.99/month</p>
          <p className={bodyClass}>200 AI credits per month.</p>
        </SubSection>

        <SubSection title="Pro" titleClass={sectionTitleClass}>
          <p className={bodyClass}>$6.99/month</p>
          <p className={bodyClass}>500 AI credits per month.</p>
        </SubSection>

        <p className={bodyClass}>
          Features, prices, credit allocations, and limits may change in the
          future.
        </p>
        <p className={bodyClass}>
          Any material changes will be communicated where required by applicable
          law.
        </p>
      </Section>

      <Section
        title="11. Subscriptions and Payments"
        titleClass={sectionTitleClass}
      >
        <p className={bodyClass}>
          Paid subscriptions may be processed through third-party payment
          providers.
        </p>
        <p className={bodyClass}>
          By purchasing a subscription, you authorize the applicable payment
          provider to charge the selected subscription price according to the
          applicable billing terms.
        </p>
        <p className={bodyClass}>
          Subscriptions may automatically renew unless cancelled before the
          applicable renewal date.
        </p>
        <p className={bodyClass}>
          The specific cancellation, renewal, refund, and billing terms may also
          be governed by the payment provider’s terms.
        </p>
        <p className={bodyClass}>
          We do not store full payment card information unless explicitly stated
          otherwise.
        </p>
      </Section>

      <Section title="12. Cancellation" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          You may cancel your paid subscription according to the cancellation
          options provided by the Service or applicable payment provider.
        </p>
        <p className={bodyClass}>
          Cancellation normally prevents future renewal but may not
          automatically provide a refund for the current billing period unless
          required by applicable law or otherwise stated by us.
        </p>
      </Section>

      <Section title="13. Refunds" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          Refunds are handled according to the applicable subscription and
          payment terms.
        </p>
        <p className={bodyClass}>
          Nothing in these Terms limits any refund rights you may have under
          applicable consumer protection laws.
        </p>
      </Section>

      <Section title="14. Acceptable Use" titleClass={sectionTitleClass}>
        <p className={bodyClass}>You agree not to:</p>
        <ul className={listClass}>
          <li>Use the Service for unlawful purposes</li>
          <li>Attempt to gain unauthorized access to the Service</li>
          <li>Circumvent security mechanisms</li>
          <li>Reverse engineer the Service where prohibited by law</li>
          <li>Scrape or systematically collect data without permission</li>
          <li>Abuse AI functionality</li>
          <li>Attempt to manipulate AI credits</li>
          <li>Create fraudulent accounts</li>
          <li>Interfere with the operation of the Service</li>
          <li>Upload malicious code</li>
          <li>Use automated systems to overload the Service</li>
          <li>Attempt to access another user’s information</li>
        </ul>
        <p className={bodyClass}>
          We may restrict or terminate access if we reasonably believe these
          rules have been violated.
        </p>
      </Section>

      <Section title="15. Intellectual Property" titleClass={sectionTitleClass}>
        <p className={bodyClass}>The Service, including its:</p>
        <ul className={listClass}>
          <li>Software</li>
          <li>Design</li>
          <li>Branding</li>
          <li>Logos</li>
          <li>Interface</li>
          <li>Text</li>
          <li>Graphics</li>
          <li>Original content</li>
          <li>Features</li>
        </ul>
        <p className={bodyClass}>
          is owned by or licensed to {COMPANY_NAME} and is protected by
          applicable intellectual property laws.
        </p>
        <p className={bodyClass}>
          You may not copy, reproduce, modify, distribute, sell, or create
          derivative works from the Service without permission, except where
          permitted by law.
        </p>
      </Section>

      <Section title="16. Third-Party Services" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          The Service may rely on third-party services, including:
        </p>
        <ul className={listClass}>
          <li>Firebase</li>
          <li>Google Maps</li>
          <li>OpenAI</li>
          <li>PostHog</li>
          <li>Payment providers</li>
          <li>Other infrastructure and technology providers</li>
        </ul>
        <p className={bodyClass}>
          Third-party services may have their own terms and policies.
        </p>
        <p className={bodyClass}>
          We are not responsible for the availability, functionality, or
          policies of third-party services.
        </p>
      </Section>

      <Section title="17. Availability" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          We aim to keep the Service available and reliable, but we do not
          guarantee uninterrupted availability.
        </p>
        <p className={bodyClass}>
          The Service may occasionally be unavailable because of:
        </p>
        <ul className={listClass}>
          <li>Maintenance</li>
          <li>Updates</li>
          <li>Technical failures</li>
          <li>Security incidents</li>
          <li>Third-party service outages</li>
          <li>Internet or infrastructure failures</li>
          <li>Circumstances beyond our reasonable control</li>
        </ul>
      </Section>

      <Section title="18. Service Changes" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          We may modify, improve, suspend, or discontinue parts of the Service
          at any time.
        </p>
        <p className={bodyClass}>This may include:</p>
        <ul className={listClass}>
          <li>Adding features</li>
          <li>Removing features</li>
          <li>Changing AI credit costs</li>
          <li>Changing subscription plans</li>
          <li>Changing pricing</li>
          <li>Updating the user interface</li>
          <li>Changing technical infrastructure</li>
        </ul>
        <p className={bodyClass}>
          Where required by applicable law, we will provide appropriate notice.
        </p>
      </Section>

      <Section
        title="19. Account Suspension or Termination"
        titleClass={sectionTitleClass}
      >
        <p className={bodyClass}>We may suspend or terminate your account if:</p>
        <ul className={listClass}>
          <li>You violate these Terms</li>
          <li>You abuse the Service</li>
          <li>You attempt to compromise the Service</li>
          <li>You engage in fraudulent activity</li>
          <li>Required by law</li>
          <li>Your activity creates a security or operational risk</li>
        </ul>
        <p className={bodyClass}>
          You may stop using the Service at any time.
        </p>
      </Section>

      <Section title="20. Disclaimer" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          The Service is provided on an “as is” and “as available” basis to the
          extent permitted by law.
        </p>
        <p className={bodyClass}>We do not guarantee that:</p>
        <ul className={listClass}>
          <li>The Service will always be available</li>
          <li>AI results will always be accurate</li>
          <li>Location identification will always be correct</li>
          <li>Travel information will always be current</li>
          <li>Maps or coordinates will always be accurate</li>
          <li>Third-party services will always be available</li>
          <li>The Service will meet every user’s specific requirements</li>
        </ul>
        <p className={bodyClass}>
          Travel decisions are ultimately your responsibility.
        </p>
      </Section>

      <Section
        title="21. Limitation of Liability"
        titleClass={sectionTitleClass}
      >
        <p className={bodyClass}>
          To the maximum extent permitted by applicable law, {COMPANY_NAME} will
          not be liable for indirect, incidental, special, consequential, or
          similar damages arising from your use of the Service.
        </p>
        <p className={bodyClass}>This may include losses related to:</p>
        <ul className={listClass}>
          <li>Travel arrangements</li>
          <li>Incorrect location information</li>
          <li>Incorrect AI results</li>
          <li>Visa or immigration decisions</li>
          <li>Changes in travel conditions</li>
          <li>Accommodation or transportation</li>
          <li>Lost data</li>
          <li>Service interruptions</li>
        </ul>
        <p className={bodyClass}>
          Nothing in these Terms excludes or limits liability that cannot
          legally be excluded or limited under applicable law.
        </p>
      </Section>

      <Section title="22. Indemnification" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          To the extent permitted by applicable law, you agree to indemnify and
          hold harmless {COMPANY_NAME} from claims, damages, liabilities, and
          expenses arising from:
        </p>
        <ul className={listClass}>
          <li>Your violation of these Terms</li>
          <li>Your misuse of the Service</li>
          <li>Your violation of another person’s rights</li>
          <li>Content you submit to the Service</li>
          <li>Your violation of applicable laws</li>
        </ul>
      </Section>

      <Section title="23. Governing Law" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          These Terms will be governed by the laws of {JURISDICTION}, without
          regard to conflict-of-law principles, unless applicable law requires
          otherwise.
        </p>
        <p className={bodyClass}>
          Any disputes will be handled by the courts or dispute-resolution
          mechanisms applicable in {JURISDICTION}, subject to mandatory consumer
          protection laws.
        </p>
      </Section>

      <Section title="24. Changes to These Terms" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          We may update these Terms from time to time.
        </p>
        <p className={bodyClass}>
          When we make changes, we will update the “Last updated” date at the
          top of this page.
        </p>
        <p className={bodyClass}>
          For material changes, we may provide additional notice where required
          by law.
        </p>
        <p className={bodyClass}>
          Your continued use of the Service after the updated Terms become
          effective means that you accept the updated Terms.
        </p>
      </Section>

      <Section title="25. Contact" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          If you have questions about these Terms, contact us:
        </p>
        <p className={bodyClass}>{COMPANY_NAME}</p>
        <p className={bodyClass}>
          Email:{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>
        </p>
        <p className={bodyClass}>
          Website:{" "}
          <a
            href={SITE_URL}
            className="text-primary underline-offset-2 hover:underline"
          >
            {DOMAIN}
          </a>
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

function SubSection({
  title,
  titleClass,
  children,
}: {
  title: string;
  titleClass: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 pt-1">
      <h3 className={titleClass}>{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
