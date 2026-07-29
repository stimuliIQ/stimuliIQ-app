/**
 * /about — About Us page.
 *
 * Phase-10 page builder (docs/specs/phase-10-page-builder.md item B): thin
 * `ContentPage`-driven wrapper. Fetches the `slug="about"` builder-managed page and
 * renders it through the shared `PageBlocks` registry renderer.
 *
 * RESILIENCE: falls back to `AboutPageFallback` (the exact pre-migration hardcoded page)
 * on any API failure / unpublished / non-builder-managed row.
 *
 * Edge case #6 (retiring the legacy MDX-frontmatter SEO dependency): this page's
 * `generateMetadata` NO LONGER reads `content/pages/about.mdx` via
 * `lib/content/loader.ts#getContentPageMeta` — that was a DIFFERENT system from the
 * `ContentPage` Prisma model despite the similar name (see that loader's own doc
 * comment). SEO now comes from the `ContentPage.seoTitle`/`seoDescription` fields (set in
 * the seed fixture / editable in the CRM builder), falling back to a hardcoded constant
 * (the same copy the .mdx frontmatter carried) if the API call fails — never the .mdx
 * file. `content/pages/about.mdx`'s frontmatter is therefore now dead for this route
 * (the file itself is left in place — deleting it is a content-ownership decision outside
 * this pass's authority).
 */
import type { Metadata } from "next";
import { Breadcrumbs } from "@repo/ui";
import { buildMetadata, SITE_URL } from "../../lib/seo/metadata";
import { buildOrganizationJsonLd, buildBreadcrumbJsonLd } from "../../lib/seo/json-ld";
import { resolveAssetUrl } from "../../lib/media";
import { serverApiClient } from "../../lib/api-client";
import { PageBlocks } from "../../components/page-builder/page-blocks";
import { AboutPageFallback } from "../../components/page-builder/fallbacks/about-fallback";
import type { ResolvedPageBuilderBlock } from "@repo/types";

// 5 min ISR — builder-editable surface; matches the homepage so CRM edits surface consistently
export const revalidate = 300;

const ABOUT_SLUG = "about";

const FALLBACK_METADATA = {
  title: "About Us",
  description:
    "Stimuli IQ is a healthcare education and training platform for India's medical, psychology, and allied health science students — bridging the gap between academics and real practice.",
};

const BREADCRUMBS = [{ label: "Home", href: "/" }, { label: "About StimuliiQ" }];

export async function generateMetadata(): Promise<Metadata> {
  try {
    const page = await serverApiClient.public.content.pages.getBySlug(ABOUT_SLUG);
    return buildMetadata({
      title: page.seoTitle ?? FALLBACK_METADATA.title,
      description: page.seoDescription ?? FALLBACK_METADATA.description,
      canonicalPath: "/about",
      ogImage: resolveAssetUrl(page.seoImagePath) ?? undefined,
    });
  } catch {
    return buildMetadata({ ...FALLBACK_METADATA, canonicalPath: "/about" });
  }
}

export default async function AboutPage() {
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(BREADCRUMBS, SITE_URL);
  const orgJsonLd = buildOrganizationJsonLd();

  let blocks: ResolvedPageBuilderBlock[] | null = null;
  try {
    const page = await serverApiClient.public.content.pages.getBySlug(ABOUT_SLUG);
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
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped JSON-LD
        dangerouslySetInnerHTML={{ __html: orgJsonLd }}
      />

      <section aria-label="Breadcrumb" className="mx-auto max-w-screen-xl px-4 pt-10 md:px-6">
        <Breadcrumbs items={BREADCRUMBS} className="mb-0 text-sm" data-testid="about-breadcrumbs" />
      </section>

      {blocks ? (
        <div data-testid="about-content">
          <PageBlocks blocks={blocks} />
        </div>
      ) : (
        <AboutPageFallback />
      )}
    </>
  );
}
