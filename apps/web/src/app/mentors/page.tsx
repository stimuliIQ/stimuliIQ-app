/**
 * /mentors — public mentors directory (black & white redesign).
 *
 * Sections (per the reference designs):
 *   1. Hero — breadcrumbs + oversized two-line heading + decorative dot grid
 *   2. Mentors grid — bound to the CRM via GET /public/mentors (active mentors
 *      only, safe projection). First page server-rendered for SEO; "View More
 *      Mentors" pages through the cursor client-side.
 *   3. "Happy students say about our courses" — quote cards + photo card with
 *      dot pagination.
 *   4. "Explore our all courses" — live catalog with category filter chips.
 *
 * ISR: revalidates hourly (mentor/course changes in the CRM appear within the
 * hour). SEO: metadata + Breadcrumb JSON-LD.
 */
import type { Metadata } from "next";
import { buildMetadata, SITE_URL } from "../../lib/seo/metadata";
import { buildBreadcrumbJsonLd } from "../../lib/seo/json-ld";
import { serverApiClient } from "../../lib/api-client";
import type { PublicMentorCard, PublicProgramSummary } from "@repo/types";
import { MentorsGrid } from "./_components/mentors-grid";
import { StudentsSay } from "./_components/students-say";
import { CoursesExplorer } from "./_components/courses-explorer";

export const revalidate = 3600; // ISR: CRM changes surface within the hour

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export const metadata: Metadata = buildMetadata({
  title: "Mentors who work in healthcare",
  description:
    "Meet Stimuli IQ's mentors: active engineers and specialists from top companies like Google, Microsoft, and Amazon who review your projects and guide your career.",
  canonicalPath: "/mentors",
});

const BREADCRUMBS = [{ label: "Home", href: "/" }, { label: "Mentors" }];

// ---------------------------------------------------------------------------
// Decorative dot grid (hero ornament, per the reference)
// ---------------------------------------------------------------------------

function DotGrid() {
  const dots: React.ReactNode[] = [];
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      dots.push(
        <circle key={`${row}-${col}`} cx={6 + col * 22} cy={6 + row * 22} r="2.5" />,
      );
    }
  }
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 122 78"
      className="h-16 w-auto fill-fg/20"
    >
      {dots}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function MentorsPage() {
  // First mentor page + course catalog — server-fetched (SEO + no client waterfall)
  let mentors: PublicMentorCard[] = [];
  let mentorsCursor: string | null = null;
  let programs: PublicProgramSummary[] = [];

  // Two independent reads — issued CONCURRENTLY so the render costs one API
  // round trip rather than two (same rationale as app/page.tsx). `allSettled`
  // keeps the per-section degradation the two try/catch blocks provided: an
  // empty mentor list must not also blank the course strip.
  const [mentorsResult, programsResult] = await Promise.allSettled([
    serverApiClient.public.mentors.list({ limit: 8 }),
    serverApiClient.public.programs.list({ limit: 50, sort: "order" }),
  ]);

  if (mentorsResult.status === "fulfilled" && Array.isArray(mentorsResult.value.items)) {
    mentors = mentorsResult.value.items;
    mentorsCursor = mentorsResult.value.meta?.nextCursor ?? null;
  }
  if (programsResult.status === "fulfilled" && Array.isArray(programsResult.value.items)) {
    programs = programsResult.value.items;
  }

  const breadcrumbJsonLd = buildBreadcrumbJsonLd(BREADCRUMBS, SITE_URL);

  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped JSON-LD
        dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd }}
      />

      {/* 1. Hero */}
      <section aria-label="Our mentors" className="mx-auto max-w-screen-xl px-4 pt-10 md:px-6">
        <div className="flex items-end justify-between gap-8 pb-12 lg:pb-16">
          <h1 className="max-w-3xl font-display text-4xl font-bold leading-[1.08] tracking-tight text-fg sm:text-5xl lg:text-6xl">
            Meet our industry&apos;s
            <br />
            leading <span className="text-chart-3">expert mentors</span>
          </h1>
          <div className="hidden shrink-0 pb-2 md:block">
            <DotGrid />
          </div>
        </div>
      </section>

      {/* 2. Mentors grid — CRM-bound */}
      <div className="mx-auto max-w-screen-xl px-4 pb-16 md:px-6 lg:pb-24">
        <MentorsGrid initialItems={mentors} initialCursor={mentorsCursor} />
      </div>

      {/* 3. Student testimonials */}
      <StudentsSay />

      {/* 4. Courses explorer — live catalog */}
      <CoursesExplorer programs={programs} />
    </>
  );
}
