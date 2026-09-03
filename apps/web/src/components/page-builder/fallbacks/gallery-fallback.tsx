/**
 * GalleryPageFallback — what /gallery renders when the page-builder row cannot be fetched
 * (API down, page unpublished, row not builder-managed).
 *
 * IT SHOWS NO PHOTOGRAPHS, and both halves of that are deliberate.
 *
 * This file used to carry six hardcoded entries — "Certificate Ceremony, Clinical Research
 * Cohort 8", "Hospital Partner Connect 2026", and four more — each rendered as a grey box
 * containing the literal string "[Image: Students attending a live clinical skills training
 * session]". So the degraded state was doubly wrong: it invented events that may never have
 * happened, and it shipped placeholder markup to a visitor's screen as if it were content.
 *
 * The same reasoning `careers-fallback.tsx` records ("a fallback may degrade; it may not
 * lie") and `home-fallback.tsx` applies to testimonials. Real photographs are managed in
 * CRM ▸ Content ▸ Pages on the gallery page's own image blocks, where somebody has actually
 * seen them.
 */
// CONTACT_EMAIL, not SUPPORT_EMAIL: this is an outage message asking a visitor to write
// in, so it has to be the mailbox the team actually reads (contact.ts says the
// @stimuliiq.com address depends on domain mail delivery being configured).
import { CONTACT_EMAIL } from "../../../lib/contact";

export function GalleryPageFallback() {
  return (
    <>
      <header className="mb-12">
        <h1 className="text-3xl font-bold text-fg sm:text-4xl">Gallery</h1>
        <p className="mt-3 text-lg text-fg-muted">
          A glimpse into Stimuli IQ training sessions, events, and student milestones.
        </p>
      </header>

      <div
        className="rounded-xl border border-dashed border-border bg-card p-8 text-center"
        data-testid="gallery-unavailable"
      >
        <p className="text-base font-medium text-fg">We couldn&apos;t load the gallery just now.</p>
        <p className="mx-auto mt-2 max-w-prose text-sm text-fg-muted">
          This is a temporary problem on our side, not a change to the page. Please try again in a
          few minutes.
        </p>
        <p className="mt-4 text-sm text-fg-muted">
          If it keeps happening, tell us at{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-medium text-brand-500 underline hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </div>
    </>
  );
}
