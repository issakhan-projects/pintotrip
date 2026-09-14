import type { ReactNode } from "react";
import {
  APP_NAME,
  COMPANY_NAME,
  DOMAIN,
  SITE_URL,
  SUPPORT_EMAIL,
} from "@/features/legal/constants";

/**
 * Full Privacy Policy body — used on /privacy and in-app legal views.
 */
export function PrivacyPolicyContent({ compact = false }: { compact?: boolean }) {
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
            Privacy Policy
          </h1>
        )}
        <p className="text-sm text-text-muted">Last updated: September 10, 2026</p>
      </header>

      <div className={`space-y-4 ${bodyClass}`}>
        <p>
          Welcome to {APP_NAME} (“we”, “us”, or “our”).
        </p>
        <p>
          This Privacy Policy explains how we collect, use, store, and protect
          your information when you use {DOMAIN} (the “Service”).
        </p>
        <p>
          By using the Service, you agree to the practices described in this
          Privacy Policy.
        </p>
      </div>

      <Section title="1. Information We Collect" titleClass={sectionTitleClass}>
        <SubSection title="1.1 Account Information" titleClass={sectionTitleClass}>
          <p className={bodyClass}>When you create an account, we may collect:</p>
          <ul className={listClass}>
            <li>First name</li>
            <li>Last name</li>
            <li>Email address</li>
            <li>Profile photo</li>
            <li>Country</li>
            <li>City</li>
            <li>Preferred language</li>
            <li>Currency</li>
            <li>Timezone</li>
          </ul>
          <p className={bodyClass}>
            If you sign in using Google, we may receive certain information from
            Google, such as your name, email address, and profile photo,
            depending on your Google account settings.
          </p>
        </SubSection>

        <SubSection
          title="1.2 Places and Travel Information"
          titleClass={sectionTitleClass}
        >
          <p className={bodyClass}>
            When you use the Service, you may provide information about places
            you want to visit or have visited.
          </p>
          <p className={bodyClass}>This may include:</p>
          <ul className={listClass}>
            <li>Place names</li>
            <li>City and country</li>
            <li>Latitude and longitude</li>
            <li>Personal notes</li>
            <li>Place descriptions</li>
            <li>Visit status</li>
            <li>Photos or screenshots</li>
            <li>Links to travel content</li>
            <li>Saved travel locations</li>
          </ul>
          <p className={bodyClass}>
            This information is stored in your account so that we can provide
            your personal travel map and related features.
          </p>
        </SubSection>

        <SubSection
          title="1.3 Images and Links You Submit"
          titleClass={sectionTitleClass}
        >
          <p className={bodyClass}>
            You may upload images, screenshots, or submit links to help us
            identify a travel location.
          </p>
          <p className={bodyClass}>
            These materials may be processed by our AI-powered location
            identification service.
          </p>
          <p className={bodyClass}>
            For example, when you upload a travel photo, we may analyze it to
            determine:
          </p>
          <ul className={listClass}>
            <li>What location is shown</li>
            <li>City and country</li>
            <li>Approximate coordinates</li>
            <li>Landmark or attraction name</li>
            <li>Confidence of the identification</li>
          </ul>
          <p className={bodyClass}>
            We do not claim ownership of images that you upload.
          </p>
          <p className={bodyClass}>
            You are responsible for ensuring that you have the right to upload
            and use any content you submit to the Service.
          </p>
        </SubSection>

        <SubSection
          title="1.4 Usage and Analytics Information"
          titleClass={sectionTitleClass}
        >
          <p className={bodyClass}>
            We may automatically collect information about how you use the
            Service, including:
          </p>
          <ul className={listClass}>
            <li>Pages viewed</li>
            <li>Features used</li>
            <li>Actions performed</li>
            <li>Device and browser information</li>
            <li>Approximate geographic information</li>
            <li>Referrer information</li>
            <li>Session information</li>
            <li>Date and time of activity</li>
          </ul>
          <p className={bodyClass}>
            We use PostHog for product analytics and understanding how users
            interact with the Service.
          </p>
          <p className={bodyClass}>
            We use analytics to improve the product, understand usage patterns,
            identify problems, and measure product performance.
          </p>
        </SubSection>
      </Section>

      <Section
        title="2. How We Use Your Information"
        titleClass={sectionTitleClass}
      >
        <p className={bodyClass}>We use collected information to:</p>
        <ul className={listClass}>
          <li>Create and manage your account</li>
          <li>Provide your personal travel map</li>
          <li>Save your places</li>
          <li>Identify locations from uploaded images</li>
          <li>Process links submitted to the Service</li>
          <li>Provide travel and destination information</li>
          <li>Display locations on maps</li>
          <li>Calculate travel statistics</li>
          <li>Provide AI-powered features</li>
          <li>Maintain and improve the Service</li>
          <li>Understand product usage</li>
          <li>Detect and prevent abuse</li>
          <li>Maintain security</li>
          <li>Communicate with you about the Service</li>
          <li>Process subscriptions and payments when applicable</li>
        </ul>
        <p className={bodyClass}>
          We do not use your personal information for purposes unrelated to
          providing or improving the Service without a lawful basis or your
          consent where required.
        </p>
      </Section>

      <Section title="3. AI-Powered Features" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          The Service uses artificial intelligence to provide certain features.
        </p>
        <p className={bodyClass}>
          For example, when you submit an image or link, we may process the
          submitted content to identify a location.
        </p>
        <p className={bodyClass}>
          AI processing may involve sending relevant information to third-party
          AI service providers.
        </p>
        <p className={bodyClass}>
          We use AI-generated results to provide location and travel
          information, but AI results may sometimes be inaccurate.
        </p>
        <p className={bodyClass}>
          You should verify important travel information independently,
          especially:
        </p>
        <ul className={listClass}>
          <li>Visa requirements</li>
          <li>Entry requirements</li>
          <li>Travel restrictions</li>
          <li>Exchange rates</li>
          <li>Prices</li>
          <li>Opening hours</li>
          <li>Safety information</li>
        </ul>
      </Section>

      <Section title="4. Third-Party Services" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          We use certain third-party services to operate the Service.
        </p>
        <p className={bodyClass}>These may include:</p>

        <SubSection title="Firebase" titleClass={sectionTitleClass}>
          <p className={bodyClass}>We use Firebase services for:</p>
          <ul className={listClass}>
            <li>Authentication</li>
            <li>Database storage</li>
            <li>File storage</li>
            <li>Application infrastructure</li>
          </ul>
          <p className={bodyClass}>
            Firebase may process information necessary to provide these
            services.
          </p>
        </SubSection>

        <SubSection title="Google Maps" titleClass={sectionTitleClass}>
          <p className={bodyClass}>
            We use Google Maps and related Google mapping services to display
            maps and locations.
          </p>
          <p className={bodyClass}>
            When using map functionality, certain information may be processed
            by Google according to Google’s privacy practices.
          </p>
        </SubSection>

        <SubSection title="OpenAI" titleClass={sectionTitleClass}>
          <p className={bodyClass}>
            We may use OpenAI services to provide AI-powered location
            identification and travel intelligence.
          </p>
          <p className={bodyClass}>
            Information necessary to process your request may be sent to OpenAI.
          </p>
        </SubSection>

        <SubSection title="PostHog" titleClass={sectionTitleClass}>
          <p className={bodyClass}>
            We use PostHog for analytics and product usage measurement.
          </p>
          <p className={bodyClass}>
            These services may process technical and usage information according
            to their respective privacy policies.
          </p>
        </SubSection>
      </Section>

      <Section
        title="5. How We Store Your Information"
        titleClass={sectionTitleClass}
      >
        <p className={bodyClass}>
          We use cloud infrastructure to store your information.
        </p>
        <p className={bodyClass}>
          Your account information, saved places, and related data may be stored
          using Firebase services.
        </p>
        <p className={bodyClass}>
          Uploaded files may be stored using cloud storage.
        </p>
        <p className={bodyClass}>
          We take reasonable technical and organizational measures to protect
          your information from unauthorized access, loss, misuse, or
          disclosure.
        </p>
        <p className={bodyClass}>
          However, no Internet-based service can guarantee absolute security.
        </p>
      </Section>

      <Section title="6. Your Saved Places" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          Your saved places are associated with your account.
        </p>
        <p className={bodyClass}>
          Depending on the functionality available in the Service, your saved
          information may include:
        </p>
        <ul className={listClass}>
          <li>Location coordinates</li>
          <li>Place name</li>
          <li>City</li>
          <li>Country</li>
          <li>Notes</li>
          <li>Photos</li>
          <li>Visit status</li>
          <li>AI-generated information</li>
        </ul>
        <p className={bodyClass}>
          Your saved places are not publicly visible by default unless we
          explicitly provide a public-sharing feature and you choose to use it.
        </p>
      </Section>

      <Section
        title="7. Payments and Subscriptions"
        titleClass={sectionTitleClass}
      >
        <p className={bodyClass}>
          If you purchase a paid subscription, payment information may be
          processed by third-party payment providers.
        </p>
        <p className={bodyClass}>
          We do not necessarily store your full payment card information on our
          servers.
        </p>
        <p className={bodyClass}>
          Payment providers may collect and process payment information
          according to their own privacy policies.
        </p>
        <p className={bodyClass}>
          The Service may offer different subscription plans, including Free,
          Plus, and Pro.
        </p>
      </Section>

      <Section
        title="8. Cookies and Similar Technologies"
        titleClass={sectionTitleClass}
      >
        <p className={bodyClass}>
          We may use cookies and similar technologies to:
        </p>
        <ul className={listClass}>
          <li>Keep you signed in</li>
          <li>Maintain authentication sessions</li>
          <li>Remember preferences</li>
          <li>Provide essential functionality</li>
          <li>Understand how the Service is used</li>
          <li>Improve the Service</li>
        </ul>
        <p className={bodyClass}>
          Some third-party services used by the Service may also use cookies or
          similar technologies.
        </p>
        <p className={bodyClass}>
          You may be able to control cookies through your browser settings.
          Disabling certain cookies may affect the functionality of the Service.
        </p>
      </Section>

      <Section title="9. Data Retention" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          We retain your information for as long as necessary to:
        </p>
        <ul className={listClass}>
          <li>Provide the Service</li>
          <li>Maintain your account</li>
          <li>Provide saved travel information</li>
          <li>Meet legal obligations</li>
          <li>Resolve disputes</li>
          <li>Enforce agreements</li>
          <li>Maintain security</li>
        </ul>
        <p className={bodyClass}>
          If you delete your account, we will delete or anonymize your personal
          information within a reasonable period, except where we are required
          or permitted by law to retain certain information.
        </p>
        <p className={bodyClass}>
          Some information may remain temporarily in backups or security logs.
        </p>
      </Section>

      <Section
        title="10. Deleting Your Information"
        titleClass={sectionTitleClass}
      >
        <p className={bodyClass}>
          You may request deletion of your account and associated personal
          information.
        </p>
        <p className={bodyClass}>
          You can contact us at:{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>
        </p>
        <p className={bodyClass}>
          When requesting deletion, please provide the email address associated
          with your account.
        </p>
        <p className={bodyClass}>
          After verifying your request, we will process the deletion in
          accordance with applicable laws and our data retention requirements.
        </p>
      </Section>

      <Section title="11. Your Privacy Rights" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          Depending on where you live, you may have rights regarding your
          personal information.
        </p>
        <p className={bodyClass}>These may include the right to:</p>
        <ul className={listClass}>
          <li>Access your personal information</li>
          <li>Correct inaccurate information</li>
          <li>Request deletion</li>
          <li>Request a copy of your information</li>
          <li>Restrict certain processing</li>
          <li>Object to certain processing</li>
          <li>Withdraw consent where processing is based on consent</li>
          <li>Lodge a complaint with a relevant data protection authority</li>
        </ul>
        <p className={bodyClass}>
          To exercise applicable rights, contact us at:{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>
        </p>
        <p className={bodyClass}>
          We may need to verify your identity before processing certain
          requests.
        </p>
      </Section>

      <Section
        title="12. International Data Transfers"
        titleClass={sectionTitleClass}
      >
        <p className={bodyClass}>
          Because we use cloud infrastructure and third-party service providers,
          your information may be processed or stored in countries other than
          the country where you live.
        </p>
        <p className={bodyClass}>
          Where required by applicable law, we take appropriate measures to
          protect personal information when it is transferred internationally.
        </p>
      </Section>

      <Section title="13. Children’s Privacy" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          The Service is not intended for children under the age required by
          applicable law to independently provide consent to data processing.
        </p>
        <p className={bodyClass}>
          We do not knowingly collect personal information from children without
          appropriate consent.
        </p>
        <p className={bodyClass}>
          If you believe that a child has provided us with personal information,
          please contact us at:{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>
        </p>
      </Section>

      <Section title="14. Third-Party Links" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          The Service may contain links to third-party websites, travel
          resources, or other services.
        </p>
        <p className={bodyClass}>
          We are not responsible for the privacy practices, security, or content
          of third-party websites.
        </p>
        <p className={bodyClass}>
          We recommend reviewing the privacy policies of any third-party service
          you visit.
        </p>
      </Section>

      <Section title="15. Security" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          We use reasonable security measures designed to protect your
          information.
        </p>
        <p className={bodyClass}>These may include:</p>
        <ul className={listClass}>
          <li>Authentication controls</li>
          <li>Access restrictions</li>
          <li>Database security rules</li>
          <li>Storage security rules</li>
          <li>Encryption provided by our infrastructure providers</li>
          <li>Secure server-side processing</li>
          <li>Restricted access to private credentials</li>
        </ul>
        <p className={bodyClass}>
          However, no system is completely secure, and we cannot guarantee
          absolute security.
        </p>
      </Section>

      <Section
        title="16. Changes to This Privacy Policy"
        titleClass={sectionTitleClass}
      >
        <p className={bodyClass}>
          We may update this Privacy Policy from time to time.
        </p>
        <p className={bodyClass}>
          When we make changes, we will update the “Last updated” date at the
          top of this page.
        </p>
        <p className={bodyClass}>
          If changes are material, we may provide additional notice where
          required by applicable law.
        </p>
        <p className={bodyClass}>
          Your continued use of the Service after the updated Privacy Policy
          becomes effective means that you acknowledge the updated policy.
        </p>
      </Section>

      <Section title="17. Contact Us" titleClass={sectionTitleClass}>
        <p className={bodyClass}>
          If you have questions about this Privacy Policy or how we handle your
          information, please contact us:
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
