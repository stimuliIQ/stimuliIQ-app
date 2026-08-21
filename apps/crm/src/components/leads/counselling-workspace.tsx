// Counselling workspace — the counsellor's focused actionable queue
// (docs/03 §7.12): today's/overdue follow-up tasks, due bookings, and a
// quick link into "my leads needing action". This is deliberately NOT the
// full analytics dashboard (that's P7) — just a practical operational list,
// per the task brief.
//
// RBAC: the API scopes activities/bookings/leads to `own|assigned` for a
// counsellor server-side (leads.owner_id, per phase-2.md). This view simply
// renders what the scoped endpoints return — no client-side scope logic.
import * as React from "react";
import { Button, DataTable, type DataTableColumn, EmptyState, PageHeader, SlaChip } from "@repo/ui";
import type { BookingSummary, MeResponse } from "@repo/types";

import { useActivitiesList } from "../../hooks/use-activities";
import { useBookingsList } from "../../hooks/use-bookings";
import { useLeadsList } from "../../hooks/use-leads";
import { TaskList } from "./task-list";
import { LeadStageChip } from "./lead-stage-chip";

interface CounsellingWorkspaceProps {
  me: MeResponse | undefined;
}

export function CounsellingWorkspace({ me: _me }: CounsellingWorkspaceProps): React.JSX.Element {
  // "Today's/overdue follow-ups" — pending tasks due now or in the past,
  // i.e. dueBefore = now. The list is further sorted client-side by due
  // date (ascending — most overdue first) since the SLA view's value is in
  // ordering by urgency, not creation time.
  const now = React.useMemo(() => new Date().toISOString(), []);
  const tasksQuery = useActivitiesList({ pendingTasks: true, dueBefore: now, page: 1, pageSize: 50 });
  const bookingsQuery = useBookingsList({ status: "requested", page: 1, pageSize: 20 });
  const leadsQuery = useLeadsList({ slaOverdue: true, page: 1, pageSize: 20 });

  const sortedTasks = React.useMemo(() => {
    const items = tasksQuery.data?.items ?? [];
    return [...items].sort((a, b) => {
      if (!a.dueAt || !b.dueAt) return 0;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });
  }, [tasksQuery.data]);

  const bookingColumns: Array<DataTableColumn<BookingSummary>> = [
    { id: "leadName", header: "Lead", cell: (row) => row.leadName ?? "-" },
    { id: "programTitle", header: "Program", cell: (row) => row.programTitle ?? "-" },
    {
      id: "slotAt",
      header: "Slot",
      cell: (row) => new Date(row.slotAt).toLocaleString(),
    },
    { id: "source", header: "Source", cell: (row) => row.source },
  ];

  return (
    <div className="space-y-4 md:space-y-5" data-testid="counselling-workspace">
      <PageHeader
        title="Counselling workspace"
        description="Today's and overdue follow-ups, due bookings, and leads needing action."
      />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-fg">Due / overdue follow-ups</h2>
        <TaskList
          tasks={sortedTasks}
          isLoading={tasksQuery.isLoading}
          isError={tasksQuery.isError}
          onRetry={() => tasksQuery.refetch()}
          showLeadId
          emptyTitle="Nothing due"
          emptyDescription="You have no due or overdue follow-ups right now."
          data-testid="counselling-tasks"
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-fg">Pending bookings</h2>
        {bookingsQuery.isError ? (
          <EmptyState
            data-testid="counselling-bookings-error"
            title="Couldn't load bookings"
            description="Something went wrong fetching pending bookings."
            action={
              <Button variant="secondary" onClick={() => bookingsQuery.refetch()} data-testid="counselling-bookings-retry">
                Try again
              </Button>
            }
          />
        ) : (
          <DataTable
            columns={bookingColumns}
            rows={bookingsQuery.data?.items ?? []}
            getRowId={(row) => row.id}
            loading={bookingsQuery.isLoading}
            caption="Pending bookings"
            data-testid="counselling-bookings-table"
            emptyState={{ title: "No pending bookings", description: "Requested demo/slot bookings will appear here." }}
          />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-fg">Leads needing action (SLA overdue)</h2>
        {leadsQuery.isError ? (
          <EmptyState
            data-testid="counselling-leads-error"
            title="Couldn't load leads"
            description="Something went wrong fetching SLA-overdue leads."
            action={
              <Button variant="secondary" onClick={() => leadsQuery.refetch()} data-testid="counselling-leads-retry">
                Try again
              </Button>
            }
          />
        ) : (leadsQuery.data?.items ?? []).length === 0 ? (
          <EmptyState data-testid="counselling-leads-empty" title="No overdue leads" description="All your leads are within SLA." />
        ) : (
          <ul className="flex flex-col gap-2" data-testid="counselling-leads-list">
            {(leadsQuery.data?.items ?? []).map((lead) => (
              <li
                key={lead.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
              >
                <div>
                  <p className="text-fg">{lead.name}</p>
                  <p className="text-fg-muted">{lead.programInterestTitle ?? lead.courseInterest ?? lead.source}</p>
                </div>
                <div className="flex items-center gap-2">
                  <LeadStageChip stage={lead.stage} />
                  {lead.slaDueAt ? <SlaChip dueAt={new Date(lead.slaDueAt)} /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
