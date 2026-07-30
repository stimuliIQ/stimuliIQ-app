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

function monogram(name: string): string {
  return name
    .replace(/[^A-Za-z ]/g, " ")
    .split(" ")
    .filter((word) => word.length > 1)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

function PartnersGrid({ data }: { data: Extract<ResolvedLiveCollectionRefBlockData, { collection: "partners" }> }) {
  // `resolveCollegeLogo` prefers the CRM upload and falls back to the logo bundled under
  // /public/colleges (see `lib/college-logos.ts`). Without it these cards render as
  // initials, because no live college row carries an uploaded logo — the same fix the
  // homepage grid gets in `partner-colleges.tsx`.
  if (data.layout === "logo-wall") {
    const logos = data.resolvedItems
      .map((p) => ({ name: p.name, src: resolveCollegeLogo(p.name, p.logoUrl) }))
      .filter((l): l is { name: string; src: string } => Boolean(l.src));
    if (logos.length === 0) return null;
    return <LogoWall logos={logos} />;
  }

  return (
    <ul role="list" className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${data.layout === "grid-4" ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
      {data.resolvedItems.map((p) => {
        const logo = resolveCollegeLogo(p.name, p.logoUrl);
        return (
        <li key={p.id} className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 transition-colors duration-[150ms] hover:border-chart-3">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface">
            {logo ? (
              <img src={logo} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain p-1" />
            ) : (
              <span className="text-xs font-bold tracking-tight text-fg-muted">{monogram(p.name)}</span>
            )}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-snug text-fg">{p.name}</h3>
            {p.focus ? <p className="mt-0.5 text-xs leading-snug text-chart-3">{p.focus}</p> : null}
            {p.established != null || p.city ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-fg-subtle">
                {p.established != null ? <span>Est. {p.established}</span> : null}
                {p.city ? <span>{p.city}</span> : null}
              </p>
            ) : null}
          </div>
        </li>
        );
      })}
    </ul>
  );
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

  return (
    <section aria-label={data.heading?.title ?? data.collection} data-testid={`page-builder-live-${data.collection}`} className="py-16 lg:py-20">
      <div className="mx-auto max-w-screen-xl px-4 md:px-6">
        <SectionHeading heading={data.heading} viewAllHref={data.viewAllHref} />
        {data.collection === "testimonials" ? <TestimonialsGrid data={data} /> : null}
        {data.collection === "partners" ? <PartnersGrid data={data} /> : null}
      </div>
    </section>
  );
}
