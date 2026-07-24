/**
 * /partners — Hiring & college partners page.
 *
 * ISR: fetched from the headless content API (`client.public.content.partners`,
 * T32, docs/plans/phase-9-completion.md) — replaces the previous hardcoded array.
 */
import type { Metadata } from "next";
import { Breadcrumbs, EmptyState } from "@repo/ui";
import { buildMetadata, SITE_URL } from "../../lib/seo/metadata";
import { buildBreadcrumbJsonLd } from "../../lib/seo/json-ld";
import { serverApiClient } from "../../lib/api-client";
import type { PublicPartner } from "@repo/types";

export const revalidate = 3600;

export const metadata: Metadata = buildMetadata({
  title: "Hiring Partners & College Partners",
  description:
    "StimuliiQ works with 150+ hiring companies and 80+ colleges across India. Our alumni are placed at Freshworks, Flipkart, Razorpay, and more.",
  canonicalPath: "/partners",
});

const BREADCRUMBS = [
  { label: "Home", href: "/" },
  { label: "Partners" },
];

export default async function PartnersPage() {
  let partners: PublicPartner[] = [];
  let fetchError = false;

  try {
    partners = await serverApiClient.public.content.partners.list();
  } catch {
    fetchError = true;
  }

  const breadcrumbJsonLd = buildBreadcrumbJsonLd(BREADCRUMBS, SITE_URL);

  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped JSON-LD
        dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd }}
      />

      <div className="mx-auto max-w-5xl px-4 py-12 sm:py-16 md:px-6">
        <Breadcrumbs items={BREADCRUMBS} className="mb-8" data-testid="partners-breadcrumbs" />

        <header className="mb-12">
          <h1 className="text-3xl font-bold text-fg sm:text-4xl">Our <span className="text-chart-3">Partners</span></h1>
          <p className="mt-3 text-lg text-fg-muted">
            150+ companies trust StimuliiQ alumni. Join them.
          </p>
        </header>

        <section aria-labelledby="hiring-partners-heading">
          <h2 id="hiring-partners-heading" className="mb-6 text-xl font-semibold text-fg">
            Hiring Partners
          </h2>

          {fetchError ? (
            <EmptyState
              title="Unable to load partners"
              description="We couldn't fetch our partner list. Please refresh or try again later."
              data-testid="partners-error"
            />
          ) : partners.length === 0 ? (
            <EmptyState
              title="No partners listed yet"
              description="Partners will appear here once published."
              data-testid="partners-empty"
            />
          ) : (
            <ul
              className="flex flex-wrap gap-3"
              role="list"
              data-testid="hiring-partners-list"
            >
              {partners.map((partner) =>
                partner.url ? (
                  <li key={partner.id}>
                    <a
                      href={partner.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-fg shadow-sm transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {partner.logoUrl ? (
                        <img src={partner.logoUrl} alt="" aria-hidden="true" className="h-5 w-auto" loading="lazy" />
                      ) : null}
                      {partner.name}
                    </a>
                  </li>
                ) : (
                  <li key={partner.id}>
                    <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-fg shadow-sm">
                      {partner.logoUrl ? (
                        <img src={partner.logoUrl} alt="" aria-hidden="true" className="h-5 w-auto" loading="lazy" />
                      ) : null}
                      {partner.name}
                    </span>
                  </li>
                ),
              )}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
