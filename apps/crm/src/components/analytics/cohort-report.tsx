// Cohort report — treats each batch as an intake "cohort" (real batch data:
// enrolledCount/capacity/status), with an on-demand attendance drill-in per
// row. No dedicated `crm/reports/cohort` endpoint exists — see hooks/
// use-extended-reports.ts file header. Phase 9 Completion T40.
import * as React from "react";
import { Button, DataTable, type DataTableColumn, KpiCard, StatusChip } from "@repo/ui";
import type { BatchSummary, MeResponse } from "@repo/types";
import { CalendarCheck } from "lucide-react";

import { useBatchesList } from "../../hooks/use-batches";
import { useCohortAttendance } from "../../hooks/use-extended-reports";
import { hasPermission } from "../../lib/permissions";
import { buildCsv, downloadCsv } from "../../lib/csv-export";
import { queryErrorMessage } from "../../lib/surface-error";
import { ReportErrorState } from "./report-error-state";
import { ReportPageShell } from "./report-page-shell";

export function CohortReport({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const canView = hasPermission(me?.permissions, "reports.enrollment.view");
  const canViewAttendance = hasPermission(me?.permissions, "reports.attendance.view");
  const [selectedBatchId, setSelectedBatchId] = React.useState<string | undefined>(undefined);

  const { data, isLoading, isError, error, refetch } = useBatchesList({ page: 1, pageSize: 100, includeDeleted: false });
  const attendance = useCohortAttendance(canViewAttendance ? selectedBatchId : undefined);

  const columns: Array<DataTableColumn<BatchSummary>> = [
    { id: "name", header: "Cohort (batch)", cell: (row) => row.name },
    { id: "programTitle", header: "Program", cell: (row) => row.programTitle },
    { id: "startDate", header: "Start", cell: (row) => new Date(row.startDate).toLocaleDateString() },
    { id: "enrolledCount", header: "Enrolled", cell: (row) => `${row.enrolledCount} / ${row.capacity}`, align: "right" },
    { id: "status", header: "Status", cell: (row) => <StatusChip tone={row.status === "active" ? "success" : "neutral"} label={row.status} size="sm" /> },
  ];

  function exportCsv() {
    const csv = buildCsv(
      (data?.items ?? []).map((b) => ({ cohort: b.name, program: b.programTitle, start: b.startDate, enrolled: b.enrolledCount, capacity: b.capacity, status: b.status })),
      [
        { key: "cohort", header: "Cohort" },
        { key: "program", header: "Program" },
        { key: "start", header: "Start date" },
        { key: "enrolled", header: "Enrolled" },
        { key: "capacity", header: "Capacity" },
        { key: "status", header: "Status" },
      ],
    );
    downloadCsv("cohort-report.csv", csv);
  }

  return (
    <ReportPageShell title="Cohort Report" description="Batch-as-cohort snapshot with an on-demand attendance drill-in." canView={canView} data-testid="cohort-report">
      <Button variant="secondary" onClick={exportCsv} disabled={(data?.items.length ?? 0) === 0} className="self-start" data-testid="cohort-report-export">
        Export CSV
      </Button>

      {isError ? (
        <ReportErrorState
          message={queryErrorMessage(error, "Couldn't load the cohort report.")}
          onRetry={() => void refetch()}
          data-testid="cohort-report-error"
        />
      ) : (
        <>
          <p className="text-xs text-fg-muted" data-testid="cohort-report-freshness-note">
            Computed live from current batch records — no cached snapshot.
          </p>

          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            getRowId={(row) => row.id}
            loading={isLoading}
            onRowClick={canViewAttendance ? (row) => setSelectedBatchId(row.id === selectedBatchId ? undefined : row.id) : undefined}
            caption="Cohorts"
            emptyState={{ title: "No cohorts yet" }}
            data-testid="cohort-report-table"
          />

          {selectedBatchId ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="cohort-attendance-drilldown">
              <KpiCard
                label="Cohort attendance %"
                value={attendance.data ? `${attendance.data.attendancePercent.toFixed(1)}%` : "—"}
                icon={<CalendarCheck />}
                loading={attendance.isLoading}
              />
              <KpiCard label="Present / total" value={attendance.data ? `${attendance.data.presentCount} / ${attendance.data.totalCount}` : "—"} loading={attendance.isLoading} />
            </div>
          ) : null}
        </>
      )}
    </ReportPageShell>
  );
}
