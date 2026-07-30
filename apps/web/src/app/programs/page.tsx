/**
 * Courses listing — /programs
 *
 * Reference catalog layout: breadcrumb, "Our Courses & Programs" heading, left
 * filter sidebar (search + Specialisation checkboxes + sort), course-card grid.
 *
 * SSR (no revalidate constant = per-request) so filters/sort are reflected in
 * server-rendered HTML for SEO indexability (AC-24, AC-31).
 *
 * Consumes: client.public.programs.list() with cursor pagination.
 * Search: the public API has no text-search param, so ?q= fetches the max page
 * (50) and title-filters server-side — still SSR, no pagination while searching.
 *
 * States handled:
 *   - Loading: Suspense skeleton (sidebar client boundary)
 *   - Empty: "No courses found" empty state with clear-filters link
 *   - Error: error state with retry link
 *
 * a11y: <main> landmark, breadcrumb nav, heading hierarchy, role="list",
 *        ≥44px CTAs, labelled filter controls, live region for result count.
 */
import type { Metadata } from "next";
import { Suspense } from "react";

import { buildMetadata } from "../../lib/seo/metadata";
import { serverApiClient } from "../../lib/api-client";
import { getCourseDomains } from "../../lib/course-facets";
import { ProgramCard, EmptyState, Skeleton } from "@repo/ui";
import { formatPaiseDisplay, formatCompareAtDisplay, formatRating, formatDuration, formatMode } from "../../lib/format";
import { CoursesSidebar } from "./_components/courses-sidebar";
import { ProgramsPagination } from "./_components/programs-pagination";
import type { ListPublicProgramsQuery, PublicProgramSort } from "@repo/types";

// ---------------------------------------------------------------------------
// Metadata (static; per-filter SEO metadata would be over-engineering for P5)
// ---------------------------------------------------------------------------

export const metadata: Metadata = buildMetadata({
  title: "Courses & Programs — Internship & Career Training",
  description:
    "Browse all Stimuli IQ courses: Full Stack, Python, Data Science, AI/ML, Cloud, DevOps, and more. Search by name and filter by specialisation.",
  canonicalPath: "/programs",
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely parse a sort string from URL params */
function parseSort(raw: string | undefined): PublicProgramSort {
  const valid: PublicProgramSort[] = ["popularity", "price_asc", "price_desc", "newest"];
  if (raw && valid.includes(raw as PublicProgramSort)) {
    return raw as PublicProgramSort;
  }
  return "popularity";
}

// ---------------------------------------------------------------------------
// Page props (Next.js App Router searchParams)
// ---------------------------------------------------------------------------

type SearchParamsValue = string | string[] | undefined;
type SearchParamsRecord = Record<string, SearchParamsValue>;

interface PageProps {
  searchParams?: Promise<SearchParamsRecord>;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function CoursesListingPage({ searchParams }: PageProps) {
  // Await searchParams in Next.js 15 App Router
  const params: SearchParamsRecord = await (searchParams ?? Promise.resolve({} as SearchParamsRecord));

  const q = typeof params.q === "string" ? params.q.trim() : undefined;
  const domain = typeof params.domain === "string" ? params.domain : undefined;
  const sort = parseSort(typeof params.sort === "string" ? params.sort : undefined);
  const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
  const searching = Boolean(q);

  const query: Partial<ListPublicProgramsQuery> = {
    // Searching fetches the max page and title-filters below (no q param in the
    // public API); normal browsing pages by 12 with cursors.
    limit: searching ? 50 : 12,
    sort,
    ...(domain ? { domain } : {}),
    ...(cursor && !searching ? { cursor } : {}),
  };

  // Fetch + facets (SSR — runs on the server per request; facets are cached 1 h)
  let programs: Awaited<ReturnType<typeof serverApiClient.public.programs.list>>["items"] = [];
  let nextCursor: string | null = null;
  let hasMore = false;
  let fetchError = false;

  // The catalog page and the sidebar facets are independent reads, so they are
  // started together rather than one-after-the-other. This page is the only fully
  // dynamic route on the site (it renders `searchParams`), so it pays the full API
  // latency on EVERY request — on a cold facets cache the sequential version cost
  // two round trips to the API where one is enough.
  const [listResult, domains] = await Promise.all([
    serverApiClient.public.programs
      .list(query)
      .then((result) => {
        if (!Array.isArray(result.items)) {
          // Defensive: an envelope-contract violation must degrade to the error
          // state, not crash the page with a 500 (items.map is not a function).
          throw new Error("Malformed programs list response");
        }
        return result;
      })
      .catch(() => null),
    getCourseDomains(),
  ]);

  if (listResult) {
    programs = listResult.items;
    nextCursor = listResult.meta?.nextCursor ?? null;
    hasMore = listResult.meta?.hasMore ?? false;
  } else {
    fetchError = true;
  }

  if (searching && q) {
    const needle = q.toLowerCase();
    programs = programs.filter((p) => p.title.toLowerCase().includes(needle));
    nextCursor = null;
    hasMore = false;
  }

  const filterState = { q, domain, sort };
  const hasActiveFilters = Boolean(q || domain);

  return (
    <main
      id="main-content"
      className="mx-auto max-w-screen-xl px-4 py-10 md:px-6"
      data-testid="programs-listing"
    >
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-fg md:text-4xl">Our <span className="text-chart-3">Courses &amp; Programs</span></h1>
        <p className="mt-2 text-lg text-fg-muted">
          Industry-grade internship training across software, data, cloud, and design.
        </p>
      </div>

      {/* Sidebar + grid */}
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[280px_1fr]">
        {/* Sidebar — client component (needs useRouter/useSearchParams) */}
        <Suspense
          fallback={
            <div className="flex flex-col gap-4" aria-label="Loading filters">
              <Skeleton className="h-[44px] w-full rounded-md" />
              <Skeleton className="h-40 w-full rounded-md" />
              <Skeleton className="h-[44px] w-full rounded-md" />
            </div>
          }
        >
          <aside>
            <CoursesSidebar
              domains={domains}
              current={filterState}
              totalCount={fetchError ? undefined : programs.length}
              hasMore={hasMore}
            />
          </aside>
        </Suspense>

        <div>
          {/* Error state */}
          {fetchError ? (
            <EmptyState
              title="Unable to load courses"
              description="We couldn't fetch the course catalog right now. Please try again."
              action={
                <a
                  href="/programs"
                  className="inline-flex min-h-[44px] items-center rounded-md bg-brand-500 px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  Retry
                </a>
              }
              data-testid="programs-error"
            />
          ) : programs.length === 0 ? (
            /* Empty state */
            <EmptyState
              title="No courses found"
              description={
                hasActiveFilters
                  ? "No courses match your search or filters. Try adjusting or clearing them."
                  : "No courses are currently listed. Check back soon."
              }
              action={
                hasActiveFilters ? (
                  <a
                    href="/programs"
                    className="inline-flex min-h-[44px] items-center rounded-md border border-border px-6 text-sm font-medium text-fg transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    Clear filters
                  </a>
                ) : undefined
              }
              data-testid="programs-empty"
            />
          ) : (
            /* Course grid */
            <>
              <ul
                role="list"
                className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3"
                aria-label={`${programs.length} course${programs.length === 1 ? "" : "s"}`}
                data-testid="programs-grid"
              >
                {programs.map((program) => (
                  <li key={program.id}>
                    <ProgramCard
                      data-testid="program-listing-card"
                      title={program.title}
                      imageUrl={program.ogImageUrl ?? undefined}
                      badgeLabel={program.scholarshipAvailable ? "Scholarship available" : undefined}
                      summary={program.cardSummary ?? undefined}
                      domain={program.domain}
                      duration={formatDuration(program.durationWeeks)}
                      mode={formatMode(program.mode)}
                      level={program.level ?? undefined}
                      priceDisplay={formatPaiseDisplay(program.pricePaise)}
                      originalPriceDisplay={formatCompareAtDisplay(program.compareAtPricePaise, program.pricePaise)}
                      emiDisplay={program.emiDisplay ?? undefined}
                      ratingAvg={
                        program.ratingAvg != null
                          ? Number(formatRating(program.ratingAvg))
                          : undefined
                      }
                      ratingCount={program.ratingCount ?? undefined}
                      ctaLabel="Explore Course"
                      ctaHref={`/programs/${program.slug}`}
                    />
                  </li>
                ))}
              </ul>

              {/* Pagination (hidden while searching — search is a single filtered page) */}
              {!searching ? (
                <Suspense fallback={null}>
                  <ProgramsPagination nextCursor={nextCursor} hasMore={hasMore} />
                </Suspense>
              ) : null}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
