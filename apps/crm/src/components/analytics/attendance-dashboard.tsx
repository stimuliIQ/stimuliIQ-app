// WS-A4 Attendance dashboard — docs/specs/phase-7-analytics-hardening.md AC-14..16.
// Permissions: reports.attendance.view (scope: all|branch|assigned). Faculty MUST
// pick an assigned batch (an unassigned batch id 404s — IDOR-safe, AC-15); the
// batch picker below is itself scoped server-side (a Faculty's batches list only
// ever contains their assigned batches), so the UI naturally can't offer an
// out-of-scope choice. Admin/Owner may leave the picker on "All batches" (AC-16).
import * as React from "react";
import { BarChart, KpiCard, Select, SelectItem } from "@repo/ui";
import type { MeResponse } from "@repo/types";
import { CalendarCheck } from "lucide-react";

import { useAttendanceReport } from "../../hooks/use-reports";
import { useBatchesList } from "../../hooks/use-batches";
import { hasPermission } from "../../lib/permissions";
import { queryErrorMessage } from "../../lib/surface-error";
import { ReportErrorState } from "./report-error-state";
import { ReportFreshnessBadge } from "./report-freshness";
import { ReportPageShell } from "./report-page-shell";

export interface AttendanceDashboardProps {
  me: MeResponse | undefined;
}

export function AttendanceDashboard({ me }: AttendanceDashboardProps): React.JSX.Element {
  const canView = hasPermission(me?.permissions, "reports.attendance.view");

  const [batchId, setBatchId] = React.useState<string | undefined>(undefined);

  const { data: batches } = useBatchesList({ page: 1, pageSize: 200, status: "active", includeDeleted: false });
  const { data, isLoading, isError, error, refetch } = useAttendanceReport({ batchId }, canView);

  return (
    <ReportPageShell
      title="Attendance"
      description="Present/total attendance across enrollments, tenant-wide or narrowed to one batch."
      canView={canView}
      data-testid="attendance-dashboard"
    >
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Batch"
          placeholder="All batches"
          value={batchId}
          onValueChange={(value) => setBatchId(value === "__all__" ? undefined : value)}
          wrapperClassName="w-56"
          data-testid="attendance-batch-filter"
        >
          <SelectItem value="__all__">All batches</SelectItem>
          {(batches?.items ?? []).map((batch) => (
            <SelectItem key={batch.id} value={batch.id}>
              {batch.name}
            </SelectItem>
          ))}
        </Select>
      </div>

      {isError ? (
        <ReportErrorState
          message={queryErrorMessage(error, "Couldn't load the attendance dashboard.")}
          onRetry={() => void refetch()}
          data-testid="attendance-dashboard-error"
        />
      ) : (
        <>
          {data ? <ReportFreshnessBadge asOf={data.asOf} stale={data.stale} /> : null}

          <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
            <KpiCard
              label="Attendance %"
              value={data ? `${data.attendancePercent.toFixed(1)}%` : "—"}
              icon={<CalendarCheck />}
              loading={isLoading}
              data-testid="attendance-percent-kpi"
            />
            <KpiCard
              label="Present / total"
              value={data ? `${data.presentCount} / ${data.totalCount}` : "—"}
              loading={isLoading}
              data-testid="attendance-counts-kpi"
            />
          </div>

          {data?.perBatch ? (
            <BarChart
              title="Attendance by batch"
              orientation="horizontal"
              data={data.perBatch.map((row) => ({ batch: row.batchName, percent: row.attendancePercent }))}
              categoryKey="batch"
              categoryLabel="Batch"
              series={[{ key: "percent", label: "Attendance %" }]}
              valueFormatter={(v) => `${v.toFixed(1)}%`}
              loading={isLoading}
              emptyMessage="No attendance recorded yet."
              data-testid="attendance-by-batch-chart"
            />
          ) : null}
        </>
      )}
    </ReportPageShell>
  );
}
AttendanceDashboard.displayName = "AttendanceDashboard";
