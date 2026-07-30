/**
 * LiveCollectionRefBlock — page-builder block #10, "the reference block" (docs/specs/
 * phase-10-page-builder.md §"10. live_collection_ref"). NEVER copies data into the page —
 * `data.resolvedItems` was resolved server-side (API, published-filtered) at render time;
 * this component only renders what it's given.
 *
 * Edge case #2: if resolution drops to 0 items, the ENTIRE block (including its heading)
 * is hidden — same precedent as `MentorsTeaser`'s existing "hidden when empty" behavior —
 * rather than a heading over an empty grid.
 *
 * KNOWN LIMITATION (spec Edge case #11, AC 10 caveat): `partners` cannot reproduce
 * `partner-colleges.tsx`'s exact card content pixel-for-pixel via a plain `grid` layout
 * (that legacy component's `focus`/`established`/`city` fields ARE present on
 * `ResolvedPartnerItem` — added this phase specifically to back this block — so `grid-3`/
 * `grid-4` DOES reproduce the college-card content; only `layout=logo-wall` intentionally
 * reduces to name+logo+category, per the spec's documented visual-reduction option (a)).
 *
 * Phase-11 locked templates (docs/plans/phase-11-locked-templates.md, P5 — frontend-
 * builder): `collection: "programs"` and `collection: "mentors"` are routed to the richer,
 * pre-existing `ExploreCourses` (client category-tab filtering) / `MentorsTeaser` (arch
 * portrait grid) components instead of this file's own plain `ProgramsGrid`/`MentorsGrid`
 * — those two components are strictly visually richer than a generic grid and were
 * previously code-spliced into the homepage body by anchoring on surrounding block types
 * (a hack now removed, see `app/page.tsx`). Both components are presentational — fed via
 * `resolvedItems`/`heading`/`viewAllHref` props, no self-fetching — so routing them here,
 * from ANY page that carries a `programs`/`mentors` live-collection section, is a pure
 * rendering decision with no data-flow change. `testimonials`/`partners` keep this file's
 * own grid renderers below (already visually equivalent to their pre-migration hardcoded
 * counterparts per the doc comment above and `TestimonialCard`'s existing use elsewhere).
 * The former `ProgramsGrid`/`MentorsGrid` renderers are DELETED (not left as dead,
 * unreachable code) — `ExploreCourses`/`MentorsTeaser` fully supersede them for every
 * `collection: "programs"`/`"mentors"` section on every locked template.
 */
import { LogoWall, TestimonialCard } from "@repo/ui";
import type { ResolvedLiveCollectionRefBlockData } from "@repo/types";
import { safeHref } from "../../../lib/safe-href";
import { resolveCollegeLogo } from "../../../lib/college-logos";
import { HighlightText } from "../highlight-text";
import { ExploreCourses } from "../../home/explore-courses";
import { MentorsTeaser } from "../../home/mentors-teaser";
import { CollegeMarquee, type CollegeCardItem } from "../../home/college-marquee";

function SectionHeading({ heading, viewAllHref }: { heading: ResolvedLiveCollectionRefBlockData["heading"]; viewAllHref?: string }) {
  const href = safeHref(viewAllHref);
  if (!heading && !href) return null;
  return (
    <div className="mx-auto mb-10 flex max-w-2xl flex-col items-center text-center">
      {heading ? (
        <>
          <h2 className="font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
            <HighlightText text={heading.title} highlight={heading.titleHighlight} />
          </h2>
          {heading.subtitle ? <p className="mt-3 text-lg text-fg-muted">{heading.subtitle}</p> : null}
        </>
      ) : null}
      {href ? (
        <a href={href} className="mt-4 text-sm font-medium text-brand-500 hover:text-brand-600 focus-visible:outline-none focus-visible:underline">
          View all &rarr;
        </a>
      ) : null}
    </div>
  );
}

const GRID_CLASS: Record<string, string> = {
  "grid-3": "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3",
  "grid-4": "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4",
};

function TestimonialsGrid({ data }: { data: Extract<ResolvedLiveCollectionRefBlockData, { collection: "testimonials" }> }) {
  return (
    <ul role="list" className={GRID_CLASS[data.layout] ?? GRID_CLASS["grid-3"]}>
      {data.resolvedItems.map((t) => (
        <li key={t.id}>
          <TestimonialCard
            quote={t.quote}
            studentName={t.studentName}
            ratingStars={t.rating != null ? Math.round(t.rating / 10) : undefined}
            avatarSrc={t.studentPhotoUrl ?? undefined}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * Partners. `logo-wall` keeps its reduced name+logo treatment; every other layout now
 * renders the shared `CollegeMarquee` — two continuously-scrolling rows — instead of a
 * plain grid. `layout` (`grid-3`/`grid-4`) therefore no longer changes the column count
 * for partners; it is kept in the stored block data (and honoured by `logo-wall`) but the
 * college list has one canonical presentation across the site, shared with the
 * `partner-colleges.tsx` fallback so the two can't drift.
 *
 * `resolveCollegeLogo` prefers the CRM upload and falls back to the logo bundled under
 * /public/colleges (see `lib/college-logos.ts`). Without it these cards render as
 * initials, because no live college row carries an uploaded logo.
 */
function PartnersGrid({ data }: { data: Extract<ResolvedLiveCollectionRefBlockData, { collection: "partners" }> }) {
  if (data.layout === "logo-wall") {
    const logos = data.resolvedItems
      .map((p) => ({ name: p.name, src: resolveCollegeLogo(p.name, p.logoUrl) }))
      .filter((l): l is { name: string; src: string } => Boolean(l.src));
    if (logos.length === 0) return null;
    return <LogoWall logos={logos} />;
  }

  const colleges: CollegeCardItem[] = data.resolvedItems.map((p) => ({
    name: p.name,
    focus: p.focus ?? undefined,
    established: p.established != null ? String(p.established) : undefined,
    city: p.city ?? undefined,
    logo: resolveCollegeLogo(p.name, p.logoUrl),
  }));

  return <CollegeMarquee colleges={colleges} />;
}

export function LiveCollectionRefBlock({ data }: { data: ResolvedLiveCollectionRefBlockData }): React.JSX.Element | null {
  // Edge case #2: 0 resolved items hides the whole block, heading included.
  if (data.resolvedItems.length === 0) return null;

  // Richer, presentational components fully supersede this file's own grid for these two
  // collections (see file doc comment) — each renders its own section/heading/background.
  if (data.collection === "programs") {
    return <ExploreCourses programs={data.resolvedItems} heading={data.heading} viewAllHref={data.viewAllHref} />;
  }
  if (data.collection === "mentors") {
    return <MentorsTeaser mentors={data.resolvedItems} heading={data.heading} viewAllHref={data.viewAllHref} />;
  }

  // Partners (except `logo-wall`) render as a full-bleed marquee, so their body sits
  // OUTSIDE the content column while the heading stays inside it.
  const fullBleedBody = data.collection === "partners" && data.layout !== "logo-wall";

  return (
    <section aria-label={data.heading?.title ?? data.collection} data-testid={`page-builder-live-${data.collection}`} className="py-16 lg:py-20">
      <div className="mx-auto max-w-screen-xl px-4 md:px-6">
        <SectionHeading heading={data.heading} viewAllHref={data.viewAllHref} />
        {data.collection === "testimonials" ? <TestimonialsGrid data={data} /> : null}
        {data.collection === "partners" && !fullBleedBody ? <PartnersGrid data={data} /> : null}
      </div>
      {data.collection === "partners" && fullBleedBody ? <PartnersGrid data={data} /> : null}
    </section>
  );
}
