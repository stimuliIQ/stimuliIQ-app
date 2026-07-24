"use client";

/**
 * CareersRoleList — client component managing which role's apply form is expanded
 * (T32). The role catalog itself stays server-rendered static data (no public
 * "list open roles" endpoint exists yet — only `client.public.careers.apply`).
 */

import { useState } from "react";
import { CareerApplyForm } from "./career-apply-form";

export interface CareerRole {
  id: string;
  title: string;
  type: string;
  location: string;
  description: string;
}

export function CareersRoleList({ roles }: { roles: CareerRole[] }) {
  const [openRoleId, setOpenRoleId] = useState<string | null>(null);

  return (
    <ul className="flex flex-col gap-4" role="list" data-testid="careers-list">
      {roles.map((role) => {
        const isOpen = openRoleId === role.id;
        return (
          <li key={role.id}>
            <article className="rounded-xl border border-border bg-card p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-fg">{role.title}</h2>
                  <p className="mt-1 text-sm text-fg-muted">
                    {role.type} · {role.location}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenRoleId(isOpen ? null : role.id)}
                  aria-expanded={isOpen}
                  aria-controls={`career-apply-panel-${role.id}`}
                  className="inline-flex min-h-[40px] shrink-0 items-center rounded-md border border-brand-500 px-4 text-sm font-medium text-brand-500 transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  data-testid={`career-apply-toggle-${role.id}`}
                >
                  {isOpen ? "Close" : "Apply"}
                </button>
              </div>
              <p className="mt-3 text-sm text-fg-muted leading-relaxed">{role.description}</p>

              {isOpen ? (
                <div id={`career-apply-panel-${role.id}`} className="mt-5">
                  <CareerApplyForm role={role.title} onClose={() => setOpenRoleId(null)} />
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
