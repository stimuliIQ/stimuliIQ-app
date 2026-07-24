/**
 * /lp/[slug] — Campaign landing page (T33, docs/plans/phase-9-completion.md).
 *
 * Renders `client.public.landingPages.get(slug, { variant })` — the server resolves
 * the live A/B split when `?variant=` is omitted. Content is a `ContentBlock[]`
 * rendered through `ContentBlockRenderer` (RenderSink at every `richtext` block,
 * ADR-0045). ISR-cached briefly (campaign pages update more often than programs)
 * and excluded from the sitemap/robots (see `robots.ts`) — the same treatment as
 * `/book-free-slot`; these are ad-traffic pages, not organic-search targets.
 *
 * Unknown/unpublished slug → 404 (server enforces publish-gate).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentBlockRenderer } from "../../../components/content/content-block-renderer";
import { serverApiClient } from "../../../lib/api-client";
import { buildMetadata } from "../../../lib/seo/metadata";

export const revalidate = 300; // 5 min — campaign pages change more often than programs

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ variant?: string }>;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const { variant } = await searchParams;

  try {
    const page = await serverApiClient.public.landingPages.get(slug, variant ? { variant } : undefined);
    return buildMetadata({
      title: page.seoTitle ?? page.title,
      description: page.seoDescription ?? undefined,
      canonicalPath: `/lp/${slug}`,
      noIndex: true, // campaign pages: not an organic-search target (see robots.ts)
    });
  } catch {
    return buildMetadata({ title: "Page Not Found", noIndex: true });
  }
}

export default async function LandingPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { variant } = await searchParams;

  let page: Awaited<ReturnType<typeof serverApiClient.public.landingPages.get>>;
  try {
    page = await serverApiClient.public.landingPages.get(slug, variant ? { variant } : undefined);
  } catch {
    notFound();
  }

  return (
    <main
      id="main-content"
      className="mx-auto max-w-4xl px-4 py-12 sm:py-16 md:px-6"
      data-testid="landing-page"
      data-variant={page.variant}
    >
      <h1 className="sr-only">{page.title}</h1>
      <ContentBlockRenderer blocks={page.content} />
    </main>
  );
}
