// WS-A2 Enrollment trend dashboard — docs/specs/phase-7-analytics-hardening.md AC-7..9.
// Permissions: reports.enrollment.view (scope: all|branch|assigned).
import * as React from "react";
import { KpiCard, LineChart, Select, SelectItem } from "@repo/ui";
import type { MeResponse, ReportGranularity } from "@repo/types";
import { UserPlus } from "lucide-react";

import { useEnrollmentTrendReport } from "../../hooks/use-reports";
import { useBranchScope } from "../../app/branch-scope";
import { hasPermission } from "../../lib/permissions";
import { defaultDateRange, isValidDateRange } from "../../lib/report-dates";
import { queryErrorMessage } from "../../lib/surface-error";
import { DateRangeFilter } from "./date-range-filter";
import { ReportErrorState } from "./report-error-state";
import { ReportFreshnessBadge } from "./report-freshness";
import { ReportPageShell } from "./report-page-shell";

export interface EnrollmentTrendDashboardProps {
  me: MeResponse | undefined;
}

export function EnrollmentTrendDashboard({ me }: EnrollmentTrendDashboardProps): React.JSX.Element {
  const canView = hasPermission(me?.permissions, "reports.enrollment.view");
  const { branches, canFilterBranch, selectedBranchId: branchId, setSelectedBranchId: setBranchId } =
    useBranchScope();

  const [range, setRange] = React.useState(defaultDateRange(90));
  const [granularity, setGranularity] = React.useState<ReportGranularity>("weekly");

  const rangeValid = isValidDateRange(range.from, range.to);

  const { data, isLoading, isError, error, refetch } = useEnrollmentTrendReport(
    { from: range.from, to: range.to, granularity, branchId },
    canView && rangeValid,
  );

  return (
    <ReportPageShell
      title="Enrollment trend"
      description="New enrollments over time, bucketed by the selected granularity."
      canView={canView}
      data-testid="enrollment-trend-dashboard"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <DateRangeFilter
          from={range.from}
          to={range.to}
          onFromChange={(from) => setRange((r) => ({ ...r, from }))}
          onToChange={(to) => setRange((r) => ({ ...r, to }))}
          invalid={!rangeValid}
          granularity={granularity}
          onGranularityChange={setGranularity}
        />
        {canFilterBranch ? (
          <Select
            label="Branch"
            placeholder="All branches"
            value={branchId}
            onValueChange={(value) => setBranchId(value === "__all__" ? undefined : value)}
            wrapperClassName="w-48"
            data-testid="enrollment-branch-filter"
          >
            <SelectItem value="__all__">All branches</SelectItem>
            {branches.map((branch) => (
              <SelectItem key={branch.id} value={branch.id}>
                {branch.name}
              </SelectItem>
            ))}
          </Select>
        ) : null}
      </div>

      {isError ? (
        <ReportErrorState
          message={queryErrorMessage(error, "Couldn't load the enrollment trend dashboard.")}
          onRetry={() => void refetch()}
          data-testid="enrollment-trend-dashboard-error"
        />
      ) : (
        <>
          {data ? <ReportFreshnessBadge asOf={data.asOf} stale={data.stale} /> : null}

          <div className="grid max-w-xs grid-cols-1 gap-4">
            <KpiCard
              label={`Total enrollments (${range.from} to ${range.to})`}
              value={data ? data.total : "—"}
              icon={<UserPlus />}
              loading={isLoading}
              data-testid="enrollment-total-kpi"
            />
          </div>

          <LineChart
            title="Enrollments over time"
            description={data ? `Bucketed ${data.granularity}` : undefined}
            data={(data?.series ?? []).map((point) => ({ date: point.periodStart, count: point.value }))}
            xKey="date"
            series={[{ key: "count", label: "Enrollments" }]}
            loading={isLoading}
            emptyMessage="No enrollments in this range yet."
            data-testid="enrollment-trend-chart"
          />
        </>
      )}
    </ReportPageShell>
  );
}
EnrollmentTrendDashboard.displayName = "EnrollmentTrendDashboard";
