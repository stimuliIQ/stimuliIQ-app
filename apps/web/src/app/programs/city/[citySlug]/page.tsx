/**
 * /programs/city/[citySlug] — Per-city SEO landing page (T33,
 * docs/plans/phase-9-completion.md). Backed by `client.public.seo.cities` /
 * `client.public.seo.cities/:citySlug` (growth public SEO surface, T30).
 *
 * ISR: pre-rendered for every known city at build time via `generateStaticParams`;
 * unknown slugs generate on-demand and revalidate every 24h.
 * JSON-LD: Course (one per listed program) + BreadcrumbList.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProgramCard } from "@repo/ui";
import { buildMetadata, SITE_URL } from "../../../../lib/seo/metadata";
import { buildBreadcrumbJsonLd, buildCourseJsonLd } from "../../../../lib/seo/json-ld";
import { serverApiClient } from "../../../../lib/api-client";
import { formatPaiseDisplay, formatCompareAtDisplay } from "../../../../lib/format";
import { UpcomingWorkshopStrip } from "../../../../components/home/upcoming-workshop";

export const revalidate = 86_400; // 24h — city program counts change infrequently

export async function generateStaticParams(): Promise<Array<{ citySlug: string }>> {
  try {
    const result = await serverApiClient.public.seo.listCities();
    return result.cities.map((c) => ({ citySlug: c.citySlug }));
  } catch {
    return [];
  }
}

interface PageProps {
  params: Promise<{ citySlug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { citySlug } = await params;
  try {
    const detail = await serverApiClient.public.seo.getCityDetail(citySlug);
    return buildMetadata({
      title: detail.seoTitle,
      description: detail.seoDescription,
      canonicalPath: `/programs/city/${citySlug}`,
    });
  } catch {
    return buildMetadata({ title: "City Not Found", noIndex: true });
  }
}

export default async function CitySeoPage({ params }: PageProps) {
  const { citySlug } = await params;

  let detail: Awaited<ReturnType<typeof serverApiClient.public.seo.getCityDetail>>;
  try {
    detail = await serverApiClient.public.seo.getCityDetail(citySlug);
  } catch {
    notFound();
  }

  const BREADCRUMBS = [
    { label: "Home", href: "/" },
    { label: "Programs", href: "/programs" },
    { label: detail.city },
  ];

  const breadcrumbJsonLd = buildBreadcrumbJsonLd(BREADCRUMBS, SITE_URL);
  // One Course JSON-LD per listed program (capped — avoid an unbounded script payload).
  const courseJsonLds = detail.programs.slice(0, 12).map((program) =>
    buildCourseJsonLd({
      name: program.title,
      description: program.cardSummary ?? `${program.title} — training program by Stimuli IQ in ${detail.city}`,
      url: `${SITE_URL}/programs/${program.slug}`,
      imageUrl: program.ogImageUrl ?? undefined,
      pricePaise: program.pricePaise,
      duration: program.durationWeeks ? `${program.durationWeeks} weeks` : undefined,
      ratingValue: program.ratingAvg != null ? program.ratingAvg / 10 : undefined,
      ratingCount: program.ratingCount ?? undefined,
    }),
  );

  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped JSON-LD
        dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd }}
      />
      {courseJsonLds.map((jsonLd, i) => (
        <script
          // biome-ignore lint/suspicious/noArrayIndexKey: JSON-LD script tags have no stable id
          key={i}
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped JSON-LD
          dangerouslySetInnerHTML={{ __html: jsonLd }}
        />
      ))}

      <main
        id="main-content"
        className="mx-auto max-w-screen-xl px-4 py-10 md:px-6"
        data-testid="city-seo-page"
      >
        <header className="mb-10">
          <h1 className="text-3xl font-bold text-fg sm:text-4xl">
            Best Tech Training Programs in <span className="text-chart-3">{detail.city}</span>
          </h1>
          <p className="mt-3 text-lg text-fg-muted">
            {detail.programs.length} program{detail.programs.length === 1 ? "" : "s"} available for
            students in {detail.city}, with live and recorded training tracks.
          </p>
          <UpcomingWorkshopStrip className="mt-6" />
        </header>

        {detail.programs.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center" data-testid="city-seo-empty">
            <p className="text-lg font-medium text-fg">No programs listed for {detail.city} yet</p>
            <p className="mt-2 text-sm text-fg-muted">
              <a href="/programs" className="text-brand-500 underline">
                Browse all programs
              </a>{" "}
              instead.
            </p>
          </div>
        ) : (
          <ul
            className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
            role="list"
            data-testid="city-seo-program-list"
          >
            {detail.programs.map((program) => (
              <li key={program.id}>
                <ProgramCard
                  imageUrl={program.ogImageUrl ?? undefined}
                  badgeLabel={program.scholarshipAvailable ? "Scholarship available" : undefined}
                  summary={program.cardSummary ?? undefined}
                  title={program.title}
                  priceDisplay={formatPaiseDisplay(program.pricePaise)}
                  originalPriceDisplay={formatCompareAtDisplay(program.compareAtPricePaise, program.pricePaise)}
                  emiDisplay={program.emiDisplay ?? undefined}
                  ratingAvg={program.ratingAvg != null ? program.ratingAvg / 10 : undefined}
                  ratingCount={program.ratingCount ?? undefined}
                  ctaHref={`/programs/${program.slug}`}
                />
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
