/**
 * /privacy — Privacy Policy page.
 */
import type { Metadata } from "next";
import { buildMetadata, SITE_URL } from "../../lib/seo/metadata";
import { buildBreadcrumbJsonLd } from "../../lib/seo/json-ld";

export const metadata: Metadata = buildMetadata({
  title: "Privacy Policy",
  description:
    "Stimuli IQ Privacy Policy — how we collect, use, and protect your personal data under DPDP and applicable Indian law.",
  canonicalPath: "/privacy",
});

const BREADCRUMBS = [
  { label: "Home", href: "/" },
  { label: "Privacy Policy" },
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

      <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16 md:px-6">

        <header className="mb-10">
          <h1 className="text-3xl font-bold text-fg">Privacy Policy</h1>
          <p className="mt-2 text-sm text-fg-muted">Last updated: July 2026 (v1.0)</p>
        </header>

        <article className="prose prose-sm max-w-none text-fg-muted" data-testid="privacy-content">
          <p>
            Stimuli IQ Technologies Pvt. Ltd. (&ldquo;Stimuli IQ&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;)
            is committed to protecting your personal data. This Privacy Policy describes how we collect,
            use, and protect information when you use our website and services, in accordance with India&apos;s
            Digital Personal Data Protection (DPDP) Act 2023 and applicable law.
          </p>

          <h2>1. What data we collect</h2>
          <ul>
            <li>Contact information (name, email, phone) when you submit a form or enroll.</li>
            <li>Usage data (pages visited, time on site) via analytics — only after your consent.</li>
            <li>Payment information is processed by Razorpay; we do not store card details.</li>
            <li>IP address is hashed (SHA-256) for consent records; the raw IP is never stored.</li>
          </ul>

          <h2>2. How we use your data</h2>
          <ul>
            <li>To fulfil your training program enrollment and issue certificates.</li>
            <li>To contact you about your program, counselling bookings, and support queries.</li>
            <li>With your explicit consent, to send marketing communications via WhatsApp/email/SMS.</li>
            <li>To improve our platform and content (analytics — consent-gated).</li>
          </ul>

          <h2>3. Consent</h2>
          <p>
            We ask for your explicit consent before sending marketing communications. You may withdraw
            consent at any time by contacting us at privacy@stimuliiq.com. Analytics cookies are only
            activated after you accept the consent banner on our website.
          </p>

          <h2>4. Contact</h2>
          <p>
            For data requests or concerns: <a href="mailto:privacy@stimuliiq.com">privacy@stimuliiq.com</a>
          </p>
        </article>
      </div>
    </>
  );
}
