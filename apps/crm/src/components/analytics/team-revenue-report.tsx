// Team revenue — what each team brought in over the window.
//
// The revenue dashboard answers "what did the company earn". This answers "who earned it",
// rolled up the org chart: a member belongs to a person, that person belongs to a team, the
// team's revenue is the sum. Before member ownership existed, revenue could only be traced
// through `leads.owner_id`, so anybody enrolled through the onboarding form counted for
// nobody at all.
//
// THE TWO UNATTRIBUTED TILES ARE THE POINT OF THE SCREEN, not a footnote.
//
// They carry money that belongs to no team: members nobody owns, and members whose owner is
// on no team. Together with the rows they add up to the company total, so the reader can
// trust that nothing quietly vanished. Hiding them when they are zero would be worse than
// useless — the reader could not tell "everything is attributed" from "this screen doesn't
// show me that", which is precisely the doubt the tiles exist to remove. So they render at
// zero, and gain a nudge only when there is something to act on. The nudge names the CHORE
// ("needs tagging") rather than just colouring the number red, because a red number leaves
// the reader to guess what would fix it.
//
// They are also split rather than merged, because they are different chores for different
// people: "tag these members" is the intake queue's job, "put that person on a team" is the
// org chart's.
import * as React from "react";
import { DataTable, type DataTableColumn, KpiCard } from "@repo/ui";
import type { MeResponse, TeamRevenueRow } from "@repo/types";
import { UserX, Users } from "lucide-react";

import { useTeamRevenueReport } from "../../hooks/use-reports";
import { hasPermission } from "../../lib/permissions";
import { defaultDateRange, isValidDateRange } from "../../lib/report-dates";
import { queryErrorMessage } from "../../lib/surface-error";
import { DateRangeFilter } from "./date-range-filter";
import { ReportErrorState } from "./report-error-state";
import { ReportPageShell } from "./report-page-shell";

export interface TeamRevenueReportProps {
  me: MeResponse | undefined;
}

/** ₹1,25,000 from 12_500_000 paise. Money is integer minor units end to end (CLAUDE.md §3.6). */
export function formatPaiseCompact(paise: number, currency: string): string {
  const amount = Math.round(paise / 100).toLocaleString("en-IN");
  return currency && currency !== "INR" ? `${currency} ${amount}` : `₹${amount}`;
}

export function TeamRevenueReport({ me }: TeamRevenueReportProps): React.JSX.Element {
  // The same key as the revenue dashboard: this is that money, split by team. A dedicated
  // key would let somebody hold one view and not the other while both answer the same
  // question.
  const canView = hasPermission(me?.permissions, "reports.revenue.view");

  const [range, setRange] = React.useState(defaultDateRange(30));
  const rangeValid = isValidDateRange(range.from, range.to);

  const { data, isLoading, isError, error, refetch } = useTeamRevenueReport(
    { from: range.from, to: range.to },
    canView && rangeValid,
  );

  const currency = data?.currency ?? "INR";

  const columns: Array<DataTableColumn<TeamRevenueRow>> = [
    {
      id: "teamName",
      header: "Team",
      cell: (row) => (
        <div className="space-y-0.5">
          <div className="font-medium text-fg">{row.teamName}</div>
          <div className="text-xs text-fg-muted">
            {/* A team is routinely created before it is staffed, so both posts can be vacant.
                "Not set" states that plainly rather than rendering an empty cell somebody has
                to interpret. */}
            {row.managerName ? `Manager: ${row.managerName}` : "Manager: not set"}
            {row.leadName ? ` · Lead: ${row.leadName}` : ""}
          </div>
        </div>
      ),
      sortable: true,
    },
    {
      id: "staffCount",
      header: "People",
      align: "right",
      cell: (row) => row.staffCount,
      sortable: true,
    },
    {
      id: "membersOwned",
      header: "Members owned",
      align: "right",
      // Deliberately labelled as a snapshot in the header note below the table: it is the
      // book as it stands, not something that happened inside the window. Mixing a windowed
      // and an as-of-now number in one row without saying so is how a scoreboard starts
      // lying, the same trap the lead-performance report calls out.
      cell: (row) => row.membersOwned,
      sortable: true,
    },
    {
      id: "payingMembers",
      header: "Paid in range",
      align: "right",
      cell: (row) => row.payingMembers,
      sortable: true,
    },
    {
      id: "revenuePaise",
      header: "Revenue",
      align: "right",
      cell: (row) => (
        <span className="font-medium">{formatPaiseCompact(row.revenuePaise, currency)}</span>
      ),
      sortable: true,
    },
  ];

  return (
    <ReportPageShell
      title="Team revenue"
      description="What each team brought in, rolled up from the members its people own."
      canView={canView}
      data-testid="team-revenue-report"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <DateRangeFilter
          from={range.from}
          to={range.to}
          onFromChange={(from) => setRange((r) => ({ ...r, from }))}
          onToChange={(to) => setRange((r) => ({ ...r, to }))}
          invalid={!rangeValid}
        />
      </div>

      {isError ? (
        <ReportErrorState
          message={queryErrorMessage(error, "Couldn't load the team revenue report.")}
          onRetry={() => void refetch()}
          data-testid="team-revenue-error"
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard
              label="Total revenue"
              value={data ? formatPaiseCompact(data.totalRevenuePaise, currency) : "-"}
              loading={isLoading}
              data-testid="team-revenue-total-kpi"
            />
            {/* Rendered at zero rather than hidden: the reader must be able to tell
                "everything is attributed" from "this screen doesn't show me that". */}
            <KpiCard
              label="From untagged members"
              value={data ? formatPaiseCompact(data.unownedRevenuePaise, currency) : "-"}
              icon={<UserX />}
              // The nudge says what to DO, not merely that something is off. "needs tagging"
              // names the chore and whose it is; a red number alone leaves the reader to guess.
              delta={data && data.unownedRevenuePaise > 0 ? "needs tagging" : undefined}
              trendTone="danger"
              loading={isLoading}
              data-testid="team-revenue-unowned-kpi"
            />
            <KpiCard
              label="Owner on no team"
              value={data ? formatPaiseCompact(data.unteamedRevenuePaise, currency) : "-"}
              icon={<Users />}
              delta={data && data.unteamedRevenuePaise > 0 ? "owner needs a team" : undefined}
              trendTone="danger"
              loading={isLoading}
              data-testid="team-revenue-unteamed-kpi"
            />
          </div>

          <DataTable
            rows={data?.rows ?? []}
            getRowId={(row) => row.teamId}
            columns={columns}
            loading={isLoading}
            emptyState={{
              title: "No teams yet",
              description: "Create teams under Organisation to see revenue split by team.",
            }}
            caption="Revenue by team"
            data-testid="team-revenue-table"
          />

          <p className="text-xs text-fg-muted">
            Revenue and &ldquo;paid in range&rdquo; count captured payments inside the dates above,
            gross of refunds, matching the revenue dashboard. &ldquo;Members owned&rdquo; and
            &ldquo;people&rdquo; are a snapshot of right now.
          </p>
        </>
      )}
    </ReportPageShell>
  );
}
