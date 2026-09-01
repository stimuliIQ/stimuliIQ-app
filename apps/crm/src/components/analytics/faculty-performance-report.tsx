// Faculty performance report — batch load + fill-rate per faculty, derived
// client-side from the batches list (real data). No dedicated backend
// per-faculty aggregate endpoint exists — see hooks/use-extended-reports.ts
// file header. Phase 9 Completion T40.
import * as React from "react";
import { BarChart, Button, DataTable, type DataTableColumn } from "@repo/ui";
import type { MeResponse } from "@repo/types";

import { useBatchesList } from "../../hooks/use-batches";
import { summarizeFacultyPerformance, type FacultyPerformanceRow } from "../../hooks/use-extended-reports";
import { hasPermission } from "../../lib/permissions";
import { buildCsv, downloadCsv } from "../../lib/csv-export";
import { queryErrorMessage } from "../../lib/surface-error";
import { ReportErrorState } from "./report-error-state";
import { ReportPageShell } from "./report-page-shell";

export function FacultyPerformanceReport({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  // Gated on `faculty.view` ALONE, matching the tile that links here.
  //
  // It also required `reports.attendance.view`, a key seeded NOWHERE — so this page showed
  // its no-access state to every role including super_admin, while the Analytics overview
  // offered a tile that opened it. A control that lies about what it does.
  //
  // The key was almost certainly a leftover from the removed attendance feature. Deleting
  // the requirement rather than seeding the key, because this report is batch load and fill
  // rate — it has nothing to do with attendance, and minting a permission to justify a stale
  // gate would be inventing authority nobody asked for.
  const canView = hasPermission(me?.permissions, "faculty.view");
  const { data, isLoading, isError, error, refetch } = useBatchesList({ page: 1, pageSize: 200, includeDeleted: false });
  const rows = React.useMemo(() => summarizeFacultyPerformance(data?.items ?? []), [data]);

  const columns: Array<DataTableColumn<FacultyPerformanceRow>> = [
    { id: "facultyName", header: "Faculty", cell: (row) => row.facultyName },
    { id: "batchCount", header: "Batches", cell: (row) => row.batchCount, align: "right" },
    { id: "totalEnrolled", header: "Total enrolled", cell: (row) => row.totalEnrolled, align: "right" },
    { id: "fillRatePercent", header: "Fill rate", cell: (row) => `${row.fillRatePercent}%`, align: "right" },
  ];

  function exportCsv() {
    const csv = buildCsv(rows, [
      { key: "facultyName", header: "Faculty" },
      { key: "batchCount", header: "Batches" },
      { key: "totalEnrolled", header: "Total enrolled" },
      { key: "totalCapacity", header: "Total capacity" },
      { key: "fillRatePercent", header: "Fill rate %" },
    ]);
    downloadCsv("faculty-performance.csv", csv);
  }

  return (
    <ReportPageShell title="Faculty Performance" description="Batch load and fill-rate per faculty member." canView={canView} data-testid="faculty-performance-report">
      <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0} className="self-start" data-testid="faculty-performance-export">
        Export CSV
      </Button>

      {isError ? (
        <ReportErrorState
          message={queryErrorMessage(error, "Couldn't load the faculty performance report.")}
          onRetry={() => void refetch()}
          data-testid="faculty-performance-error"
        />
      ) : (
        <>
          <p className="text-xs text-fg-muted" data-testid="faculty-performance-freshness-note">
            Computed live from current batch records, no cached snapshot.
          </p>

          <BarChart
            title="Enrolled students by faculty"
            orientation="horizontal"
            data={rows.map((r) => ({ faculty: r.facultyName, enrolled: r.totalEnrolled }))}
            categoryKey="faculty"
            categoryLabel="Faculty"
            series={[{ key: "enrolled", label: "Enrolled" }]}
            loading={isLoading}
            emptyMessage="No faculty assignments yet."
            data-testid="faculty-performance-chart"
          />

          <DataTable
            columns={columns}
            rows={rows}
            getRowId={(row) => row.facultyId}
            loading={isLoading}
            caption="Faculty performance"
            emptyState={{ title: "No faculty assignments yet" }}
            data-testid="faculty-performance-table"
          />
        </>
      )}
    </ReportPageShell>
  );
}
