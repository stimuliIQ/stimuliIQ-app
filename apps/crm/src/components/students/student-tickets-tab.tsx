// Student 360 — Tickets tab (Phase 9 Completion T37). `ListTicketsQuery` has
// no `userId`/studentId filter (only `assigneeId`/`search`-by-subject-or-
// raiser-name) — fetched by name search then filtered client-side by
// `userId` (real data, exact match; the name search is just a server-side
// pre-filter to keep the page small).
import * as React from "react";
import { DataTable, type DataTableColumn, SlaChip, StatusChip } from "@repo/ui";
import type { TicketPriority, TicketStatus, TicketSummary } from "@repo/types";

import { useTicketsList } from "../../hooks/use-tickets";

const STATUS_TONE: Record<TicketStatus, "info" | "warning" | "success" | "neutral"> = {
  open: "warning",
  in_progress: "info",
  resolved: "success",
  closed: "neutral",
};

const PRIORITY_TONE: Record<TicketPriority, "neutral" | "info" | "warning" | "danger"> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  urgent: "danger",
};

export function StudentTicketsTab({ userId }: { userId: string; studentName: string }): React.JSX.Element {
  const { data, isLoading, isError } = useTicketsList({ page: 1, pageSize: 50 });
  const rows = (data?.items ?? []).filter((t) => t.userId === userId);

  const columns: Array<DataTableColumn<TicketSummary>> = [
    { id: "subject", header: "Subject", cell: (row) => row.subject },
    { id: "status", header: "Status", cell: (row) => <StatusChip tone={STATUS_TONE[row.status]} label={row.status.replace("_", " ")} size="sm" /> },
    { id: "priority", header: "Priority", cell: (row) => <StatusChip tone={PRIORITY_TONE[row.priority]} label={row.priority} size="sm" /> },
    { id: "assigneeName", header: "Assigned to", cell: (row) => row.assigneeName ?? "Unassigned" },
    { id: "slaDueAt", header: "SLA", cell: (row) => (row.slaDueAt ? <SlaChip dueAt={new Date(row.slaDueAt)} size="sm" /> : "—") },
  ];

  if (isError) {
    return <p role="alert" className="text-sm text-danger">Couldn't load tickets.</p>;
  }

  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      loading={isLoading}
      caption="Student support tickets"
      emptyState={{ title: "No tickets", description: "This student hasn't raised any support tickets." }}
      data-testid="student-tickets-table"
    />
  );
}
