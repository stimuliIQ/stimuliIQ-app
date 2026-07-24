/**
 * Scholarship page — /scholarship
 *
 * Phase-10 page builder (docs/specs/phase-10-page-builder.md item B): thin
 * `ContentPage`-driven wrapper. Fetches the `slug="scholarship"` builder-managed page
 * and renders it through the shared `PageBlocks` registry renderer.
 *
 * RESILIENCE: falls back to `ScholarshipPageFallback` (the exact pre-migration hardcoded
 * page) on any API failure / unpublished / non-builder-managed row.
 */
import type { Metadata } from "next";
import { buildMetadata } from "../../lib/seo/metadata";
import { resolveAssetUrl } from "../../lib/media";
import { serverApiClient } from "../../lib/api-client";
import { PageBlocks } from "../../components/page-builder/page-blocks";
import { ScholarshipPageFallback } from "../../components/page-builder/fallbacks/scholarship-fallback";
import type { ResolvedPageBuilderBlock } from "@repo/types";

// 5 min ISR — builder-editable surface; matches the homepage so CRM edits surface consistently
export const revalidate = 300;

const SCHOLARSHIP_SLUG = "scholarship";

const FALLBACK_METADATA = {
  title: "StimuliiQ Scholarship Programme — Merit & Need Based Fee Waivers",
  description:
    "The StimuliiQ Scholarship grants merit-and-need-based fee waivers of up to 50% on internship-training programs for B.Tech, Degree, Diploma, MCA and MBA students across India.",
};

export async function generateMetadata(): Promise<Metadata> {
  try {
    const page = await serverApiClient.public.content.pages.getBySlug(SCHOLARSHIP_SLUG);
    return buildMetadata({
      title: page.seoTitle ?? FALLBACK_METADATA.title,
      description: page.seoDescription ?? FALLBACK_METADATA.description,
      canonicalPath: "/scholarship",
      ogImage: resolveAssetUrl(page.seoImagePath) ?? undefined,
    });
  } catch {
    return buildMetadata({ ...FALLBACK_METADATA, canonicalPath: "/scholarship" });
  }
}

export default async function ScholarshipPage() {
  let blocks: ResolvedPageBuilderBlock[] | null = null;
  try {
    const page = await serverApiClient.public.content.pages.getBySlug(SCHOLARSHIP_SLUG);
    if (page.isBuilderManaged) {
      blocks = page.body as ResolvedPageBuilderBlock[];
    }
  } catch {
    blocks = null;
  }

  if (!blocks) {
    return <ScholarshipPageFallback />;
  }

  return (
    <main id="main-content" className="flex flex-col" data-testid="scholarship-page">
      <PageBlocks blocks={blocks} />
    </main>
  );
}
