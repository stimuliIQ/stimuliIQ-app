// WS-A7 Gamification participation dashboard — docs/specs/phase-7-analytics-hardening.md
// AC-23..25. Permissions: reports.gamification.view (scope: all|assigned).
// STAFF-FACING: `perStudent` rows MAY carry real student names/emails (unlike
// the PII-minimal student leaderboard) — a deliberate, spec-mandated
// divergence (AC-24). Opted-out students are still included (AC-25).
import * as React from "react";
import { DataTable, type DataTableColumn, KpiCard, Select, SelectItem } from "@repo/ui";
import type { GamificationParticipantRow, MeResponse } from "@repo/types";
import { Trophy } from "lucide-react";

import { useGamificationParticipationReport } from "../../hooks/use-reports";
import { useBatchesList } from "../../hooks/use-batches";
import { hasPermission } from "../../lib/permissions";
import { queryErrorMessage } from "../../lib/surface-error";
import { ReportErrorState } from "./report-error-state";
import { ReportFreshnessBadge } from "./report-freshness";
import { ReportPageShell } from "./report-page-shell";

export interface GamificationDashboardProps {
  me: MeResponse | undefined;
}

const COLUMNS: Array<DataTableColumn<GamificationParticipantRow>> = [
  { id: "studentName", header: "Student", cell: (row) => row.studentName },
  { id: "studentEmail", header: "Email", cell: (row) => row.studentEmail ?? "-" },
  { id: "totalXp", header: "Total XP", cell: (row) => row.totalXp, align: "right" },
  { id: "badgeCount", header: "Badges", cell: (row) => row.badgeCount, align: "right" },
];

export function GamificationDashboard({ me }: GamificationDashboardProps): React.JSX.Element {
  const canView = hasPermission(me?.permissions, "reports.gamification.view");

  const [batchId, setBatchId] = React.useState<string | undefined>(undefined);

  const { data: batches } = useBatchesList({ page: 1, pageSize: 200, status: "active", includeDeleted: false });
  const { data, isLoading, isError, error, refetch } = useGamificationParticipationReport(
    { batchId },
    canView,
  );

  return (
    <ReportPageShell
      title="Gamification participation"
      description="Active earners, XP distributed, and badge awards, staff view (names/emails visible)."
      canView={canView}
      data-testid="gamification-dashboard"
    >
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Batch"
          placeholder="All batches"
          value={batchId}
          onValueChange={(value) => setBatchId(value === "__all__" ? undefined : value)}
          wrapperClassName="w-56"
          data-testid="gamification-batch-filter"
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
          message={queryErrorMessage(error, "Couldn't load the gamification dashboard.")}
          onRetry={() => void refetch()}
          data-testid="gamification-dashboard-error"
        />
      ) : (
        <>
          {data ? <ReportFreshnessBadge asOf={data.asOf} stale={data.stale} /> : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard
              label="Active earners"
              value={data ? data.activeEarnersCount : "-"}
              icon={<Trophy />}
              loading={isLoading}
              data-testid="gamification-active-earners-kpi"
            />
            <KpiCard
              label="Total XP distributed"
              value={data ? data.totalXpDistributed : "-"}
              loading={isLoading}
              data-testid="gamification-total-xp-kpi"
            />
            <KpiCard
              label="Badges awarded"
              value={data ? data.badgeAwardCount : "-"}
              loading={isLoading}
              data-testid="gamification-badge-count-kpi"
            />
          </div>

          <DataTable
            columns={COLUMNS}
            rows={data?.perStudent ?? []}
            getRowId={(row) => row.studentId}
            loading={isLoading}
            emptyState={{
              title: "No participation yet",
              description: "No students have earned XP or badges in this scope yet.",
            }}
            caption="Gamification participation by student"
            data-testid="gamification-per-student-table"
          />
        </>
      )}
    </ReportPageShell>
  );
}
GamificationDashboard.displayName = "GamificationDashboard";
