// Branch comparison report — composed client-side from the existing
// per-branch revenue/enrollment endpoints (no dedicated backend
// `crm/reports/branch-comparison` endpoint exists — see hooks/
// use-extended-reports.ts file header). Phase 9 Completion T40.
import * as React from "react";
import { BarChart, Button, DataTable, type DataTableColumn, formatPaise } from "@repo/ui";
import type { MeResponse } from "@repo/types";

import { useAllBranches } from "../../hooks/use-branches";
import { useBranchComparisonReport, type BranchComparisonRow } from "../../hooks/use-extended-reports";
import { hasPermission } from "../../lib/permissions";
import { defaultDateRange } from "../../lib/report-dates";
import { buildCsv, downloadCsv } from "../../lib/csv-export";
import { DateRangeFilter } from "./date-range-filter";
import { ReportErrorState } from "./report-error-state";
import { ReportPageShell } from "./report-page-shell";

export function BranchComparisonReport({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const canView = hasPermission(me?.permissions, "reports.revenue.view") && hasPermission(me?.permissions, "branches.view");
  const [range, setRange] = React.useState(defaultDateRange(30));

  const { data: branches } = useAllBranches();
  const { rows, isLoading, isError, refetch } = useBranchComparisonReport(
    (branches?.items ?? []).map((b) => ({ id: b.id, name: b.name })),
    range,
    canView,
  );

  const columns: Array<DataTableColumn<BranchComparisonRow>> = [
    { id: "branchName", header: "Branch", cell: (row) => row.branchName },
    { id: "revenuePaise", header: "Revenue", cell: (row) => (row.revenuePaise !== null ? formatPaise(row.revenuePaise) : "—"), align: "right" },
    { id: "enrollments", header: "Enrollments", cell: (row) => row.enrollments ?? "—", align: "right" },
  ];

  function exportCsv() {
    const csv = buildCsv(
      rows.map((r) => ({ branch: r.branchName, revenuePaise: r.revenuePaise ?? 0, enrollments: r.enrollments ?? 0 })),
      [
        { key: "branch", header: "Branch" },
        { key: "revenuePaise", header: "Revenue (paise)" },
        { key: "enrollments", header: "Enrollments" },
      ],
    );
    downloadCsv(`branch-comparison-${range.from}-to-${range.to}.csv`, csv);
  }

  return (
    <ReportPageShell title="Branch Comparison" description="Revenue and enrollments per branch for the selected range." canView={canView} data-testid="branch-comparison-report">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <DateRangeFilter from={range.from} to={range.to} onFromChange={(from) => setRange((r) => ({ ...r, from }))} onToChange={(to) => setRange((r) => ({ ...r, to }))} />
        <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0} data-testid="branch-comparison-export">
          Export CSV
        </Button>
      </div>

      {isError ? (
        <ReportErrorState
          message="Couldn't load the branch comparison report."
          onRetry={refetch}
          data-testid="branch-comparison-error"
        />
      ) : (
        <>
          <p className="text-xs text-fg-muted" data-testid="branch-comparison-freshness-note">
            Computed live from current branch revenue/enrollment records — no cached snapshot.
          </p>

          <BarChart
            title="Revenue by branch"
            orientation="horizontal"
            data={rows.map((r) => ({ branch: r.branchName, revenue: r.revenuePaise ?? 0 }))}
            categoryKey="branch"
            categoryLabel="Branch"
            series={[{ key: "revenue", label: "Revenue" }]}
            valueFormatter={(v) => formatPaise(v)}
            loading={isLoading}
            emptyMessage="No branches to compare yet."
            data-testid="branch-comparison-chart"
          />

          <DataTable
            columns={columns}
            rows={rows}
            getRowId={(row) => row.branchId}
            loading={isLoading}
            caption="Branch comparison"
            emptyState={{ title: "No branches yet" }}
            data-testid="branch-comparison-table"
          />
        </>
      )}
    </ReportPageShell>
  );
}
