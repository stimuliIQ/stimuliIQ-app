/**
 * /for-colleges — College B2B page.
 *
 * Phase-10 page builder (docs/specs/phase-10-page-builder.md item B): thin
 * `ContentPage`-driven wrapper. Fetches the `slug="for-colleges"` builder-managed page
 * and renders it through the shared `PageBlocks` registry renderer.
 *
 * RESILIENCE: falls back to `ForCollegesPageFallback` (the exact pre-migration hardcoded
 * page) on any API failure / unpublished / non-builder-managed row.
 */
import type { Metadata } from "next";
import { Breadcrumbs } from "@repo/ui";
import { buildMetadata, SITE_URL } from "../../lib/seo/metadata";
import { buildBreadcrumbJsonLd } from "../../lib/seo/json-ld";
import { resolveAssetUrl } from "../../lib/media";
import { serverApiClient } from "../../lib/api-client";
import { PageBlocks } from "../../components/page-builder/page-blocks";
import { ForCollegesPageFallback } from "../../components/page-builder/fallbacks/for-colleges-fallback";
import type { ResolvedPageBuilderBlock } from "@repo/types";

// 5 min ISR — builder-editable surface; matches the homepage so CRM edits surface consistently
export const revalidate = 300;

const FOR_COLLEGES_SLUG = "for-colleges";

const FALLBACK_METADATA = {
  title: "For Colleges — Campus Training Partnerships",
  description: "Partner with StimuliiQ to provide industry-grade tech training to your students. We work with 80+ colleges across India.",
};

const BREADCRUMBS = [{ label: "Home", href: "/" }, { label: "For Colleges" }];

export async function generateMetadata(): Promise<Metadata> {
  try {
    const page = await serverApiClient.public.content.pages.getBySlug(FOR_COLLEGES_SLUG);
    return buildMetadata({
      title: page.seoTitle ?? FALLBACK_METADATA.title,
      description: page.seoDescription ?? FALLBACK_METADATA.description,
      canonicalPath: "/for-colleges",
      ogImage: resolveAssetUrl(page.seoImagePath) ?? undefined,
    });
  } catch {
    return buildMetadata({ ...FALLBACK_METADATA, canonicalPath: "/for-colleges" });
  }
}

export default async function ForCollegesPage() {
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(BREADCRUMBS, SITE_URL);

  let blocks: ResolvedPageBuilderBlock[] | null = null;
  try {
    const page = await serverApiClient.public.content.pages.getBySlug(FOR_COLLEGES_SLUG);
    if (page.isBuilderManaged) {
      blocks = page.body as ResolvedPageBuilderBlock[];
    }
  } catch {
    blocks = null;
  }

  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped JSON-LD
        dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd }}
      />

      {/* Site-standard container for the breadcrumb; blocks render full-bleed below
          because every registry block owns its own `max-w-screen-xl px-4 md:px-6`
          container (same pattern as /about — a narrower outer wrapper here would
          double-constrain and double-pad every section). */}
      <section aria-label="Breadcrumb" className="mx-auto max-w-screen-xl px-4 pt-10 md:px-6">
        <Breadcrumbs items={BREADCRUMBS} className="mb-0 text-sm" data-testid="colleges-breadcrumbs" />
      </section>

      {blocks ? (
        <PageBlocks blocks={blocks} />
      ) : (
        // The pre-migration fallback has no container of its own — keep the
        // original narrow wrapper so it renders exactly as it always did.
        <div className="mx-auto max-w-4xl px-4 py-12 sm:py-16 md:px-6">
          <ForCollegesPageFallback />
        </div>
      )}
    </>
  );
}
