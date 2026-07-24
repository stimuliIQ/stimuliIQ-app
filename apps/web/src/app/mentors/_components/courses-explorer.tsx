"use client";

/**
 * CoursesExplorer — "Explore Our All Courses" band for /mentors.
 *
 * Black & white take on the reference: category filter chips + course cards.
 * Programs come from the live public catalog (server-fetched by the page and
 * passed in — the same CRM-published courses that power /programs and the
 * mega-menu); filtering happens client-side on the already-loaded set.
 *
 * Card art: the CRM has no course artwork we can trust to exist, so each card
 * gets a generative monochrome panel — an oversized domain initial with the
 * domain name — which stays on-theme and never renders a broken image.
 *
 * a11y: chips are buttons with aria-pressed, result count announced via a
 * polite live region, whole card clickable via a stretched link.
 */
import { useMemo, useState } from "react";
import type { PublicProgramSummary } from "@repo/types";
import {
  formatPaiseDisplay,
  formatDuration,
  formatMode,
  humanizeDomain,
} from "../../../lib/format";

const MAX_VISIBLE = 6;

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
      className="h-4 w-4"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

function ScreenIcon() {
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
      className="h-4 w-4"
    >
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

/** Rotating grey tints for the art panels. */
const PANEL_TINTS = ["bg-surface", "bg-fg/[0.07]", "bg-brand-50"] as const;

function CourseCard({ program, index }: { program: PublicProgramSummary; index: number }) {
  const tint = PANEL_TINTS[index % PANEL_TINTS.length];
  const domainLabel = humanizeDomain(program.domain);

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-sm transition-shadow motion-safe:hover:shadow-md">
      {/* Generative monochrome art panel */}
      <div className={`relative flex h-44 items-center justify-center overflow-hidden ${tint}`}>
        <span
          aria-hidden="true"
          className="select-none font-display text-[7rem] font-bold leading-none text-fg/[0.08] transition-transform duration-base ease-out motion-safe:group-hover:scale-110"
        >
          {domainLabel.charAt(0)}
        </span>
        <span
          aria-hidden="true"
          className="absolute bottom-4 left-4 rounded-full bg-card px-3 py-1 text-xs font-semibold text-fg shadow-sm"
        >
          {domainLabel}
        </span>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            {program.level ? program.level : "All levels"}
          </span>
          <span className="text-lg font-bold text-fg">
            {formatPaiseDisplay(program.pricePaise)}
          </span>
        </div>

        <h3 className="mt-3 flex-1 text-lg font-bold leading-snug text-fg">
          <a
            href={`/programs/${program.slug}`}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:rounded after:absolute after:inset-0"
          >
            {program.title}
          </a>
        </h3>

        <div className="mt-5 flex items-center gap-5 border-t border-border pt-4 text-sm text-fg-muted">
          <span className="flex items-center gap-1.5">
            <ClockIcon />
            {formatDuration(program.durationWeeks) ?? "Self-paced"}
          </span>
          <span className="flex items-center gap-1.5">
            <ScreenIcon />
            {formatMode(program.mode)}
          </span>
        </div>
      </div>
    </article>
  );
}

export interface CoursesExplorerProps {
  programs: PublicProgramSummary[];
}

export function CoursesExplorer({ programs }: CoursesExplorerProps) {
  const [activeDomain, setActiveDomain] = useState<string | null>(null);

  const domains = useMemo(
    () => [...new Set(programs.map((p) => p.domain).filter(Boolean))],
    [programs],
  );

  const filtered = activeDomain
    ? programs.filter((p) => p.domain === activeDomain)
    : programs;
  const visible = filtered.slice(0, MAX_VISIBLE);

  if (programs.length === 0) return null;

  const chipBase =
    "inline-flex min-h-[44px] items-center rounded-full px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  return (
    <section
      aria-label="Explore our courses"
      data-testid="mentors-courses"
      className="border-t border-border py-16 lg:py-24"
    >
      <div className="mx-auto max-w-screen-xl px-4 md:px-6">
        <div className="mx-auto mb-10 max-w-xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
            Explore our <span className="text-chart-3">all courses</span>
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-fg-muted">
            Taught by the mentors you just met.
          </p>
        </div>

        {/* Category chips */}
        <div className="mb-10 flex flex-wrap items-center justify-center gap-3" role="group" aria-label="Filter courses by category">
          <button
            type="button"
            onClick={() => setActiveDomain(null)}
            aria-pressed={activeDomain === null}
            className={`${chipBase} ${
              activeDomain === null
                ? "bg-brand-500 text-white"
                : "border border-border bg-card text-fg hover:bg-surface"
            }`}
          >
            All Categories
          </button>
          {domains.map((domain) => (
            <button
              key={domain}
              type="button"
              onClick={() => setActiveDomain(domain)}
              aria-pressed={activeDomain === domain}
              className={`${chipBase} ${
                activeDomain === domain
                  ? "bg-brand-500 text-white"
                  : "border border-border bg-card text-fg hover:bg-surface"
              }`}
            >
              {humanizeDomain(domain)}
            </button>
          ))}
        </div>

        {/* Result count for screen readers */}
        <p className="sr-only" role="status">
          Showing {visible.length} of {filtered.length} courses
        </p>

        {/* Cards */}
        {visible.length === 0 ? (
          <p className="py-8 text-center text-fg-muted">
            No courses in this category yet — check back soon.
          </p>
        ) : (
          <ul role="list" className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((program, index) => (
              <li key={program.id}>
                <CourseCard program={program} index={index} />
              </li>
            ))}
          </ul>
        )}

        <div className="mt-12 text-center">
          <a
            href="/programs"
            className="inline-flex min-h-[48px] items-center justify-center rounded-full border border-fg px-8 text-sm font-semibold text-fg transition-colors hover:bg-brand-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            View all programs
          </a>
        </div>
      </div>
    </section>
  );
}
