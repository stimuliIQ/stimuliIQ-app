/**
 * JobOpeningsBlock — page-builder block #9 (docs/specs/phase-10-page-builder.md
 * §"9. job_openings"). Reuses `CareersRoleList` as-is (spec: "already handles the
 * populated + empty states").
 */
import type { JobOpeningsBlockData } from "@repo/types";
import { CareersRoleList } from "../../careers/careers-role-list";

export function JobOpeningsBlock({ data }: { data: JobOpeningsBlockData }): React.JSX.Element {
  const roles = data.items.map((item, i) => ({
    id: `role-${i}`,
    title: item.title,
    type: item.employmentType,
    location: item.location,
    description: item.description,
  }));

  return (
    <section aria-label={data.heading?.title ?? "Open roles"} data-testid="page-builder-job-openings" className="py-12 lg:py-16">
      <div className="mx-auto max-w-4xl px-4 md:px-6">
        {data.heading ? (
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-fg md:text-4xl">{data.heading.title}</h2>
            {data.heading.subtitle ? <p className="mt-3 text-lg text-fg-muted">{data.heading.subtitle}</p> : null}
          </div>
        ) : null}

        {roles.length > 0 ? (
          <CareersRoleList roles={roles} />
        ) : (
          <div className="rounded-xl border border-border bg-card p-12 text-center" data-testid="careers-empty">
            <p className="text-lg font-medium text-fg">{data.emptyStateMessage}</p>
            <p className="mt-2 text-sm text-fg-muted">Send your CV to hello@stimuliiq.com — we are always looking for great people.</p>
          </div>
        )}
      </div>
    </section>
  );
}
