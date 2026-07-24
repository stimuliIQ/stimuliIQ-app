// WS-A3 Lead funnel / conversion dashboard — docs/specs/phase-7-analytics-hardening.md
// AC-10..13. Permissions: reports.funnel.view (scope: all|branch|own — own-scope
// resolved server-side from the session for Counsellors, never a client param).
import * as React from "react";
import { FunnelChart, KpiCard, Select, SelectItem } from "@repo/ui";
import type { MeResponse } from "@repo/types";
import { Percent } from "lucide-react";

import { useFunnelReport } from "../../hooks/use-reports";
import { useBranchScope } from "../../app/branch-scope";
import { STAGE_LABEL } from "../leads/lead-stage-chip";
import { hasPermission } from "../../lib/permissions";
import { defaultDateRange, isValidDateRange } from "../../lib/report-dates";
import { queryErrorMessage } from "../../lib/surface-error";
import { DateRangeFilter } from "./date-range-filter";
import { ReportErrorState } from "./report-error-state";
import { ReportFreshnessBadge } from "./report-freshness";
import { ReportPageShell } from "./report-page-shell";

export interface FunnelDashboardProps {
  me: MeResponse | undefined;
}

export function FunnelDashboard({ me }: FunnelDashboardProps): React.JSX.Element {
  const canView = hasPermission(me?.permissions, "reports.funnel.view");
  const { branches, canFilterBranch, selectedBranchId: branchId, setSelectedBranchId: setBranchId } =
    useBranchScope();

  const [range, setRange] = React.useState(defaultDateRange(30));

  const rangeValid = isValidDateRange(range.from, range.to);

  const { data, isLoading, isError, error, refetch } = useFunnelReport(
    { from: range.from, to: range.to, branchId },
    canView && rangeValid,
  );

  return (
    <ReportPageShell
      title="Lead funnel"
      description="Lead stage counts and win-rate conversion for the selected range."
      canView={canView}
      data-testid="funnel-dashboard"
    >
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
            data-testid="funnel-branch-filter"
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
          message={queryErrorMessage(error, "Couldn't load the lead funnel dashboard.")}
          onRetry={() => void refetch()}
          data-testid="funnel-dashboard-error"
        />
      ) : (
        <>
          {data ? <ReportFreshnessBadge asOf={data.asOf} stale={data.stale} /> : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard
              label="Total leads"
              value={data ? data.totalLeads : "—"}
              loading={isLoading}
              data-testid="funnel-total-leads-kpi"
            />
            <KpiCard
              label="Won"
              value={data ? data.wonCount : "—"}
              loading={isLoading}
              data-testid="funnel-won-kpi"
            />
            <KpiCard
              label="Conversion rate"
              value={data ? `${(data.conversionRate * 100).toFixed(1)}%` : "—"}
              icon={<Percent />}
              loading={isLoading}
              data-testid="funnel-conversion-kpi"
            />
          </div>

          <FunnelChart
            title="Lead funnel"
            description={`${range.from} – ${range.to}`}
            stages={(data?.stages ?? []).map((s) => ({
              key: s.stage,
              label: STAGE_LABEL[s.stage] ?? s.stage,
              value: s.count,
            }))}
            loading={isLoading}
            emptyMessage="No leads in this range yet."
            data-testid="funnel-chart"
          />
        </>
      )}
    </ReportPageShell>
  );
}
FunnelDashboard.displayName = "FunnelDashboard";
