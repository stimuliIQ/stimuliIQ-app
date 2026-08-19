"use client";

/**
 * CareersRoleList — the open roles on /careers, and the apply panel each one expands into.
 *
 * The roles are LIVE CRM rows now (`model JobOpening`, CRM ▸ Careers ▸ Openings), resolved
 * server-side into the page's `job_openings` block; they used to be text typed into that
 * block. This component therefore renders a full advert — responsibilities, requirements,
 * compensation note, closing date — not the three-line teaser the hand-typed version could
 * carry, and the application it submits references the opening by id.
 *
 * ONE PANEL OPEN AT A TIME, and the panel is the form. A candidate reading three roles
 * should not be looking at three half-filled forms, and collapsing the others makes it
 * unambiguous which role the visible form applies to — a real risk when the only difference
 * between two forms on a page is a heading.
 *
 * Deep links: each role carries `id="<slug>"`, so /careers#senior-counsellor scrolls to the
 * role and opens its form. That link is what the CRM shows staff to share.
 */

import { useEffect, useState } from "react";
import type { PublicJobOpening } from "@repo/types";
import { CareerApplyForm } from "./career-apply-form";

const WORK_MODE_LABEL: Record<string, string> = {
  onsite: "On-site",
  hybrid: "Hybrid",
  remote: "Remote",
};

/** "31 Aug 2026" — the closing date a candidate is actually planning around. */
function formatClosingDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  // Constructed in UTC and formatted in UTC so an inclusive DATE never slips a day for a
  // reader west of Greenwich — the same rule `isJobOpeningLive` follows server-side.
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function MetaPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
      {children}
    </span>
  );
}

function BulletList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-fg-muted">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function CareersRoleList({ roles }: { roles: PublicJobOpening[] }) {
  const [openRoleId, setOpenRoleId] = useState<string | null>(null);

  // Honour a /careers#<slug> deep link: open that role's form and bring it into view. Runs
  // once on mount — a later hash change is a click on the page, which already sets state.
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    const match = roles.find((role) => role.slug === hash);
    if (!match) return;
    setOpenRoleId(match.id);
    // After paint, so the expanded panel is measured before we scroll to it.
    requestAnimationFrame(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [roles]);

  return (
    <ul className="flex flex-col gap-4" role="list" data-testid="careers-list">
      {roles.map((role) => {
        const isOpen = openRoleId === role.id;
        return (
          <li key={role.id} id={role.slug} className="scroll-mt-24">
            <article className="rounded-xl border border-border bg-card p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-fg">{role.title}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <MetaPill>{role.employmentType}</MetaPill>
                    <MetaPill>{role.location}</MetaPill>
                    {role.workMode ? <MetaPill>{WORK_MODE_LABEL[role.workMode] ?? role.workMode}</MetaPill> : null}
                    {role.department ? <MetaPill>{role.department}</MetaPill> : null}
                    {role.experienceLevel ? <MetaPill>{role.experienceLevel}</MetaPill> : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenRoleId(isOpen ? null : role.id)}
                  aria-expanded={isOpen}
                  aria-controls={`career-apply-panel-${role.id}`}
                  className="inline-flex min-h-[44px] shrink-0 items-center rounded-md bg-brand-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  data-testid={`career-apply-toggle-${role.slug}`}
                >
                  {isOpen ? "Close" : "Apply"}
                </button>
              </div>

              <p className="mt-4 text-sm leading-relaxed text-fg-muted">{role.summary}</p>

              {role.description ? (
                // Authored as plain text in the CRM; newlines are the author's paragraphs.
                <div className="mt-4 flex flex-col gap-3">
                  {role.description
                    .split(/\n\s*\n/)
                    .map((para) => para.trim())
                    .filter(Boolean)
                    .map((para) => (
                      <p key={para} className="text-sm leading-relaxed text-fg-muted">
                        {para}
                      </p>
                    ))}
                </div>
              ) : null}

              {role.responsibilities.length > 0 || role.requirements.length > 0 ? (
                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  <BulletList title="What you'll do" items={role.responsibilities} />
                  <BulletList title="What we're looking for" items={role.requirements} />
                </div>
              ) : null}

              {role.compensationNote || role.closesOn || role.openingsCount > 1 ? (
                <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-2 border-t border-border pt-4 text-sm">
                  {role.compensationNote ? (
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Compensation</dt>
                      <dd className="mt-0.5 text-fg">{role.compensationNote}</dd>
                    </div>
                  ) : null}
                  {role.openingsCount > 1 ? (
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Positions</dt>
                      <dd className="mt-0.5 text-fg">{role.openingsCount}</dd>
                    </div>
                  ) : null}
                  {role.closesOn ? (
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Applications close</dt>
                      <dd className="mt-0.5 text-fg">{formatClosingDate(role.closesOn)}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}

              {isOpen ? (
                <div id={`career-apply-panel-${role.id}`} className="mt-6">
                  <CareerApplyForm
                    jobOpeningId={role.id}
                    role={role.title}
                    onClose={() => setOpenRoleId(null)}
                  />
                </div>
              ) : null}
            </article>
          </li>
        );
      })}
    </ul>
  );
}

CareersRoleList.displayName = "CareersRoleList";
