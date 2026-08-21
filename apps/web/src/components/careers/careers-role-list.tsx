/**
 * CareersRoleList — the open roles on /careers, grouped by department.
 *
 * GROUPED, NOT ONE FLAT LIST. A job board's first question is "is there anything in my
 * area?", and a department heading answers it before the visitor reads a single title. With
 * one department the grouping is invisible (a single section reads as a plain list), so this
 * costs nothing while the company is small and scales on its own as it is not.
 *
 * Each card LINKS to the role's own page rather than expanding in place. The advert is long
 * — description, responsibilities, requirements — and an accordion that pushes five other
 * roles off screen is a worse way to read it than a page with its own URL that can be
 * shared, bookmarked and linked from a LinkedIn post. The apply form lives on that page,
 * behind a button that opens a dialog.
 *
 * A server component: it renders resolved data and holds no state. Only the apply dialog on
 * the detail page needs the client.
 */

import Link from "next/link";
import { ArrowRightIcon, BriefcaseIcon, ClockIcon, MapPinIcon } from "./icons";
import type { PublicJobOpening } from "@repo/types";

/** Roles with no department fall into one trailing group rather than vanishing. */
const UNGROUPED = "Other roles";

const WORK_MODE_LABEL: Record<string, string> = {
  onsite: "On-site",
  hybrid: "Hybrid",
  remote: "Remote",
};

/**
 * Groups preserve the order the API returned (its `order` then newest-first), so a
 * department's position follows whichever of its roles staff ranked highest. Sorting the
 * groups alphabetically instead would quietly override the display order the CRM offers.
 */
function groupByDepartment(roles: PublicJobOpening[]): Array<{ department: string; roles: PublicJobOpening[] }> {
  const groups = new Map<string, PublicJobOpening[]>();
  for (const role of roles) {
    const key = role.department?.trim() || UNGROUPED;
    const existing = groups.get(key);
    if (existing) existing.push(role);
    else groups.set(key, [role]);
  }
  return [...groups.entries()].map(([department, list]) => ({ department, roles: list }));
}

/** Posted within the last 14 days — worth flagging, and short enough to stay true. */
function isRecent(postedAt: string): boolean {
  const posted = new Date(postedAt).getTime();
  if (Number.isNaN(posted)) return false;
  return Date.now() - posted < 14 * 24 * 60 * 60 * 1000;
}

function MetaItem({ icon: Icon, children }: { icon: typeof MapPinIcon; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
      <Icon className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

function RoleCard({ role }: { role: PublicJobOpening }) {
  return (
    <li>
      <Link
        href={`/careers/${role.slug}`}
        className="group flex h-full flex-col rounded-xl border border-border bg-card p-5 transition-all hover:border-brand-500/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        data-testid={`career-role-card-${role.slug}`}
      >
        {isRecent(role.postedAt) ? (
          <span className="mb-2 inline-flex w-fit items-center rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700">
            New
          </span>
        ) : null}

        <h3 className="text-base font-semibold text-fg group-hover:text-brand-600">{role.title}</h3>

        <p className="mt-2 line-clamp-3 flex-1 text-sm leading-relaxed text-fg-muted">{role.summary}</p>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3">
          <MetaItem icon={MapPinIcon}>{role.location}</MetaItem>
          <MetaItem icon={ClockIcon}>{role.employmentType}</MetaItem>
          {role.workMode ? (
            <MetaItem icon={BriefcaseIcon}>{WORK_MODE_LABEL[role.workMode] ?? role.workMode}</MetaItem>
          ) : null}
        </div>

        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-500">
          View role
          <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </li>
  );
}

export function CareersRoleList({ roles }: { roles: PublicJobOpening[] }) {
  const groups = groupByDepartment(roles);

  return (
    <div className="flex flex-col gap-12" data-testid="careers-list">
      {groups.map((group) => (
        <section key={group.department} aria-labelledby={`dept-${group.department.replace(/\s+/g, "-").toLowerCase()}`}>
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
            <h2
              id={`dept-${group.department.replace(/\s+/g, "-").toLowerCase()}`}
              className="text-xl font-bold text-fg"
            >
              {group.department}
            </h2>
            <p className="text-sm text-fg-muted">
              {group.roles.length} open {group.roles.length === 1 ? "position" : "positions"}
            </p>
          </div>

          <ul className="grid gap-4 sm:grid-cols-2" role="list">
            {group.roles.map((role) => (
              <RoleCard key={role.id} role={role} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

CareersRoleList.displayName = "CareersRoleList";
