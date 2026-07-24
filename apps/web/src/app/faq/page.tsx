/**
 * /faq — Global FAQ page.
 *
 * SSG: reads FAQ entries from content/faq/*.mdx.
 * JSON-LD: FAQPage schema + Breadcrumb.
 * a11y: Breadcrumbs, FaqAccordion (keyboard-operable via Radix).
 */
import type { Metadata } from "next";
import { Breadcrumbs, FaqAccordion } from "@repo/ui";
import { buildMetadata, SITE_URL } from "../../lib/seo/metadata";
import { buildBreadcrumbJsonLd, buildFaqJsonLd } from "../../lib/seo/json-ld";
import { getAllFaqEntries } from "../../lib/content/loader";

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export const metadata: Metadata = buildMetadata({
  title: "Frequently Asked Questions",
  description:
    "Answers to common questions about StimuliiQ programs, payment options, certificates, and more.",
  canonicalPath: "/faq",
});

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const BREADCRUMBS = [
  { label: "Home", href: "/" },
  { label: "FAQ" },
];

export default async function FaqPage() {
  const faqEntries = await getAllFaqEntries();

  const faqItems = faqEntries.map((entry) => ({
    id: entry.id,
    question: entry.question,
    answer: entry.answerText,
    answerText: entry.answerText,
  }));

  const breadcrumbJsonLd = buildBreadcrumbJsonLd(BREADCRUMBS, SITE_URL);
  const faqJsonLd = faqItems.length
    ? buildFaqJsonLd(faqItems.map((i) => ({ question: i.question, answerText: i.answerText })))
    : null;

  return (
    <>
      {/* Structured data */}
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped JSON-LD
        dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd }}
      />
      {faqJsonLd ? (
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped JSON-LD
          dangerouslySetInnerHTML={{ __html: faqJsonLd }}
        />
      ) : null}

      <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16 md:px-6">
        {/* Breadcrumbs */}
        <Breadcrumbs items={BREADCRUMBS} className="mb-8" data-testid="faq-breadcrumbs" />

        {/* Heading */}
        <header className="mb-10">
          <h1 className="text-3xl font-bold text-fg sm:text-4xl">
            Frequently Asked <span className="text-chart-3">Questions</span>
          </h1>
          <p className="mt-3 text-lg text-fg-muted">
            Can&apos;t find an answer? Contact us at{" "}
            <a
              href="/contact"
              className="font-medium text-brand-500 underline-offset-2 hover:underline"
            >
              our support page
            </a>
            .
          </p>
        </header>

        {/* FAQ accordion */}
        {faqItems.length > 0 ? (
          <FaqAccordion
            items={faqItems}
            allowMultiple
            data-testid="faq-accordion"
          />
        ) : (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <p className="text-fg-muted">No FAQ entries found. Check back soon.</p>
          </div>
        )}
      </div>
    </>
  );
}
