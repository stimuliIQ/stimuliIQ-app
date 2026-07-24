/**
 * Homepage — /
 *
 * CODE-OWNED HOMEPAGE (opted out of the CMS page builder): this renders the
 * bespoke, hand-built homepage (`HomePageFallback` — hero, stats-bento world-map
 * band, why-us, explore-courses, mentors-teaser, how-it-works-steps,
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
 * `HomePageFallback` isn't CMS-driven, so it needs the live programs/mentors lists
 * fetched and passed in directly (see HomePage() below).
 *
 * ISR: revalidate every 300s (5 min) so the live programs/mentors lists refresh
 * without a redeploy.
 */
import type { Metadata } from "next";

import { buildMetadata } from "../lib/seo/metadata";
import { resolveAssetUrl } from "../lib/media";
import { serverApiClient } from "../lib/api-client";
import { HomePageFallback } from "../components/page-builder/fallbacks/home-fallback";
import type { PublicProgramSummary, PublicMentorCard, PublicPartner, PublicTestimonial } from "@repo/types";

const COLLEGE_PARTNER_CATEGORY = "college_partner";

export const revalidate = 300; // 5 min

const HOME_SLUG = "home";

const FALLBACK_METADATA = {
  title: "StimuliiQ — Internship & Career Training for Students in India",
  description:
    "Project-based internship programs in Full Stack, Python, Data Science, Cloud, DevOps, and more. Industry mentors, hands-on projects, and verifiable certificates.",
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
  // programs/mentors lists fetched directly here.
  let exploreCourses: PublicProgramSummary[] = [];
  let mentors: PublicMentorCard[] = [];
  // Live CRM-managed content — colleges (Partner rows, category=college_partner) and
  // testimonials. Both degrade to the hardcoded showcase inside HomePageFallback when empty
  // (clean DB / failed fetch), so the sections are never blank.
  let colleges: PublicPartner[] = [];
  let testimonials: PublicTestimonial[] = [];

  try {
    const result = await serverApiClient.public.programs.list({ limit: 12, sort: "popularity" });
    exploreCourses = Array.isArray(result.items) ? result.items : [];
  } catch {
    exploreCourses = [];
  }

  try {
    const result = await serverApiClient.public.mentors.list({ limit: 8 });
    mentors = Array.isArray(result.items) ? result.items : [];
  } catch {
    mentors = [];
  }

  try {
    const result = await serverApiClient.public.content.partners.list({ category: COLLEGE_PARTNER_CATEGORY });
    colleges = Array.isArray(result) ? result : [];
  } catch {
    colleges = [];
  }

  try {
    const result = await serverApiClient.public.content.testimonials.list();
    testimonials = Array.isArray(result) ? result : [];
  } catch {
    testimonials = [];
  }

  return (
    <HomePageFallback
      exploreCourses={exploreCourses}
      mentors={mentors}
      colleges={colleges}
      testimonials={testimonials}
    />
  );
}
