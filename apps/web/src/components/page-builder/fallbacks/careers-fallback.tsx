/**
 * CareersPageFallback — the pre-Phase-10 hardcoded Careers page body, preserved verbatim
 * as the resilience fallback for `app/careers/page.tsx`
 * (docs/specs/phase-10-page-builder.md item B).
 */
import { CareersRoleList } from "../../careers/careers-role-list";

const OPEN_ROLES = [
  {
    id: "r1",
    title: "Senior Clinical Research Instructor",
    type: "Full-time",
    location: "Hyderabad / Remote",
    description: "Lead live and recorded clinical research training for cohorts of 20 to 30 students. 3+ years of hospital or industry research experience required.",
  },
  {
    id: "r2",
    title: "Career Counsellor",
    type: "Full-time",
    location: "Hyderabad / Remote",
    description: "Guide medical students through program selection and placement preparation. Strong communication skills and a healthcare or edtech background preferred.",
  },
  {
    id: "r3",
    title: "Full Stack Engineer (NestJS + Next.js)",
    type: "Full-time",
    location: "Hyderabad",
    description: "Build and maintain our LMS, CRM, and marketing platforms. 2+ years with TypeScript, Node.js, React, and PostgreSQL.",
  },
];

export function CareersPageFallback() {
  return (
    <>
      <header className="mb-12">
        <h1 className="text-3xl font-bold text-fg sm:text-4xl">
          Careers at <span className="text-chart-3">Stimuli IQ</span>
        </h1>
        <p className="mt-3 text-lg text-fg-muted">Help us build the future of medical training in India. We are a remote-friendly team.</p>
      </header>

      {OPEN_ROLES.length > 0 ? (
        <CareersRoleList roles={OPEN_ROLES} />
      ) : (
        <div className="rounded-xl border border-border bg-card p-12 text-center" data-testid="careers-empty">
          <p className="text-lg font-medium text-fg">No open roles right now</p>
          <p className="mt-2 text-sm text-fg-muted">Send your CV to hello@stimuliiq.com — we are always looking for great people.</p>
        </div>
      )}
    </>
  );
}
