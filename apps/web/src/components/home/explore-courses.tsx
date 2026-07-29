"use client";

/**
 * ExploreCourses — homepage "explore courses by category" section, placed after
 * StatsBento. Modelled on a category-tabbed course showcase: a heading with one
 * emerald-highlighted word, a row of category filter tabs, and a grid of course
 * cards, on a white background.
 *
 * DESIGN SYSTEM (docs/07): the site brand is emerald green — used for the
 * highlighted heading word, the selected tab, and badges. Each card closes with
 * a clean secondary CTA ("Explore Program"): a green-outlined button that fills
 * solid green on card hover, plus price + rating. Colour is never the sole
 * carrier of meaning (every tab/badge/CTA also has a text label).
 *
 * This is the homepage's single programs showcase — it absorbed the old
 * separate "Explore Our Programs" section (green heading from one, price +
 * button cards from the other).
 *
 * Data: real programs from the public catalog (passed in from the server page).
 * Category tabs filter the list by `domain` on the client — "Featured" shows all.
 *
 * a11y: filter buttons are a labelled group with `aria-pressed`; each card is a
 * single "stretched link" (the whole card is one clickable target, no nested
 * links); images are decorative (empty alt) since the title conveys the name.
 *
 * Phase-11 locked templates (docs/plans/phase-11-locked-templates.md, P5 — frontend-
 * builder): this is now also the direct renderer for the `live_collection_ref`
 * (`collection: "programs"`) page-builder block (see `../page-builder/blocks/
 * live-collection-ref-block.tsx`), routed there instead of that block's plain grid so the
 * category-tab interactivity is preserved with no visual regression. `heading`/
 * `viewAllHref` are therefore optional, CMS-editable overrides of the section copy —
 * defaulting to the original hardcoded copy so every existing caller (incl. the homepage
 * fallback) renders byte-identical.
 */

import * as React from "react";
import Image from "next/image";
import type { PublicProgramSummary, HeadingSimple } from "@repo/types";

import { formatDuration, formatMode, formatPaiseDisplay, formatRating } from "../../lib/format";
import { HighlightText } from "../page-builder/highlight-text";
import { safeHref } from "../../lib/safe-href";

const FEATURED = "Featured";

/** Title-case a raw domain facet for display ("data-science" → "Data Science"). */
function prettifyDomain(domain: string): string {
  return domain
    .split(/[-_\s]+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Course card
// ---------------------------------------------------------------------------

function BookIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-10 w-10"
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

function CourseCard({
  program,
  showScholarshipBadge,
}: {
  program: PublicProgramSummary;
  showScholarshipBadge: boolean;
}) {
  const rating = program.ratingAvg != null ? formatRating(program.ratingAvg) : null;
  const meta = [
    program.durationWeeks ? formatDuration(program.durationWeeks) : null,
    formatMode(program.mode),
    program.level ?? "All levels",
  ].filter(Boolean);

  return (
    <li className="h-full">
      <article className="group relative flex h-full flex-col rounded-3xl border border-border bg-card p-2.5 shadow-sm transition duration-slow ease-out hover:-translate-y-1 hover:border-chart-3/40 hover:shadow-lg">
        {/* Image / fallback — inset with a padded frame + rounded corners, echoing
            the mentor arches. Shorter aspect ratio keeps the image compact. */}
        <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-surface">
          {program.ogImageUrl ? (
            <Image
              src={program.ogImageUrl}
              alt=""
              fill
              sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
              className="object-cover transition-transform duration-slow ease-out group-hover:scale-105"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex size-full items-center justify-center bg-gradient-to-br from-chart-3/15 to-chart-3/5 text-chart-3"
            >
              <BookIcon />
            </div>
          )}

          {showScholarshipBadge && program.scholarshipAvailable ? (
            <span className="absolute left-2.5 top-2.5 rounded-full bg-chart-3 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm">
              Scholarship
            </span>
          ) : null}

          <span className="absolute bottom-2.5 left-2.5 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-fg backdrop-blur-sm">
            {prettifyDomain(program.domain)}
          </span>
        </div>

        {/* Body — tight, compact copy */}
        <div className="flex flex-1 flex-col gap-1 px-2 pb-1.5 pt-3">
          <h4 className="font-display text-[15px] font-bold leading-snug text-fg">
            {/* Stretched link — whole card is one clickable target */}
            <a
              href={`/programs/${program.slug}`}
              className="line-clamp-1 after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {program.title}
            </a>
          </h4>

          {program.cardSummary ? (
            <p className="line-clamp-2 text-[13px] leading-relaxed text-fg-muted">{program.cardSummary}</p>
          ) : null}

          {/* Meta — one compact line */}
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fg-subtle">
            <ClockIcon />
            <span className="truncate">{meta.join(" · ")}</span>
          </div>

          {/* Footer: price + rating, then a compact secondary CTA. The pill is a
              styled span — the card's stretched link is the real (and only)
              interactive target, so there are no nested links. */}
          <div className="mt-auto flex items-center justify-between gap-3 border-t border-border/60 pt-2.5">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[15px] font-bold text-fg">{formatPaiseDisplay(program.pricePaise)}</span>
              {rating ? (
                <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-fg-muted">
                  <span aria-hidden="true" className="text-warning">
                    ★
                  </span>
                  {rating}
                </span>
              ) : null}
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-brand-500 px-3 py-1.5 text-[11px] font-semibold text-brand-500 transition-colors duration-fast group-hover:bg-brand-500 group-hover:text-white">
              Explore
              <span aria-hidden="true" className="transition-transform duration-fast group-hover:translate-x-0.5">
                →
              </span>
            </span>
          </div>
        </div>
      </article>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

const DEFAULT_HEADING: HeadingSimple = {
  title: "Explore our medical internship programs",
  titleHighlight: "medical internship",
  subtitle: "Pick a track and start building the clinical and research skills hospitals actually look for.",
};
const DEFAULT_VIEW_ALL_HREF = "/programs";

export interface ExploreCoursesProps {
  programs: PublicProgramSummary[];
  /** CMS-editable override (`live_collection_ref.heading`) — defaults to the original hardcoded copy. */
  heading?: HeadingSimple;
  /** CMS-editable override (`live_collection_ref.viewAllHref`) — defaults to `/programs`. */
  viewAllHref?: string;
  /**
   * Show the green "Scholarship" corner pill on cards whose program has
   * `scholarshipAvailable`. Defaults to `true` so the `live_collection_ref` block and
   * any other caller keep their existing look; the HOMEPAGE passes `false` — the badge
   * was crowding the card art there, and /programs, /programs/city/[citySlug] and the
   * program detail page all still surface scholarship availability with their own
   * "Scholarship available" badge.
   */
  showScholarshipBadge?: boolean;
}

export function ExploreCourses({
  programs,
  heading = DEFAULT_HEADING,
  viewAllHref = DEFAULT_VIEW_ALL_HREF,
  showScholarshipBadge = true,
}: ExploreCoursesProps) {
  const resolvedViewAllHref = safeHref(viewAllHref) ?? DEFAULT_VIEW_ALL_HREF;
  const categories = React.useMemo(() => {
    const domains = Array.from(new Set(programs.map((p) => p.domain)));
    return [FEATURED, ...domains];
  }, [programs]);

  const [selected, setSelected] = React.useState<string>(FEATURED);

  const filtered = React.useMemo(
    () => (selected === FEATURED ? programs : programs.filter((p) => p.domain === selected)),
    [programs, selected],
  );

  // Nothing to show if the catalog is empty — hide the section entirely.
  if (programs.length === 0) return null;

  const selectedLabel = selected === FEATURED ? FEATURED : prettifyDomain(selected);

  return (
    <section aria-label="Explore courses" data-testid="explore-courses" className="bg-card py-16 lg:py-20">
      <div className="mx-auto max-w-screen-xl px-4 md:px-6">
        {/* Heading */}
        <div className="mx-auto mb-8 max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fg-muted">Courses</p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
            <HighlightText text={heading.title} highlight={heading.titleHighlight} />
          </h2>
          {heading.subtitle ? <p className="mt-3 text-base text-fg-muted md:text-lg">{heading.subtitle}</p> : null}
        </div>

        {/* Category filter tabs */}
        <div
          role="group"
          aria-label="Filter courses by category"
          className="mb-10 flex flex-wrap justify-center gap-2"
        >
          {categories.map((cat) => {
            const active = cat === selected;
            const label = cat === FEATURED ? FEATURED : prettifyDomain(cat);
            return (
              <button
                key={cat}
                type="button"
                aria-pressed={active}
                onClick={() => setSelected(cat)}
                className={
                  "min-h-[40px] rounded-full px-4 text-sm font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
                  (active
                    ? "bg-chart-3 text-white"
                    : "border border-border text-fg-muted hover:border-fg/30 hover:text-fg")
                }
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Selected-category subheading + view-all */}
        <div className="mb-6 flex items-center justify-between gap-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-fg" aria-live="polite">
            {selectedLabel} courses
          </h3>
          <a
            href={resolvedViewAllHref}
            className="shrink-0 text-sm font-semibold text-chart-3 hover:underline focus-visible:outline-none focus-visible:underline"
          >
            View all courses →
          </a>
        </div>

        {/* Cards */}
        {filtered.length === 0 ? (
          <p role="status" className="py-10 text-center text-sm text-fg-muted">
            No courses in this category yet — check back soon.
          </p>
        ) : (
          <ul role="list" className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((program) => (
              <CourseCard
                key={program.id}
                program={program}
                showScholarshipBadge={showScholarshipBadge}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
