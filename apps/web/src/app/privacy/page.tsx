/**
 * /privacy — Privacy Policy page.
 */
import type { Metadata } from "next";
import { buildMetadata, SITE_URL } from "../../lib/seo/metadata";
import { buildBreadcrumbJsonLd } from "../../lib/seo/json-ld";
import { SUPPORT_EMAIL } from "../../lib/contact";
import { ContactLink, LegalContactCard, LegalHeader, LegalItemList, LegalSection } from "../../components/legal/legal-ui";

export const metadata: Metadata = buildMetadata({
  title: "Privacy Policy",
  description:
    "Stimuli IQ Privacy Policy — how we collect, use, and protect your personal data under DPDP and applicable Indian law.",
  canonicalPath: "/privacy",
});

const LAST_UPDATED = "July 2026";

const BREADCRUMBS = [
  { label: "Home", href: "/" },
  { label: "Privacy Policy" },
];

const DATA_COLLECTED = [
  {
    title: "Contact information",
    body: "Name, email, and phone number when you submit a form or enrol.",
  },
  {
    title: "Usage data",
    body: "Pages visited and time on site, via analytics — only after your consent.",
  },
  {
    title: "Payment information",
    body: "Processed by Razorpay; we do not store your card details.",
  },
  {
    title: "IP address",
    body: "Hashed (SHA-256) for consent records; the raw IP address is never stored.",
  },
];

const DATA_USE = [
  {
    title: "Program delivery",
    body: "To fulfil your training program enrolment and issue certificates.",
  },
  {
    title: "Support and updates",
    body: "To contact you about your program, counselling bookings, and support queries.",
  },
  {
    title: "Marketing (opt-in only)",
    body: "With your explicit consent, to send marketing communications via WhatsApp, email, or SMS.",
  },
  {
    title: "Product improvement",
    body: "To improve our platform and content through consent-gated analytics.",
  },
];

export default function PrivacyPage() {
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(BREADCRUMBS, SITE_URL);

  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped JSON-LD
        dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd }}
      />

      <main
        id="main-content"
        className="mx-auto max-w-3xl px-4 py-12 md:px-6 lg:py-16"
        data-testid="privacy-content"
      >
        <LegalHeader
          title="Privacy Policy"
          lastUpdated={LAST_UPDATED}
          intro={
            <>
              Stimuli IQ Technologies Pvt. Ltd. (&ldquo;Stimuli IQ&rdquo;, &ldquo;we&rdquo;,
              &ldquo;us&rdquo;, or &ldquo;our&rdquo;) is committed to protecting your personal
              data. This policy describes how we collect, use, and protect information when you
              use our website and services, in accordance with India&apos;s Digital Personal Data
              Protection (DPDP) Act 2023 and applicable law.
            </>
          }
        />

        <section aria-labelledby="data-collected-heading" className="mt-12">
          <h2 id="data-collected-heading" className="text-xl font-bold text-fg">
            1. What data we collect
          </h2>
          <LegalItemList items={DATA_COLLECTED} />
        </section>

        <section aria-labelledby="data-use-heading" className="mt-12">
          <h2 id="data-use-heading" className="text-xl font-bold text-fg">
            2. How we use your data
          </h2>
          <LegalItemList items={DATA_USE} />
        </section>

        <LegalSection id="consent-heading" title="3. Consent">
          <p>
            We ask for your explicit consent before sending marketing communications. You may
            withdraw consent at any time by contacting us at{" "}
            <ContactLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</ContactLink>. Analytics
            cookies are only activated after you accept the consent banner on our website.
          </p>
        </LegalSection>

        <LegalContactCard id="contact-heading" title="4. Contact">
          For data requests or concerns, email{" "}
          <ContactLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</ContactLink>.
        </LegalContactCard>
      </main>
    </>
  );
}
