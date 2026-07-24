// Ticket queue — DataFilterBar (search/status/priority/assignee/overdue) +
// DataTable with SLA chip, opens TicketDetailDrawer. Phase 9 Completion
// T21/T38 (docs/plans/phase-9-completion.md).
import * as React from "react";
import { DataFilterBar, DataTable, type DataTableColumn, PageHeader, SlaChip, StatusChip } from "@repo/ui";
import type { MeResponse, TicketPriority, TicketStatus, TicketSummary } from "@repo/types";

import { useTicketsList } from "../../hooks/use-tickets";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { TicketDetailDrawer } from "./ticket-detail-drawer";
import { CannedResponseManagerDrawer } from "./canned-response-manager-drawer";
import { Button } from "@repo/ui";

const STATUS_TONE: Record<TicketStatus, "warning" | "info" | "success" | "neutral"> = {
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

export function TicketQueue({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<TicketStatus | undefined>(undefined);
  const [priority, setPriority] = React.useState<TicketPriority | undefined>(undefined);
  const [overdue, setOverdue] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [cannedOpen, setCannedOpen] = React.useState(false);
  const pageSize = 20;

  const debouncedSearch = useDebouncedValue(search);

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, priority, overdue]);

  const { data, isLoading, isFetching, isError, refetch } = useTicketsList({
    page,
    pageSize,
    search: debouncedSearch || undefined,
    status,
    priority,
    overdue: overdue || undefined,
  });

  const columns: Array<DataTableColumn<TicketSummary>> = [
    { id: "subject", header: "Subject", cell: (row) => row.subject },
    { id: "userName", header: "Raised by", cell: (row) => row.userName },
    { id: "status", header: "Status", cell: (row) => <StatusChip tone={STATUS_TONE[row.status]} label={row.status.replace("_", " ")} size="sm" /> },
    { id: "priority", header: "Priority", cell: (row) => <StatusChip tone={PRIORITY_TONE[row.priority]} label={row.priority} size="sm" /> },
    { id: "assigneeName", header: "Assigned to", cell: (row) => row.assigneeName ?? "Unassigned" },
    { id: "slaDueAt", header: "SLA", cell: (row) => (row.slaDueAt ? <SlaChip dueAt={new Date(row.slaDueAt)} size="sm" /> : "—") },
    { id: "createdAt", header: "Created", cell: (row) => new Date(row.createdAt).toLocaleDateString(), align: "right" },
  ];

  return (
    <div className="space-y-6 md:space-y-8" data-testid="ticket-queue">
      <PageHeader
        title="Tickets"
        description="Support queue with SLA tracking, assignment, and canned replies."
        actions={
          <Button variant="secondary" onClick={() => setCannedOpen(true)} data-testid="ticket-queue-manage-canned">
            Canned responses
          </Button>
        }
      />

      <DataTable
        toolbar={
          <DataFilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Subject or raiser name…"
            chips={[
              ...(status ? [{ id: "status", label: `Status: ${status}`, onRemove: () => setStatus(undefined) }] : []),
              ...(priority ? [{ id: "priority", label: `Priority: ${priority}`, onRemove: () => setPriority(undefined) }] : []),
              ...(overdue ? [{ id: "overdue", label: "Overdue only", onRemove: () => setOverdue(false) }] : []),
            ]}
            onClearAll={
              status || priority || overdue
                ? () => {
                    setStatus(undefined);
                    setPriority(undefined);
                    setOverdue(false);
                  }
                : undefined
            }
            data-testid="ticket-queue-filter-bar"
          >
            <select
              aria-label="Filter by status"
              value={status ?? ""}
              onChange={(e) => setStatus((e.target.value || undefined) as TicketStatus | undefined)}
              className="h-9 rounded-md border border-border bg-bg px-2 text-sm text-fg"
            >
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
            <select
              aria-label="Filter by priority"
              value={priority ?? ""}
              onChange={(e) => setPriority((e.target.value || undefined) as TicketPriority | undefined)}
              className="h-9 rounded-md border border-border bg-bg px-2 text-sm text-fg"
            >
              <option value="">All priorities</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
            <label className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
              <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} className="size-4 rounded-sm border border-border" />
              Overdue only
            </label>
          </DataFilterBar>
        }
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        onRowClick={(row) => setSelectedId(row.id)}
        pagination={{ page, pageSize, total: data?.meta.total ?? 0, onPageChange: setPage }}
        emptyState={
          isError
            ? { title: "Couldn't load tickets", description: "Something went wrong.", action: <Button variant="secondary" onClick={() => refetch()}>Try again</Button> }
            : { title: "No tickets", description: "Nothing matches these filters." }
        }
        caption="Support ticket queue"
        data-testid="ticket-queue-table"
      />

      <TicketDetailDrawer ticketId={selectedId} onOpenChange={(open) => !open && setSelectedId(null)} me={me} />
      <CannedResponseManagerDrawer open={cannedOpen} onOpenChange={setCannedOpen} me={me} />
    </div>
  );
}
