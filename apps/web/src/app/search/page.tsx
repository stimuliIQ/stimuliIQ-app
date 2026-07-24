/**
 * /search — Global search page (T33, docs/plans/phase-9-completion.md).
 *
 * Programs + blog article search with type/filter facets. The interactive UI is
 * a client component (`SearchPageClient`) wrapped in Suspense because it reads
 * `useSearchParams()` (required by the Next.js App Router for correct static
 * shell rendering).
 */
import type { Metadata } from "next";
import { Suspense } from "react";
import { Breadcrumbs } from "@repo/ui";
import { buildMetadata, SITE_URL } from "../../lib/seo/metadata";
import { buildBreadcrumbJsonLd } from "../../lib/seo/json-ld";
import { SearchPageClient } from "./_components/search-client";

export const metadata: Metadata = buildMetadata({
  title: "Search",
  description: "Search StimuliiQ programs, blog articles, and resources.",
  canonicalPath: "/search",
  noIndex: true,
});

const BREADCRUMBS = [
  { label: "Home", href: "/" },
  { label: "Search" },
];

export default function SearchPage() {
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(BREADCRUMBS, SITE_URL);

  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped JSON-LD
        dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd }}
      />

      <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16 md:px-6">
        <Breadcrumbs items={BREADCRUMBS} className="mb-8" data-testid="search-breadcrumbs" />

        <header className="mb-8">
          <h1 className="text-3xl font-bold text-fg sm:text-4xl">Search</h1>
        </header>

        <Suspense
          fallback={
            <div className="h-12 w-full animate-pulse rounded-md bg-surface" aria-hidden="true" />
          }
        >
          <SearchPageClient />
        </Suspense>
      </div>
    </>
  );
}
