/**
 * UpcomingWorkshop — the site-wide promo for the next live workshop, in two sizes.
 *
 *   <UpcomingWorkshopBand />   a full homepage section. Used once per page, high up.
 *   <UpcomingWorkshopStrip />  one-line banner that drops into a page that already has
 *                              its own header (programs listing, city pages).
 *
 * DESIGN: this deliberately uses the marketing site's OWN section format rather than a
 * bespoke treatment — `.section-band` tint, the centered `text-3xl md:text-4xl` heading
 * with a single `text-chart-3` word (via HighlightText, the same helper the CMS pages
 * use), and one white `rounded-3xl` card with the hover lift + `ring-chart-3/30` idiom
 * from HowItWorksSteps. The only bespoke element is the emerald accent rail down the
 * card's left edge — an echo of the vertical step pill in that same band, which is what
 * marks this section as the promo without importing a second visual language.
 *
 * An earlier revision was an inverted near-black band with an aurora wash, an ECG sweep
 * and a floating motif. It read as a foreign element bolted onto a light, minimal site.
 * Keep this section in the light palette; highlight it with the accent rail and the
 * "Registrations open" chip, not with a different background.
 *
 * Both variants read `UPCOMING_WORKSHOP` (lib/workshop.ts) and render NOTHING when it is
 * disabled. Detail values (date/time/mode/seats) render only when set — the layout is
 * composed to read as finished with none of them, because an unconfirmed date must never
 * be filled in with a plausible-looking one. They render as a plain `·`-joined meta line
 * rather than pills, matching the copy density of the surrounding sections.
 *
 * Server Components — presentational only, no client JS.
 *
 * a11y: the section's <h2> is the "Upcoming Workshop" label and the card's <h3> is the
 * subject, so the hierarchy reads correctly in a heading list. The pulsing dot is
 * decorative and the global `prefers-reduced-motion` rule neutralises it. The strip is a
 * single link with one accessible name and a ≥44px target.
 */
import { HighlightText } from "../page-builder/highlight-text";
import { UPCOMING_WORKSHOP, workshopDetailLine, type UpcomingWorkshop } from "../../lib/workshop";

/** Pulsing "live" dot — a solid core under an expanding halo. */
function LiveDot() {
  return (
    <span aria-hidden="true" className="relative flex h-1.5 w-1.5 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
    </span>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

/** The "Registrations open" status chip — the section's one spot of accent colour. */
function StatusChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-chart-3/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-chart-3">
      <LiveDot />
      {label}
    </span>
  );
}

/** Full homepage section: standard band + heading, one card. */
export function UpcomingWorkshopBand({
  workshop = UPCOMING_WORKSHOP,
}: {
  workshop?: UpcomingWorkshop;
}): React.JSX.Element | null {
  if (!workshop.enabled) return null;
  const detailLine = workshopDetailLine(workshop);

  return (
    <section
      aria-labelledby="upcoming-workshop-heading"
      data-testid="upcoming-workshop-band"
      className="section-band py-16 lg:py-20"
    >
      <div className="mx-auto max-w-screen-xl px-4 md:px-6">
        {/* Section heading — identical format to every other homepage section. */}
        <div className="mb-10 text-center">
          <h2 id="upcoming-workshop-heading" className="text-3xl font-bold text-fg md:text-4xl">
            <HighlightText text={workshop.eyebrow} highlight={workshop.eyebrowHighlight} />
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-lg text-fg-muted">{workshop.summary}</p>
        </div>

        <article className="group relative mx-auto max-w-3xl overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-sm ring-1 ring-transparent transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-1.5 hover:shadow-xl hover:ring-chart-3/30 focus-within:-translate-y-1.5 focus-within:shadow-xl focus-within:ring-chart-3/30 sm:p-8 sm:pl-12">
          {/* Accent rail — the promo's marker. Echoes the vertical step pill in the
              How-It-Works band, so it reads as this site's language, not a new one. */}
          <span
            aria-hidden="true"
            className="absolute inset-y-2.5 left-2.5 hidden w-1.5 rounded-full bg-chart-3 sm:block"
          />

          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between md:gap-10">
            <div className="min-w-0">
              <StatusChip label={workshop.statusLabel} />

              <h3 className="mt-4 font-display text-2xl font-bold leading-heading text-fg md:text-3xl">
                {workshop.title}
              </h3>

              {detailLine ? <p className="mt-2 text-sm text-fg-muted">{detailLine}</p> : null}
            </div>

            <a
              href={workshop.ctaHref}
              className="group/cta inline-flex min-h-[44px] shrink-0 items-center gap-4 self-start rounded-full bg-brand-500 py-2 pl-8 pr-2 text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:self-auto"
            >
              {workshop.ctaLabel}
              <span
                aria-hidden="true"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-fg transition-transform duration-fast group-hover/cta:translate-x-0.5"
              >
                <ArrowRightIcon />
              </span>
            </a>
          </div>
        </article>
      </div>
    </section>
  );
}

/**
 * One-line banner for pages that already have their own hero. The whole strip is one
 * link, so there is exactly one tab stop and one accessible name.
 */
export function UpcomingWorkshopStrip({
  workshop = UPCOMING_WORKSHOP,
  className = "",
}: {
  workshop?: UpcomingWorkshop;
  className?: string;
}): React.JSX.Element | null {
  if (!workshop.enabled) return null;
  const detailLine = workshopDetailLine(workshop);

  return (
    <a
      href={workshop.ctaHref}
      data-testid="upcoming-workshop-strip"
      className={`group relative flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-1 overflow-hidden rounded-2xl border border-border bg-card py-3 pl-6 pr-4 text-sm shadow-sm transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${className}`}
    >
      {/* Same accent rail as the band, at strip scale. */}
      <span aria-hidden="true" className="absolute inset-y-2 left-2 w-1.5 rounded-full bg-chart-3" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-chart-3">
        {workshop.eyebrow}
      </span>
      <span className="font-semibold text-fg">{workshop.title}</span>
      {detailLine ? <span className="text-fg-muted">{detailLine}</span> : null}
      <span className="ml-auto inline-flex items-center gap-1 font-semibold text-brand-500">
        {workshop.ctaLabel}
        <span
          aria-hidden="true"
          className="transition-transform duration-fast group-hover:translate-x-0.5"
        >
          →
        </span>
      </span>
    </a>
  );
}
