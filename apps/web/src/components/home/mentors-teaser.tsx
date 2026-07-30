/**
 * MentorsTeaser — homepage "Meet Your Mentors" section. Server component:
 * mentors are fetched on the home page (ISR) and passed in, so they're in the
 * server HTML for SEO.
 *
 * Visual: a row of tall "arch" portraits (rounded-t-full/rounded-b-3xl), each
 * inset inside a soft pastel-tinted frame that cycles through the design
 * system's existing colour-blind-safe chart tokens — no new palette, just
 * those tokens at a light tint, echoing the reference's multicolour arches
 * without introducing new colours. No card border/shadow — deliberately
 * minimal: photo + name + role floating on the section background.
 *
 * Data: bound to the CRM via GET /public/mentors (active mentors only, safe
 * projection — same source as the /mentors page). Each item shows the
 * CRM-uploaded photo (monogram fallback), name, and title/role. The whole
 * section renders nothing when there are no mentors (no empty placeholder on
 * the homepage).
 *
 * a11y: list semantics, real values always in the DOM, ≥44px "View All"
 * control, focus-visible ring.
 *
 * Phase-11 locked templates (docs/plans/phase-11-locked-templates.md, P5 — frontend-
 * builder): also the direct renderer for the `live_collection_ref` (`collection:
 * "mentors"`) page-builder block (see `../page-builder/blocks/live-collection-ref-block.
 * tsx`), routed there instead of that block's plain grid to preserve the arch-portrait
 * visual with no regression. `heading`/`viewAllHref` are optional CMS-editable overrides,
 * defaulting to the original hardcoded copy.
 */
import Link from "next/link";
import type { PublicMentorCard, HeadingSimple } from "@repo/types";
import { HighlightText } from "../page-builder/highlight-text";
import { safeHref } from "../../lib/safe-href";

/** Rotating pastel tints for the arch frames — existing chart tokens, no new palette. */
const ARCH_TINTS = ["bg-chart-2/15", "bg-chart-5/15", "bg-chart-3/15", "bg-chart-1/15", "bg-brand-100", "bg-chart-4/15"] as const;

function initialsOf(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter((part) => /^[a-z]/i.test(part))
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function MentorCard({ mentor, index }: { mentor: PublicMentorCard; index: number }) {
  const tint = ARCH_TINTS[index % ARCH_TINTS.length];
  const role = mentor.title ?? mentor.expertise[0] ?? "Industry Mentor";

  return (
    <li className="w-40 sm:w-44 lg:w-48">
      <Link
        href={`/mentors/${mentor.id}`}
        className="group flex flex-col items-center rounded-3xl text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
        aria-label={`View ${mentor.fullName}'s profile`}
      >
        {/* Arch frame — pastel tint, photo inset with a visible colour margin */}
        <div className={`aspect-[3/4] w-full overflow-hidden rounded-t-full rounded-b-3xl p-2.5 transition-transform duration-slow ease-out group-hover:-translate-y-1 ${tint}`}>
          <div className="size-full overflow-hidden rounded-t-full rounded-b-2xl bg-surface">
            {mentor.photoUrl ? (
              // plain <img>: remote CDN host, avoids next/image remotePatterns config.
              <img src={mentor.photoUrl} alt={mentor.fullName} className="size-full object-cover" />
            ) : (
              <div aria-hidden="true" className="flex size-full items-center justify-center">
                <span className="font-display text-2xl font-bold text-fg-muted">
                  {initialsOf(mentor.fullName) || "M"}
                </span>
              </div>
            )}
          </div>
        </div>

        <h3 className="mt-4 text-sm font-bold text-fg group-focus-visible:underline">{mentor.fullName}</h3>
        <p className="mt-0.5 text-xs text-fg-muted">{role}</p>
      </Link>
    </li>
  );
}

const DEFAULT_HEADING: HeadingSimple = {
  title: "Meet Your Mentors",
  titleHighlight: "Mentors",
  subtitle:
    "Practising doctors, researchers, and healthcare specialists who review your work, answer your questions, and tell you honestly what to improve.",
};
const DEFAULT_VIEW_ALL_HREF = "/mentors";

export interface MentorsTeaserProps {
  mentors: PublicMentorCard[];
  /** CMS-editable override (`live_collection_ref.heading`) — defaults to the original hardcoded copy. */
  heading?: HeadingSimple;
  /** CMS-editable override (`live_collection_ref.viewAllHref`) — defaults to `/mentors`. */
  viewAllHref?: string;
}

export function MentorsTeaser({ mentors, heading = DEFAULT_HEADING, viewAllHref = DEFAULT_VIEW_ALL_HREF }: MentorsTeaserProps) {
  if (mentors.length === 0) return null;
  const resolvedViewAllHref = safeHref(viewAllHref) ?? DEFAULT_VIEW_ALL_HREF;

  return (
    <section aria-label="Our mentors" data-testid="mentors-teaser" className="section-band py-16 lg:py-20">
      <div className="mx-auto max-w-screen-xl px-4 md:px-6">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
            <HighlightText text={heading.title} highlight={heading.titleHighlight} />
          </h2>
          {heading.subtitle ? <p className="mt-3 text-lg text-fg-muted">{heading.subtitle}</p> : null}
        </div>

        {/* flex-wrap + justify-center: cards stay centered for any mentor count
            (a fixed grid left-aligns an underfilled row on wide screens). */}
        <ul role="list" className="flex flex-wrap justify-center gap-4 md:gap-6">
          {mentors.map((mentor, index) => (
            <MentorCard key={mentor.id} mentor={mentor} index={index} />
          ))}
        </ul>

        <div className="mt-12 text-center">
          <a
            href={resolvedViewAllHref}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-brand-500 px-8 text-sm font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid="mentors-teaser-view-all"
          >
            View All Mentors
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
              <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}
