// Export Jobs — history + live status of on-demand exports (docs/plans/
// phase-7.md Wave 3 task #15, AC-33..36). "New export" opens
// `ExportCreateDrawer`; the table polls itself (see `useExportJobsList`)
// while any visible job is queued/running, and a Download button only ever
// appears once a job has `status="succeeded"`, using its signed
// `downloadUrl` (AC-35) — never a raw storage key.
import * as React from "react";
import { Download, Plus } from "lucide-react";
import { Button, DataFilterBar, DataTable, type DataTableColumn, Select, SelectItem } from "@repo/ui";
import type { ExportEntityType, ExportJobDto, ExportJobStatus } from "@repo/types";

import { useExportJobsList } from "../../hooks/use-exports";
import { EXPORT_TYPES, exportTypeLabel } from "../../lib/export-types";
import { ReportErrorState } from "../analytics/report-error-state";
import { ExportJobStatusChip } from "./export-job-status-chip";
import { ExportCreateDrawer } from "./export-create-drawer";

const STATUS_OPTIONS: { value: ExportJobStatus; label: string }[] = [
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
];

export function ExportJobsList(): React.JSX.Element {
  const [type, setType] = React.useState<ExportEntityType | undefined>(undefined);
  const [status, setStatus] = React.useState<ExportJobStatus | undefined>(undefined);
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);

  const pageSize = 20;

  React.useEffect(() => {
    setPage(1);
  }, [type, status]);

  const { data, isLoading, isError, refetch, isFetching } = useExportJobsList({ page, pageSize, type, status });

  const columns: Array<DataTableColumn<ExportJobDto>> = [
    { id: "type", header: "Export", cell: (row) => exportTypeLabel(row.type), sortable: true },
    { id: "format", header: "Format", cell: (row) => row.format.toUpperCase() },
    { id: "status", header: "Status", cell: (row) => <ExportJobStatusChip status={row.status} /> },
    {
      id: "rowCount",
      header: "Rows",
      cell: (row) => (row.rowCount === null ? "-" : row.rowCount.toLocaleString("en-IN")),
      align: "right",
    },
    { id: "requestedBy", header: "Requested by", cell: (row) => row.requestedByName ?? "-" },
    {
      id: "requestedAt",
      header: "Requested",
      cell: (row) => new Date(row.requestedAt).toLocaleString(),
      align: "right",
    },
    {
      id: "download",
      header: "Download",
      cell: (row) =>
        row.status === "succeeded" && row.downloadUrl ? (
          <Button asChild variant="secondary" size="sm" data-testid={`export-download-${row.id}`}>
            <a href={row.downloadUrl} rel="noopener noreferrer">
              <Download className="size-4" aria-hidden="true" />
              Download
            </a>
          </Button>
        ) : row.status === "failed" ? (
          <span className="text-sm text-danger" title={row.error ?? undefined}>
            {row.error ?? "Export failed"}
          </span>
        ) : (
          <span className="text-sm text-fg-subtle">Not ready</span>
        ),
    },
  ];

  if (isError) {
    return (
      <ReportErrorState
        data-testid="export-jobs-error"
        message="Something went wrong fetching your export history."
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="export-jobs-list">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-fg-muted">
          On-demand CSV/PDF exports you've triggered. Large exports run as a background job, this
          table refreshes automatically while a job is queued or running.
        </p>
        <Button onClick={() => setCreateOpen(true)} data-testid="export-jobs-create-button">
          <Plus className="size-4" aria-hidden="true" />
          New export
        </Button>
      </div>

      <DataFilterBar data-testid="export-jobs-filter-bar">
        <Select
          label="Type"
          placeholder="All types"
          value={type}
          onValueChange={(value) => setType(value === "__all__" ? undefined : (value as ExportEntityType))}
          wrapperClassName="w-56"
          data-testid="export-jobs-type-filter"
        >
          <SelectItem value="__all__">All types</SelectItem>
          {EXPORT_TYPES.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </Select>
        <Select
          label="Status"
          placeholder="All statuses"
          value={status}
          onValueChange={(value) => setStatus(value === "__all__" ? undefined : (value as ExportJobStatus))}
          wrapperClassName="w-40"
          data-testid="export-jobs-status-filter"
        >
          <SelectItem value="__all__">All statuses</SelectItem>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </Select>
      </DataFilterBar>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        pagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No exports yet",
          description: "Start your first export with the button above.",
        }}
        caption="Export jobs"
        data-testid="export-jobs-table"
      />

      <ExportCreateDrawer open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
ExportJobsList.displayName = "ExportJobsList";
