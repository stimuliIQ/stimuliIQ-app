/**
 * /terms — Terms of Service page.
 */
import type { Metadata } from "next";
import { buildMetadata, SITE_URL } from "../../lib/seo/metadata";
import { buildBreadcrumbJsonLd } from "../../lib/seo/json-ld";
import { SUPPORT_EMAIL } from "../../lib/contact";
import { ContactLink, LegalContactCard, LegalHeader, LegalSection } from "../../components/legal/legal-ui";

export const metadata: Metadata = buildMetadata({
  title: "Terms of Service",
  description:
    "Stimuli IQ Terms of Service — the rules and guidelines governing your use of our platform and programs.",
  canonicalPath: "/terms",
});

const LAST_UPDATED = "July 2026";

const BREADCRUMBS = [
  { label: "Home", href: "/" },
  { label: "Terms of Service" },
];

export default function TermsPage() {
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
        data-testid="terms-content"
      >
        <LegalHeader
          title="Terms of Service"
          lastUpdated={LAST_UPDATED}
          intro="By accessing or using Stimuli IQ's website, programs, or services, you agree to
            these Terms of Service. Please read them carefully."
        />

        <LegalSection id="eligibility-heading" title="1. Eligibility">
          <p>
            You must be at least 18 years old (or have parental/guardian consent) to enrol in a
            program. Programs are designed for students pursuing MBBS, BDS, BPT, BA or BSc, and
            allied health science qualifications.
          </p>
        </LegalSection>

        <LegalSection id="enrolment-heading" title="2. Program enrolment">
          <p>
            Enrolment is confirmed only after successful payment. Seats are limited and confirmed
            on a first-come, first-served basis. Access to the LMS is granted within 24 hours of
            payment confirmation.
          </p>
        </LegalSection>

        <LegalSection id="ip-heading" title="3. Intellectual property">
          <p>
            All course content, videos, assessments, and materials are the intellectual property
            of Stimuli IQ Technologies Pvt. Ltd. and are licensed to you for personal educational
            use only. You may not reproduce, redistribute, or sell any content.
          </p>
        </LegalSection>

        <LegalSection id="refunds-heading" title="4. Refunds">
          <p>
            Please see our <ContactLink href="/refund-policy">Refund Policy</ContactLink> for
            details on eligibility and the refund process.
          </p>
        </LegalSection>

        <LegalContactCard id="contact-heading" title="5. Contact">
          For questions about these terms, email{" "}
          <ContactLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</ContactLink>.
        </LegalContactCard>
      </main>
    </>
  );
}
