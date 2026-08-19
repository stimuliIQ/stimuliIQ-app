/**
 * CareersPageFallback — what /careers renders when the page-builder row cannot be fetched
 * (API down, page unpublished, row not builder-managed).
 *
 * IT LISTS NO ROLES, and that is the change ADR-0066 forced. This file used to carry three
 * hardcoded openings, preserved verbatim from the pre-Phase-10 page. Once openings became
 * real CRM rows, those three stopped being harmless placeholder markup and became FABRICATED
 * JOB ADVERTS: a fallback rendering "Senior Clinical Research Instructor — Hyderabad" while
 * the real list is empty invites real people to apply for a job that does not exist, and to
 * hand us a resume on the strength of it. A fallback may degrade; it may not lie.
 *
 * So the degraded state says what is actually true — we could not load the roles — and gives
 * the visitor a way to reach a human. The other page fallbacks keep their static copy because
 * static copy is what they legitimately are.
 */
import { SUPPORT_EMAIL } from "../../../lib/contact";

export function CareersPageFallback() {
  return (
    <>
      <header className="mb-12">
        <h1 className="text-3xl font-bold text-fg sm:text-4xl">
          Careers at <span className="text-chart-3">Stimuli IQ</span>
        </h1>
        <p className="mt-3 text-lg text-fg-muted">
          Help us build the future of medical training in India. We are a remote-friendly team.
        </p>
      </header>

      <div className="rounded-xl border border-border bg-card p-12 text-center" data-testid="careers-unavailable">
        <p className="text-lg font-medium text-fg">We could not load our open roles just now</p>
        <p className="mt-2 text-sm text-fg-muted">
          Please try again in a few minutes. If you would rather not wait, send your CV to{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-brand-500 underline hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {SUPPORT_EMAIL}
          </a>{" "}
          and tell us what you are looking for — a real person reads it.
        </p>
      </div>
    </>
  );
}
