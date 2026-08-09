/**
 * /gallery — Sessions, certificates, events gallery.
 *
 * Phase-10 page builder (docs/specs/phase-10-page-builder.md item B): thin
 * `ContentPage`-driven wrapper. Fetches the `slug="gallery"` builder-managed page and
 * renders it through the shared `PageBlocks` registry renderer (the `media_gallery`
 * block replaces the old placeholder `<div>` with real `next/image`, per that page's own
 * "replaced with next/image ... in production" code comment).
 *
 * RESILIENCE: falls back to `GalleryPageFallback` (the exact pre-migration hardcoded
 * page, still using the placeholder div) on any API failure / unpublished /
 * non-builder-managed row.
 */
import type { Metadata } from "next";
import { buildMetadata, SITE_URL } from "../../lib/seo/metadata";
import { buildBreadcrumbJsonLd } from "../../lib/seo/json-ld";
import { resolveAssetUrl } from "../../lib/media";
import { serverApiClient } from "../../lib/api-client";
import { PageBlocks } from "../../components/page-builder/page-blocks";
import { GalleryPageFallback } from "../../components/page-builder/fallbacks/gallery-fallback";
import type { ResolvedPageBuilderBlock } from "@repo/types";

// 5 min ISR — builder-editable surface; matches the homepage so CRM edits surface consistently
export const revalidate = 300;

const GALLERY_SLUG = "gallery";

const FALLBACK_METADATA = {
  title: "Gallery of sessions, certificates and events",
  description: "Photos and highlights from Stimuli IQ training sessions, certificate ceremonies, and industry events.",
};

const BREADCRUMBS = [{ label: "Home", href: "/" }, { label: "Gallery" }];

export async function generateMetadata(): Promise<Metadata> {
  try {
    const page = await serverApiClient.public.content.pages.getBySlug(GALLERY_SLUG);
    return buildMetadata({
      title: page.seoTitle ?? FALLBACK_METADATA.title,
      description: page.seoDescription ?? FALLBACK_METADATA.description,
      canonicalPath: "/gallery",
      ogImage: resolveAssetUrl(page.seoImagePath) ?? undefined,
    });
  } catch {
    return buildMetadata({ ...FALLBACK_METADATA, canonicalPath: "/gallery" });
  }
}

export default async function GalleryPage() {
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(BREADCRUMBS, SITE_URL);

  let blocks: ResolvedPageBuilderBlock[] | null = null;
  try {
    const page = await serverApiClient.public.content.pages.getBySlug(GALLERY_SLUG);
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

      {blocks ? (
        <PageBlocks blocks={blocks} />
      ) : (
        // The pre-migration fallback has no container of its own — keep the
        // original narrow wrapper so it renders exactly as it always did.
        <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16 md:px-6">
          <GalleryPageFallback />
        </div>
      )}
    </>
  );
}
