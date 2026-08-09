/**
 * Homepage — /
 *
 * CODE-OWNED HOMEPAGE (opted out of the CMS page builder): this renders the
 * bespoke, hand-built homepage (`HomePageFallback` — hero, stats-bento world-map
 * band, why-us, explore-courses, how-it-works-steps,
 * testimonial-spotlight, partner-colleges, CTA) DIRECTLY. It intentionally does
 * NOT render the P10/P11 CMS page-builder blocks for `slug="home"`
 * (`stat-group-block` BentoVariant, etc.) — the homepage design is owned in these
 * React components, so edits to them go live immediately and are unaffected by the
 * CMS/API state.
 *
 * WHY (history): Phases 10/11 made the homepage a thin `ContentPage`-driven wrapper
 * (`PageBlocks`) so super_admins could edit it in the CRM. That is deliberately
 * reverted here for the homepage only — the current design is a code-owned redesign
 * (world-map stats band, new testimonial/how-it-works sections) that isn't expressible
 * in the locked-template block schema. The `slug="home"` ContentPage still exists (and
 * still feeds SEO via generateMetadata below); it just no longer drives the layout.
 * Other builder-managed pages (about/scholarship/etc.) are unchanged.
 *
 * `HomePageFallback` isn't CMS-driven, so it needs the live programs list
 * fetched and passed in directly (see HomePage() below).
 *
 * ISR: revalidate every 300s (5 min) so the live programs list refreshes
 * without a redeploy.
 */
import type { Metadata } from "next";

import { buildMetadata } from "../lib/seo/metadata";
import { resolveAssetUrl } from "../lib/media";
import { serverApiClient } from "../lib/api-client";
import { HomePageFallback } from "../components/page-builder/fallbacks/home-fallback";
import type { PublicProgramSummary, PublicPartner, PublicTestimonial } from "@repo/types";

const COLLEGE_PARTNER_CATEGORY = "college_partner";

export const revalidate = 300; // 5 min

const HOME_SLUG = "home";

const FALLBACK_METADATA = {
  title: "Healthcare training and internships for students in India",
  description:
    "Structured training and internship tracks in psychology, clinical practice, and allied healthcare. Healthcare mentors, real case work, and verifiable certificates.",
};

export async function generateMetadata(): Promise<Metadata> {
  try {
    const page = await serverApiClient.public.content.pages.getBySlug(HOME_SLUG);
    return buildMetadata({
      title: page.seoTitle ?? FALLBACK_METADATA.title,
      description: page.seoDescription ?? FALLBACK_METADATA.description,
      canonicalPath: "/",
      ogImage: resolveAssetUrl(page.seoImagePath) ?? undefined,
    });
  } catch {
    return buildMetadata({ ...FALLBACK_METADATA, canonicalPath: "/" });
  }
}

export default async function HomePage() {
  // The homepage renders the bespoke, code-owned redesign (HomePageFallback:
  // stats-bento world-map band, testimonial-spotlight, how-it-works-steps, etc.)
  // directly — it intentionally does NOT render the CMS page-builder blocks
  // (`slug="home"` ContentPage / stat-group-block BentoVariant). This opts the
  // homepage OUT of P10/P11 CMS-driven rendering: the homepage design is owned in
  // these components again, so edits to them appear live regardless of API state.
  // (generateMetadata() above still sources SEO title/description from the CMS
  // page when reachable.) HomePageFallback isn't CMS-driven, so it needs the live
  // programs list fetched directly here.
  let exploreCourses: PublicProgramSummary[] = [];
  // Live CRM-managed content — colleges (Partner rows, category=college_partner) and
  // testimonials. Both degrade to the hardcoded showcase inside HomePageFallback when empty
  // (clean DB / failed fetch), so the sections are never blank.
  let colleges: PublicPartner[] = [];
  let testimonials: PublicTestimonial[] = [];

  // Three independent reads — fetched CONCURRENTLY, not one after the other.
  // This page is ISR (revalidate = 300) and its regeneration runs inside a
  // function with a wall-clock timeout, so the render must not serialise API
  // latency: measured 2026-07-30 each of these takes ~2.4 s against the
  // production API, i.e. ~7 s sequentially versus ~2.4 s in parallel. A render
  // that overruns the timeout never commits, which leaves the whole page
  // serving its previous copy indefinitely.
  //
  // `allSettled`, not `all`: each section degrades to the hardcoded showcase on
  // its own, exactly as the three separate try/catch blocks did — one failing
  // read must never take the other two down with it.
  const [programsResult, collegesResult, testimonialsResult] = await Promise.allSettled([
    serverApiClient.public.programs.list({ limit: 12, sort: "order" }),
    serverApiClient.public.content.partners.list({ category: COLLEGE_PARTNER_CATEGORY }),
    serverApiClient.public.content.testimonials.list(),
  ]);

  if (programsResult.status === "fulfilled" && Array.isArray(programsResult.value.items)) {
    exploreCourses = programsResult.value.items;
  }
  if (collegesResult.status === "fulfilled" && Array.isArray(collegesResult.value)) {
    colleges = collegesResult.value;
  }
  if (testimonialsResult.status === "fulfilled" && Array.isArray(testimonialsResult.value)) {
    testimonials = testimonialsResult.value;
  }

  return (
    <HomePageFallback
      exploreCourses={exploreCourses}
      colleges={colleges}
      testimonials={testimonials}
    />
  );
}
