// Audit logs directory — read-only, server-paginated DataTable wired to
// hooks/use-audit-logs.ts (docs/03 §7.16/§20(b)). Filters: entity/action/
// actor/date-range. Row click opens the before/after diff drawer. RBAC:
// gated on `audit_logs.view` at the route level (the API also enforces this
// server-side).
import * as React from "react";
import { Button, DataFilterBar, DataTable, type DataTableColumn, EmptyState, Input, PageHeader, Select, SelectItem } from "@repo/ui";
import type { AuditAction, AuditLogEntry, ListAuditLogsQuery } from "@repo/types";

import { useAuditLogsList } from "../../hooks/use-audit-logs";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { AuditActionChip } from "./audit-action-chip";
import { AuditLogDetailDrawer } from "./audit-log-detail-drawer";

const ACTION_OPTIONS: { value: AuditAction; label: string }[] = [
  { value: "create", label: "Created" },
  { value: "update", label: "Updated" },
  { value: "delete", label: "Deleted" },
  { value: "restore", label: "Restored" },
];

export function AuditLogDirectory(): React.JSX.Element {
  const [entity, setEntity] = React.useState("");
  const [action, setAction] = React.useState<AuditAction | undefined>(undefined);
  const [actorId, setActorId] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [selectedEntry, setSelectedEntry] = React.useState<AuditLogEntry | null>(null);

  const debouncedEntity = useDebouncedValue(entity);
  const debouncedActorId = useDebouncedValue(actorId);
  const pageSize = 20;

  React.useEffect(() => {
    setPage(1);
  }, [debouncedEntity, action, debouncedActorId, from, to]);

  const query: ListAuditLogsQuery = {
    page,
    pageSize,
    entity: debouncedEntity || undefined,
    action,
    actorId: debouncedActorId || undefined,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
  };

  const { data, isLoading, isError, refetch, isFetching } = useAuditLogsList(query);

  const columns: Array<DataTableColumn<AuditLogEntry>> = [
    {
      id: "createdAt",
      header: "When",
      cell: (row) => new Date(row.createdAt).toLocaleString(),
      sortable: true,
    },
    { id: "actorName", header: "Actor", cell: (row) => row.actorName ?? "System" },
    { id: "entity", header: "Entity", cell: (row) => row.entity },
    {
      id: "action",
      header: "Action",
      cell: (row) => <AuditActionChip action={row.action} />,
    },
    { id: "ip", header: "IP", cell: (row) => row.ip ?? "—" },
  ];

  if (isError) {
    return (
      <EmptyState
        data-testid="audit-logs-error"
        title="Couldn't load audit logs"
        description="Something went wrong fetching the audit trail."
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="audit-logs-retry">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="audit-logs-directory">
      <PageHeader
        title="Audit logs"
        description="Who changed what, and when — across every CRM module."
      />

      <DataFilterBar data-testid="audit-logs-filter-bar">
        <Input
          label="Entity"
          placeholder="e.g. student, batch, role"
          value={entity}
          onChange={(event) => setEntity(event.target.value)}
          wrapperClassName="w-48"
          data-testid="audit-logs-entity-filter"
        />
        <Select
          label="Action"
          placeholder="All actions"
          value={action}
          onValueChange={(value) => setAction(value === "__all__" ? undefined : (value as AuditAction))}
          wrapperClassName="w-40"
          data-testid="audit-logs-action-filter"
        >
          <SelectItem value="__all__">All actions</SelectItem>
          {ACTION_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </Select>
        <Input
          label="Actor ID"
          placeholder="Filter by actor"
          value={actorId}
          onChange={(event) => setActorId(event.target.value)}
          wrapperClassName="w-48"
          data-testid="audit-logs-actor-filter"
        />
        <Input
          label="From"
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          wrapperClassName="w-40"
          data-testid="audit-logs-from-filter"
        />
        <Input
          label="To"
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          wrapperClassName="w-40"
          data-testid="audit-logs-to-filter"
        />
      </DataFilterBar>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        onRowClick={(row) => setSelectedEntry(row)}
        pagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No audit entries yet",
          description: "Try adjusting your filters.",
        }}
        caption="Audit logs"
        data-testid="audit-logs-table"
      />

      <AuditLogDetailDrawer entry={selectedEntry} onOpenChange={(open) => !open && setSelectedEntry(null)} />
    </div>
  );
}
