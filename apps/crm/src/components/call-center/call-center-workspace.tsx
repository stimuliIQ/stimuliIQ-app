// Call Center — one screen for phone-support staff: type whatever the caller
// gives you (name / phone / email) and open their full record in one click.
// Students open the Student 360 drawer (Overview / Enrollments / Payments /
// Attendance / Certificates / Tickets / Timeline + credential actions); leads
// open the lead drawer (stage, follow-ups, bookings, convert).
//
// Credentials note (deliberate): passwords are stored as one-way argon2id
// hashes — NOBODY can view them, by design. The "forgot my password" call is
// served by the Student 360's "Resend LMS credentials" action (rotates the
// password and emails a fresh temporary one; forced change on first sign-in).
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, EmptyState, Input, PageHeader, Skeleton } from "@repo/ui";
import type { MeResponse } from "@repo/types";

import { apiClient } from "../../lib/api-client";
import { studentsListKey } from "../../hooks/use-students";
import { leadsListKey } from "../../hooks/use-leads";
import { hasPermission } from "../../lib/permissions";
import { StudentDetailDrawer } from "../students/student-detail-drawer";
import { LeadDetailDrawer } from "../leads/lead-detail-drawer";
import { StudentStatusChip } from "../students/student-status-chip";
import { LeadStageChip } from "../leads/lead-stage-chip";
import { LifecycleChip } from "../shared/lifecycle-chip";

interface CallCenterWorkspaceProps {
  me: MeResponse | undefined;
}

/** Debounce a string value (300 ms) so we don't query per keystroke. */
function useDebounced(value: string, delayMs = 300): string {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function CallCenterWorkspace({ me }: CallCenterWorkspaceProps): React.JSX.Element {
  const [search, setSearch] = React.useState("");
  const [studentId, setStudentId] = React.useState<string | null>(null);
  const [leadId, setLeadId] = React.useState<string | null>(null);

  const query = useDebounced(search.trim());
  const searching = query.length >= 2;

  const canViewStudents = hasPermission(me?.permissions, "students.view");
  const canViewLeads = hasPermission(me?.permissions, "leads.view");

  // Same cache keys as the directory/pipeline hooks, but `enabled`-gated so no
  // request fires until there is a real query to search for.
  const studentsQuery = useQuery({
    queryKey: studentsListKey({ search: query, page: 1, pageSize: 10, includeDeleted: false }),
    queryFn: () => apiClient.crm.students.list({ search: query, page: 1, pageSize: 10, includeDeleted: false }),
    enabled: searching && canViewStudents,
  });
  const leadsQuery = useQuery({
    queryKey: leadsListKey({ search: query, page: 1, pageSize: 10 }),
    queryFn: () => apiClient.crm.leads.list({ search: query, page: 1, pageSize: 10 }),
    enabled: searching && canViewLeads,
  });

  const students = studentsQuery.data?.items ?? [];
  const leads = leadsQuery.data?.items ?? [];
  const isLoading = searching && (studentsQuery.isLoading || leadsQuery.isLoading);

  return (
    <div className="space-y-6 md:space-y-8" data-testid="call-center-workspace">
      <PageHeader
        title="Call Center"
        description="Search by name, phone, or email — everything about the caller (profile, enrollments, payments, invoices, tickets, credentials) is one click away."
      />

      <Alert tone="info" title="Forgotten credentials?" data-testid="call-center-credentials-note">
        Passwords are stored one-way encrypted and can never be viewed. Open the student and use
        &quot;Resend LMS credentials&quot; — it immediately rotates their password and emails a fresh temporary one
        (they set their own new password at next sign-in).
      </Alert>

      <div className="max-w-2xl">
        <Input
          label="Who's calling?"
          placeholder="Name / phone / email"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          autoFocus
          data-testid="call-center-search"
        />
      </div>

      {!searching ? (
        <EmptyState
          title="Start typing to find the caller"
          description="At least 2 characters — matches students and leads on name, phone, or email."
          data-testid="call-center-idle"
        />
      ) : isLoading ? (
        <div className="flex flex-col gap-3" aria-label="Searching">
          <Skeleton className="h-16 w-full rounded-md" />
          <Skeleton className="h-16 w-full rounded-md" />
          <Skeleton className="h-16 w-full rounded-md" />
        </div>
      ) : students.length === 0 && leads.length === 0 ? (
        <EmptyState
          title="No match"
          description={`Nobody found for "${query}". Try fewer characters, or a different spelling / number format.`}
          data-testid="call-center-no-results"
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section aria-label="Matching students" className="space-y-2">
            <h2 className="text-sm font-semibold text-fg">Students ({students.length})</h2>
            {students.length === 0 ? (
              <p className="text-sm text-fg-muted">No student matches.</p>
            ) : (
              <ul role="list" className="space-y-2">
                {students.map((student) => (
                  <li key={student.id}>
                    <button
                      type="button"
                      onClick={() => setStudentId(student.id)}
                      className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid="call-center-student-result"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-fg">{student.name}</span>
                        <span className="block truncate text-sm text-fg-muted">
                          {student.phone ?? "no phone"} · {student.email}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <StudentStatusChip status={student.status} />
                        <LifecycleChip stage={student.lifecycleStage} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Matching leads" className="space-y-2">
            <h2 className="text-sm font-semibold text-fg">Leads ({leads.length})</h2>
            {leads.length === 0 ? (
              <p className="text-sm text-fg-muted">No lead matches.</p>
            ) : (
              <ul role="list" className="space-y-2">
                {leads.map((lead) => (
                  <li key={lead.id}>
                    <button
                      type="button"
                      onClick={() => setLeadId(lead.id)}
                      className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid="call-center-lead-result"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-fg">{lead.name}</span>
                        <span className="block truncate text-sm text-fg-muted">
                          {lead.phone || "no phone"}
                          {lead.email ? ` · ${lead.email}` : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <LeadStageChip stage={lead.stage} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <StudentDetailDrawer
        studentId={studentId}
        onOpenChange={(open) => {
          if (!open) setStudentId(null);
        }}
        me={me}
      />
      <LeadDetailDrawer
        leadId={leadId}
        me={me}
        onOpenChange={(open) => {
          if (!open) setLeadId(null);
        }}
      />
    </div>
  );
}
