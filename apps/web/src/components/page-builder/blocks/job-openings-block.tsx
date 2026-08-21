/**
 * JobOpeningsBlock — the Open Roles section of /careers (page-builder block #9).
 *
 * A REFERENCE block, like `live_collection_ref`: the heading and the empty-state line are
 * page-builder fields staff edit, but the roles themselves are resolved server-side from
 * the live `job_openings` table (CRM ▸ Careers ▸ Openings) into `data.resolvedItems`
 * (ADR-0066). Nothing about a role is stored in the page, so publishing, closing or
 * editing an advert takes effect without touching the page at all.
 *
 * The legacy `data.items` field is deliberately not read — see JobOpeningItemSchema in
 * @repo/types for why it still exists in the stored shape.
 */
import type { ResolvedJobOpeningsBlockData } from "@repo/types";
import { CareersRoleList } from "../../careers/careers-role-list";
import { SUPPORT_EMAIL } from "../../../lib/contact";

export function JobOpeningsBlock({ data }: { data: ResolvedJobOpeningsBlockData }): React.JSX.Element {
  // `?? []` even though PageBlocks already normalises this, and even though the type says
  // it cannot be undefined: this component is reachable from any caller, and the cost of
  // being wrong here is the whole careers page 500ing rather than one empty section.
  const roles = data.resolvedItems ?? [];

  return (
    <section
      aria-label={data.heading?.title ?? "Open roles"}
      data-testid="page-builder-job-openings"
      className="py-12 lg:py-16"
    >
      <div className="mx-auto max-w-5xl px-4 md:px-6">
        {data.heading ? (
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold text-fg md:text-4xl">{data.heading.title}</h2>
            {data.heading.subtitle ? (
              <p className="mx-auto mt-3 max-w-2xl text-lg text-fg-muted">{data.heading.subtitle}</p>
            ) : null}
          </div>
        ) : null}

        {roles.length > 0 ? (
          <CareersRoleList roles={roles} />
        ) : (
          // No open roles is a normal state, not an error — and it is worth giving a
          // visitor who arrived here something to do, since somebody browsing a careers
          // page with nothing on it is exactly the person worth hearing from.
          <div className="rounded-xl border border-border bg-card p-12 text-center" data-testid="careers-empty">
            <p className="text-lg font-medium text-fg">{data.emptyStateMessage}</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-fg-muted">
              Send your CV to{" "}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="font-medium text-brand-500 underline hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {SUPPORT_EMAIL}
              </a>{" "}
              — we are always glad to hear from good people, and we will get in touch when
              something fits.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
