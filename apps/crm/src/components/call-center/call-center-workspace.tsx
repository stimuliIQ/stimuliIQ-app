// Search Engine (formerly "Call Center"; the route, filenames and test ids still
// say call-center) — one screen for phone-support staff: type whatever the caller
// gives you (name / phone / email) and their full record is one click away.
//
// Result cards are deliberately rich (top-tier support-desk pattern): identity
// + status chips + the key profile facts + a computed "Next step" line derived
// from the unified lifecycle stage, so the agent knows what to do for this
// caller without opening anything. Clicking the card opens the full drawer:
//   - students → Student 360 (profile / enrollments / payments /
//     certificates / tickets / timeline + credential actions)
//   - leads    → lead drawer (stage moves, follow-ups, bookings, CONVERT)
//
// Passwords are one-way hashed and can never be shown; the "forgot my
// password" call is served inside the Student 360 via "Send password reset link".
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, Input, PageHeader, Skeleton } from "@repo/ui";
import { ArrowRight } from "lucide-react";
import type { LeadSummary, LifecycleStage, MeResponse, StudentSummary } from "@repo/types";

import { apiClient } from "../../lib/api-client";
import { studentsListKey } from "../../hooks/use-students";
import { leadsListKey } from "../../hooks/use-leads";
import { hasPermission } from "../../lib/permissions";
import { StudentDetailDrawer } from "../students/student-detail-drawer";
import { LeadDetailDrawer } from "../leads/lead-detail-drawer";
import { LeadStageChip } from "../leads/lead-stage-chip";
import { LifecycleChip } from "../shared/lifecycle-chip";

interface CallCenterWorkspaceProps {
  me: MeResponse | undefined;
}

/**
 * The agent-facing "what do I do for this caller now?" line, derived from the
 * unified lifecycle stage. Keep imperative and short — it renders on the card.
 */
const NEXT_STEP: Record<LifecycleStage, string> = {
  new_lead: "Qualify the lead and assign an owner",
  assigned: "Make first contact and qualify",
  contacted: "Follow up. Move to won when ready",
  interested: "Counsel and close, move to won",
  registration_started: "Convert to student (full registration)",
  registered: "Assign a program + batch and create the order",
  program_assigned: "Create the order and collect payment",
  payment_pending: "Collect payment. Record it if paid offline",
  payment_completed: "Credentials emailed, help them sign in",
  active_student: "Enrolled. Nudge them to start learning",
  learning_in_progress: "On track, support with course questions",
  course_completed: "Issue the certificate",
  certified: "Journey complete, offer alumni support",
  lost: "Reopen the lead if interest returns",
  dropped: "Re-engage or route to the refund flow",
};

/** Debounce a string value (300 ms) so we don't query per keystroke. */
function useDebounced(value: string, delayMs = 300): string {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function Avatar({ name }: { name: string }): React.JSX.Element {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden="true"
      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-sm font-semibold text-brand-600"
    >
      {initials || "?"}
    </span>
  );
}

function MetaRow({ items }: { items: Array<{ label: string; value: string | null | undefined }> }): React.JSX.Element {
  const present = items.filter((i) => i.value);
  if (present.length === 0) return <></>;
  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
      {present.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[11px] uppercase tracking-wide text-fg-subtle">{item.label}</dt>
          <dd className="truncate text-sm text-fg">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function NextStep({ stage }: { stage: LifecycleStage }): React.JSX.Element {
  return (
    <p className="mt-3 flex items-center gap-1.5 border-t border-border pt-2.5 text-sm font-medium text-brand-600">
      <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
      {NEXT_STEP[stage]}
    </p>
  );
}

function CallerCard({
  onOpen,
  testId,
  name,
  contactLine,
  chips,
  meta,
  lifecycleStage,
}: {
  onOpen: () => void;
  testId: string;
  name: string;
  contactLine: string;
  chips: React.ReactNode;
  meta: Array<{ label: string; value: string | null | undefined }>;
  lifecycleStage: LifecycleStage;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-lg border border-border bg-card p-4 text-left shadow-sm transition-all hover:border-brand-500/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={name} />
          <div className="min-w-0">
            <p className="truncate font-semibold text-fg">{name}</p>
            <p className="truncate text-sm text-fg-muted">{contactLine}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">{chips}</div>
      </div>
      <MetaRow items={meta} />
      <NextStep stage={lifecycleStage} />
    </button>
  );
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

  const students: StudentSummary[] = studentsQuery.data?.items ?? [];
  // A converted lead and its student record are the SAME person — the student
  // card is canonical (it carries the richer post-conversion lifecycle), so
  // converted leads are hidden here to avoid a duplicate card with a staler
  // stage. The Pipeline keeps showing them (its context is lead history).
  const leads: LeadSummary[] = (leadsQuery.data?.items ?? []).filter((lead) => !lead.convertedStudentId);
  const isLoading = searching && (studentsQuery.isLoading || leadsQuery.isLoading);

  return (
    <div className="space-y-4 md:space-y-5" data-testid="call-center-workspace">
      <PageHeader
        title="Search Engine"
        description="Search by name, phone, or email. Status, details, and the next step for every caller, one click from their full record."
      />

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
          description="At least 2 characters. Matches students and leads on name, phone, or email."
          data-testid="call-center-idle"
        />
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="Searching">
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      ) : students.length === 0 && leads.length === 0 ? (
        <EmptyState
          title="No match"
          description={`Nobody found for "${query}". Try fewer characters, or a different spelling / number format.`}
          data-testid="call-center-no-results"
        />
      ) : (
        <div className="space-y-6">
          {students.length > 0 ? (
            <section aria-label="Matching students" className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
                Students ({students.length})
              </h2>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {students.map((student) => (
                  <CallerCard
                    key={student.id}
                    testId="call-center-student-result"
                    onOpen={() => setStudentId(student.id)}
                    name={student.name}
                    contactLine={[student.phone, student.email].filter(Boolean).join(" · ")}
                    // ONE status chip: the derived lifecycle stage. The coarse
                    // profile status ("lead" = admissions grouping) reads as a
                    // contradiction next to it for a paying student.
                    chips={<LifecycleChip stage={student.lifecycleStage} />}
                    meta={[
                      { label: "College", value: student.college },
                      { label: "Course type", value: student.courseTypeLabel },
                      { label: "City", value: student.city },
                      { label: "Year", value: student.year != null ? String(student.year) : null },
                      { label: "Since", value: new Date(student.createdAt).toLocaleDateString() },
                    ]}
                    lifecycleStage={student.lifecycleStage}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {leads.length > 0 ? (
            <section aria-label="Matching leads" className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
                Leads ({leads.length})
              </h2>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {leads.map((lead) => (
                  <CallerCard
                    key={lead.id}
                    testId="call-center-lead-result"
                    onOpen={() => setLeadId(lead.id)}
                    name={lead.name}
                    contactLine={[lead.phone || null, lead.email].filter(Boolean).join(" · ")}
                    chips={
                      <>
                        <LeadStageChip stage={lead.stage} />
                        <LifecycleChip stage={lead.lifecycleStage} />
                      </>
                    }
                    meta={[
                      { label: "Interest", value: lead.programInterestTitle ?? lead.courseInterest },
                      { label: "College", value: lead.college },
                      { label: "Source", value: lead.source },
                      { label: "Owner", value: lead.ownerName ?? "Unassigned" },
                      { label: "Since", value: new Date(lead.createdAt).toLocaleDateString() },
                    ]}
                    lifecycleStage={lead.lifecycleStage}
                  />
                ))}
              </div>
            </section>
          ) : null}
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
