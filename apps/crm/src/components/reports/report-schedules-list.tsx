// Report Schedules — recurring report-email CRUD (docs/plans/phase-7.md
// Wave 3 task #15, AC-37..39). DataTable + create/edit form drawer +
// delete-via-ConfirmDialog, mirroring components/commerce/coupon-list.tsx.
import * as React from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button, ConfirmDialog, DataTable, type DataTableColumn, useToast } from "@repo/ui";
import type { ReportScheduleDto } from "@repo/types";

import { useDeleteReportSchedule, useReportSchedulesList } from "../../hooks/use-report-schedules";
import { surfaceError } from "../../lib/surface-error";
import { exportTypeLabel } from "../../lib/export-types";
import { ReportErrorState } from "../analytics/report-error-state";
import { ScheduleActiveChip, ScheduleRunStatusChip } from "./report-schedule-status-chip";
import { ReportScheduleFormDrawer } from "./report-schedule-form-drawer";

const FREQUENCY_LABEL: Record<ReportScheduleDto["frequency"], string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

export function ReportSchedulesList(): React.JSX.Element {
  const { toast } = useToast();
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editSchedule, setEditSchedule] = React.useState<ReportScheduleDto | null>(null);
  const [deleteSchedule, setDeleteSchedule] = React.useState<ReportScheduleDto | null>(null);

  const pageSize = 20;
  const deleteMutation = useDeleteReportSchedule();

  const { data, isLoading, isError, refetch, isFetching } = useReportSchedulesList({ page, pageSize });

  async function handleDelete() {
    if (!deleteSchedule) return;
    try {
      await deleteMutation.mutateAsync(deleteSchedule.id);
      toast({ title: "Schedule deleted", variant: "success" });
      setDeleteSchedule(null);
    } catch (error) {
      surfaceError(toast, error, "Couldn't delete schedule");
    }
  }

  const columns: Array<DataTableColumn<ReportScheduleDto>> = [
    { id: "type", header: "Report", cell: (row) => exportTypeLabel(row.type), sortable: true },
    { id: "format", header: "Format", cell: (row) => row.format.toUpperCase() },
    { id: "frequency", header: "Frequency", cell: (row) => FREQUENCY_LABEL[row.frequency] },
    { id: "recipient", header: "Recipient", cell: (row) => row.recipientEmail ?? "Creator's email" },
    { id: "active", header: "Status", cell: (row) => <ScheduleActiveChip active={row.active} /> },
    {
      id: "nextRunAt",
      header: "Next run",
      cell: (row) => new Date(row.nextRunAt).toLocaleString(),
      align: "right",
    },
    {
      id: "lastRun",
      header: "Last run",
      cell: (row) =>
        row.lastRunAt ? (
          <div className="flex flex-col gap-1">
            <span>{new Date(row.lastRunAt).toLocaleString()}</span>
            {row.lastStatus ? <ScheduleRunStatusChip status={row.lastStatus} /> : null}
            {row.lastStatus === "failed" && row.lastError ? (
              <span className="text-xs text-danger">{row.lastError}</span>
            ) : null}
          </div>
        ) : (
          <span className="text-fg-subtle">Never run yet</span>
        ),
    },
    { id: "createdByName", header: "Created by", cell: (row) => row.createdByName },
    {
      id: "actions",
      header: "Actions",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              setEditSchedule(row);
            }}
            aria-label={`Edit schedule for ${exportTypeLabel(row.type)}`}
            data-testid={`schedule-edit-button-${row.id}`}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              setDeleteSchedule(row);
            }}
            aria-label={`Delete schedule for ${exportTypeLabel(row.type)}`}
            data-testid={`schedule-delete-button-${row.id}`}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ),
    },
  ];

  if (isError) {
    return (
      <ReportErrorState
        data-testid="schedules-error"
        message="Something went wrong fetching your scheduled reports."
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="report-schedules-list">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-fg-muted">
          Recurring report emails. A schedule's data is re-evaluated at send time from the
          recipient's own permissions. It never sends data the recipient can no longer access.
        </p>
        <Button onClick={() => setCreateOpen(true)} data-testid="schedules-create-button">
          <Plus className="size-4" aria-hidden="true" />
          New schedule
        </Button>
      </div>

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
          title: "No scheduled reports yet",
          description: "Create one to get a report emailed on a recurring cadence.",
        }}
        caption="Report schedules"
        data-testid="report-schedules-table"
      />

      <ReportScheduleFormDrawer open={createOpen} onOpenChange={setCreateOpen} />
      {editSchedule ? (
        <ReportScheduleFormDrawer
          open={Boolean(editSchedule)}
          onOpenChange={(open) => !open && setEditSchedule(null)}
          schedule={editSchedule}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteSchedule)}
        onOpenChange={(open) => !open && setDeleteSchedule(null)}
        title="Delete this schedule?"
        description={
          deleteSchedule
            ? `"${exportTypeLabel(deleteSchedule.type)}" (${deleteSchedule.frequency}) will stop sending. This can't be undone.`
            : undefined
        }
        confirmLabel="Delete"
        tone="danger"
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
        data-testid="schedule-delete-confirm"
      />
    </div>
  );
}
ReportSchedulesList.displayName = "ReportSchedulesList";
