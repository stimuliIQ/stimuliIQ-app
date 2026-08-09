// Team performance — the per-rep lead scoreboard.
//
// Every other dashboard in this folder measures the BUSINESS (revenue, funnel,
// engagement). This one measures PEOPLE by name, which changes what the UI owes the
// reader:
//
//   1. It must not silently omit anyone. A rep with a blank week appears with a row of
//      zeros, because a missing row reads as "no data" when it actually means "no work".
//      (The API guarantees this; the table just must not filter.)
//   2. It must not mix time windows without saying so. "Leads created" is counted inside
//      the date range; "Open now" and "Overdue" are a snapshot of this instant. Those two
//      columns are grouped and labelled separately — a manager comparing an as-of-now
//      number against a windowed one draws the wrong conclusion and acts on it.
//   3. It must show the leads that belong to NOBODY. Unassigned and never-contacted leads
//      appear on no rep's row, so without the two KPI tiles at the top they are invisible
//      precisely because no one is accountable for them.
//
// Permission: reports.lead_performance.view (all|branch). Deliberately not held by
// counsellors — see prisma/seed.ts.
import * as React from "react";
import { DataTable, type DataTableColumn, KpiCard, Select, SelectItem } from "@repo/ui";
import type { LeadPerformanceRow, MeResponse } from "@repo/types";
import { AlertTriangle, PhoneOff, Timer } from "lucide-react";

import { useLeadPerformanceReport } from "../../hooks/use-reports";
import { useBranchScope } from "../../app/branch-scope";
import { hasPermission } from "../../lib/permissions";
import { defaultDateRange, isValidDateRange } from "../../lib/report-dates";
import { queryErrorMessage } from "../../lib/surface-error";
import { DateRangeFilter } from "./date-range-filter";
import { ReportErrorState } from "./report-error-state";
import { ReportPageShell } from "./report-page-shell";

export interface LeadPerformanceDashboardProps {
  me: MeResponse | undefined;
}

/** Percentages read as whole numbers here — one decimal implies a precision a 12-lead sample doesn't have. */
function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/**
 * `null` means "nobody assigned in this window has been contacted yet", which must NOT
 * render as 0m — that would read as an instant response, the exact opposite of the truth.
 */
function formatResponseTime(minutes: number | null): React.ReactNode {
  if (minutes === null) return <span className="text-fg-muted">—</span>;
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / (60 * 24))}d`;
}

export function LeadPerformanceDashboard({ me }: LeadPerformanceDashboardProps): React.JSX.Element {
  const canView = hasPermission(me?.permissions, "reports.lead_performance.view");
  const { branches, canFilterBranch, selectedBranchId: branchId, setSelectedBranchId: setBranchId } =
    useBranchScope();

  const [range, setRange] = React.useState(defaultDateRange(30));
  const rangeValid = isValidDateRange(range.from, range.to);

  const { data, isLoading, isError, error, refetch } = useLeadPerformanceReport(
    { from: range.from, to: range.to, branchId },
    canView && rangeValid,
  );

  const columns: Array<DataTableColumn<LeadPerformanceRow>> = [
    {
      id: "userName",
      header: "Staff member",
      cell: (row) => (
        <div className="space-y-0.5">
          <div className="font-medium text-fg">{row.userName}</div>
          <div className="text-xs text-fg-muted">{row.roleKeys.join(", ")}</div>
        </div>
      ),
      sortable: true,
    },
    {
      id: "leadsCreated",
      header: "Created",
      align: "right",
      cell: (row) => row.leadsCreated,
      sortable: true,
    },
    {
      id: "leadsAssigned",
      header: "Assigned",
      align: "right",
      cell: (row) => row.leadsAssigned,
      sortable: true,
    },
    {
      id: "callsLogged",
      header: "Calls",
      align: "right",
      cell: (row) => row.callsLogged,
      sortable: true,
    },
    {
      id: "activitiesLogged",
      header: "All activity",
      align: "right",
      cell: (row) => row.activitiesLogged,
      sortable: true,
    },
    {
      id: "followUpsCompleted",
      header: "Follow-ups done",
      align: "right",
      cell: (row) => row.followUpsCompleted,
      sortable: true,
    },
    {
      id: "contactRate",
      header: "Contacted",
      align: "right",
      // Called at least once out of everything handed to them in the window. The single
      // most diagnostic column: a rep can look busy on activity count while a third of
      // their queue has never been phoned.
      cell: (row) => (
        <span className={row.leadsAssigned > 0 && row.contactRate < 0.5 ? "font-medium text-warning" : undefined}>
          {row.leadsAssigned > 0 ? formatRate(row.contactRate) : "—"}
        </span>
      ),
      sortable: true,
    },
    {
      id: "avgFirstResponseMinutes",
      header: "Avg response",
      align: "right",
      cell: (row) => formatResponseTime(row.avgFirstResponseMinutes),
      sortable: true,
    },
    {
      id: "converted",
      header: "Converted",
      align: "right",
      cell: (row) => row.converted,
      sortable: true,
    },
    {
      id: "conversionRate",
      header: "Conv. rate",
      align: "right",
      cell: (row) => (row.leadsAssigned > 0 ? formatRate(row.conversionRate) : "—"),
      sortable: true,
    },
    {
      id: "openLeads",
      header: "Open now",
      align: "right",
      cell: (row) => row.openLeads,
      sortable: true,
    },
    {
      id: "overdueFollowUps",
      header: "Overdue now",
      align: "right",
      cell: (row) => (
        <span className={row.overdueFollowUps > 0 ? "font-medium text-warning" : undefined}>
          {row.overdueFollowUps}
        </span>
      ),
      sortable: true,
    },
  ];

  return (
    <ReportPageShell
      title="Team performance"
      description="Per-person lead activity: who created, called, followed up, and converted."
      canView={canView}
      data-testid="lead-performance-dashboard"
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
            data-testid="lead-performance-branch-filter"
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
          message={queryErrorMessage(error, "Couldn't load the team performance report.")}
          onRetry={() => void refetch()}
          data-testid="lead-performance-error"
        />
      ) : (
        <>
          {/* The two tiles on the right belong to nobody's row — they are the leads that
              fall between reps, and they are the reason this report exists at all. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Leads created"
              value={data ? data.totalLeadsCreated : "—"}
              loading={isLoading}
              data-testid="lead-performance-created-kpi"
            />
            <KpiCard
              label="Converted"
              value={data ? data.totalConverted : "—"}
              loading={isLoading}
              data-testid="lead-performance-converted-kpi"
            />
            <KpiCard
              label="Unassigned right now"
              value={data ? data.unassignedLeads : "—"}
              icon={<AlertTriangle />}
              loading={isLoading}
              data-testid="lead-performance-unassigned-kpi"
            />
            <KpiCard
              label="Never contacted"
              value={data ? data.uncontactedLeads : "—"}
              icon={<PhoneOff />}
              loading={isLoading}
              data-testid="lead-performance-uncontacted-kpi"
            />
          </div>

          <p className="flex items-start gap-1.5 text-xs text-fg-muted">
            <Timer className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Created, Assigned, Calls, Follow-ups, Converted and Avg response cover {range.from} – {range.to}.{" "}
              <strong className="font-medium text-fg">Open now</strong> and{" "}
              <strong className="font-medium text-fg">Overdue now</strong> are a snapshot of this moment and ignore the
              date range. Activity counts include work logged against students as well as leads.
            </span>
          </p>

          <DataTable
            columns={columns}
            rows={data?.rows ?? []}
            getRowId={(row) => row.userId}
            loading={isLoading}
            emptyState={{
              title: "No staff can own leads yet",
              description: "Give a staff member the counsellor or marketing role to see them here.",
            }}
            caption="Lead performance by staff member"
            data-testid="lead-performance-table"
          />
        </>
      )}
    </ReportPageShell>
  );
}
LeadPerformanceDashboard.displayName = "LeadPerformanceDashboard";
