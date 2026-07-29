/**
 * /careers — Careers page with open roles.
 *
 * Phase-10 page builder (docs/specs/phase-10-page-builder.md item B): thin
 * `ContentPage`-driven wrapper. Fetches the `slug="careers"` builder-managed page and
 * renders it through the shared `PageBlocks` registry renderer (the `job_openings` block
 * reuses `CareersRoleList` as-is).
 *
 * RESILIENCE: falls back to `CareersPageFallback` (the exact pre-migration hardcoded
 * page) on any API failure / unpublished / non-builder-managed row.
 */
import type { Metadata } from "next";
import { Breadcrumbs } from "@repo/ui";
import { buildMetadata, SITE_URL } from "../../lib/seo/metadata";
import { buildBreadcrumbJsonLd } from "../../lib/seo/json-ld";
import { resolveAssetUrl } from "../../lib/media";
import { serverApiClient } from "../../lib/api-client";
import { PageBlocks } from "../../components/page-builder/page-blocks";
import { CareersPageFallback } from "../../components/page-builder/fallbacks/careers-fallback";
import type { ResolvedPageBuilderBlock } from "@repo/types";

// 5 min ISR — builder-editable surface; matches the homepage so CRM edits surface consistently
export const revalidate = 300;

const CAREERS_SLUG = "careers";

const FALLBACK_METADATA = {
  title: "Careers at StimuliiQ",
  description: "Join the StimuliiQ team. We are hiring instructors, counsellors, and engineers passionate about transforming tech education in India.",
};

const BREADCRUMBS = [{ label: "Home", href: "/" }, { label: "Careers" }];

export async function generateMetadata(): Promise<Metadata> {
  try {
    const page = await serverApiClient.public.content.pages.getBySlug(CAREERS_SLUG);
    return buildMetadata({
      title: page.seoTitle ?? FALLBACK_METADATA.title,
      description: page.seoDescription ?? FALLBACK_METADATA.description,
      canonicalPath: "/careers",
      ogImage: resolveAssetUrl(page.seoImagePath) ?? undefined,
    });
  } catch {
    return buildMetadata({ ...FALLBACK_METADATA, canonicalPath: "/careers" });
  }
}

export default async function CareersPage() {
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(BREADCRUMBS, SITE_URL);

  let blocks: ResolvedPageBuilderBlock[] | null = null;
  try {
    const page = await serverApiClient.public.content.pages.getBySlug(CAREERS_SLUG);
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
        <Breadcrumbs items={BREADCRUMBS} className="mb-0 text-sm" data-testid="careers-breadcrumbs" />
      </section>

      {blocks ? (
        <PageBlocks blocks={blocks} />
      ) : (
        // The pre-migration fallback has no container of its own — keep the
        // original narrow wrapper so it renders exactly as it always did.
        <div className="mx-auto max-w-4xl px-4 py-12 sm:py-16 md:px-6">
          <CareersPageFallback />
        </div>
      )}
    </>
  );
}
