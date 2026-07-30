/**
 * /terms — Terms of Service page.
 */
import type { Metadata } from "next";
import { buildMetadata, SITE_URL } from "../../lib/seo/metadata";
import { buildBreadcrumbJsonLd } from "../../lib/seo/json-ld";

export const metadata: Metadata = buildMetadata({
  title: "Terms of Service",
  description:
    "Stimuli IQ Terms of Service — the rules and guidelines governing your use of our platform and programs.",
  canonicalPath: "/terms",
});

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

      <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16 md:px-6">

        <header className="mb-10">
          <h1 className="text-3xl font-bold text-fg">Terms of Service</h1>
          <p className="mt-2 text-sm text-fg-muted">
            Version 1.0 — Effective July 2026
          </p>
        </header>

        <article className="prose prose-sm max-w-none text-fg-muted" data-testid="terms-content">
          <p>
            By accessing or using Stimuli IQ&apos;s website, programs, or services, you agree to these
            Terms of Service. Please read them carefully.
          </p>

          <h2>1. Eligibility</h2>
          <p>
            You must be at least 18 years old (or have parental/guardian consent) to enroll in a program.
            Programs are designed for students pursuing MBBS, BDS, BPT, BA or BSc, and allied health
            science qualifications.
          </p>

          <h2>2. Program enrolment</h2>
          <p>
            Enrolment is confirmed only after successful payment. Seats are limited and confirmed on a
            first-come, first-served basis. Access to the LMS is granted within 24 hours of payment
            confirmation.
          </p>

          <h2>3. Intellectual property</h2>
          <p>
            All course content, videos, assessments, and materials are the intellectual property of
            Stimuli IQ Technologies Pvt. Ltd. and are licensed to you for personal educational use only.
            You may not reproduce, redistribute, or sell any content.
          </p>

          <h2>4. Refunds</h2>
          <p>
            Please see our <a href="/refund-policy">Refund Policy</a> for details on eligibility and
            the refund process.
          </p>

          <h2>5. Contact</h2>
          <p>
            For questions about these terms: <a href="mailto:legal@stimuliiq.com">legal@stimuliiq.com</a>
          </p>
        </article>
      </div>
    </>
  );
}
