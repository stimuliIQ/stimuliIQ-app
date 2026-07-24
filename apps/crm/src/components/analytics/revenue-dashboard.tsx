// WS-A1 Revenue dashboard — docs/specs/phase-7-analytics-hardening.md AC-1..6.
// Permissions: reports.revenue.view (scope: all|branch, server-enforced).
import * as React from "react";
import { AreaChart, BarChart, KpiCard, Select, SelectItem, formatPaise } from "@repo/ui";
import type { MeResponse } from "@repo/types";
import { DollarSign } from "lucide-react";

import { useRevenueReport } from "../../hooks/use-reports";
import { useBranchScope } from "../../app/branch-scope";
import { hasPermission } from "../../lib/permissions";
import { defaultDateRange, isValidDateRange } from "../../lib/report-dates";
import { queryErrorMessage } from "../../lib/surface-error";
import { DateRangeFilter } from "./date-range-filter";
import { ReportErrorState } from "./report-error-state";
import { ReportFreshnessBadge } from "./report-freshness";
import { ReportPageShell } from "./report-page-shell";

export interface RevenueDashboardProps {
  me: MeResponse | undefined;
}

export function RevenueDashboard({ me }: RevenueDashboardProps): React.JSX.Element {
  const canView = hasPermission(me?.permissions, "reports.revenue.view");
  const { branches, canFilterBranch, selectedBranchId: branchId, setSelectedBranchId: setBranchId } =
    useBranchScope();

  const [range, setRange] = React.useState(defaultDateRange(30));

  const rangeValid = isValidDateRange(range.from, range.to);

  const { data, isLoading, isError, error, refetch } = useRevenueReport(
    { from: range.from, to: range.to, branchId },
    canView && rangeValid,
  );

  const filters = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <DateRangeFilter
        from={range.from}
        to={range.to}
        onFromChange={(from) => setRange((r) => ({ ...r, from }))}
        onToChange={(to) => setRange((r) => ({ ...r, to }))}
        invalid={!rangeValid}
      />
      {canFilterBranch ? (
        <Select
          label="Branch"
          placeholder="All branches"
          value={branchId}
          onValueChange={(value) => setBranchId(value === "__all__" ? undefined : value)}
          wrapperClassName="w-48"
          data-testid="revenue-branch-filter"
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
  );

  return (
    <ReportPageShell
      title="Revenue"
      description="Captured payments reconciled to the payments ledger for the selected range."
      canView={canView}
      data-testid="revenue-dashboard"
    >
      {filters}

      {isError ? (
        <ReportErrorState
          message={queryErrorMessage(error, "Couldn't load the revenue dashboard.")}
          onRetry={() => void refetch()}
          data-testid="revenue-dashboard-error"
        />
      ) : (
        <>
          {data ? <ReportFreshnessBadge asOf={data.asOf} stale={data.stale} /> : null}

          <div className="grid max-w-xs grid-cols-1 gap-4">
            <KpiCard
              label={`Total revenue (${range.from} to ${range.to})`}
              value={data ? formatPaise(data.totalPaise) : "—"}
              icon={<DollarSign />}
              loading={isLoading}
              data-testid="revenue-total-kpi"
            />
          </div>

          <AreaChart
            title="Revenue trend"
            description={`${range.from} – ${range.to}`}
            data={(data?.series ?? []).map((point) => ({ date: point.periodStart, amount: point.amountPaise }))}
            xKey="date"
            series={[{ key: "amount", label: "Revenue" }]}
            valueFormatter={(v) => formatPaise(v)}
            loading={isLoading}
            emptyMessage="No captured payments in this range yet."
            data-testid="revenue-trend-chart"
          />

          <BarChart
            title="Revenue by program"
            orientation="horizontal"
            data={(data?.byProgram ?? []).map((row) => ({ program: row.programTitle, amount: row.amountPaise }))}
            categoryKey="program"
            categoryLabel="Program"
            series={[{ key: "amount", label: "Revenue" }]}
            valueFormatter={(v) => formatPaise(v)}
            loading={isLoading}
            emptyMessage="No revenue breakdown for this range yet."
            data-testid="revenue-by-program-chart"
          />
        </>
      )}
    </ReportPageShell>
  );
}
RevenueDashboard.displayName = "RevenueDashboard";
