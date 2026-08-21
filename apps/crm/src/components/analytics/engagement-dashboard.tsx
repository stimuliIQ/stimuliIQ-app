// WS-A5 Course/video engagement dashboard — docs/specs/phase-7-analytics-hardening.md
// AC-17..19. Permissions: reports.engagement.view (scope: all|branch|assigned).
// `programId` is mandatory server-side — the dashboard prompts for one before
// firing any query (AC-19: Faculty additionally narrows to an assigned batch;
// the batch picker only ever lists batches the caller can see).
import * as React from "react";
import { BarChart, EmptyState, Select, SelectItem } from "@repo/ui";
import type { MeResponse } from "@repo/types";
import { BookOpenCheck } from "lucide-react";

import { useEngagementReport } from "../../hooks/use-reports";
import { useBatchesList } from "../../hooks/use-batches";
import { useProgramsList } from "../../hooks/use-courses";
import { hasPermission } from "../../lib/permissions";
import { queryErrorMessage } from "../../lib/surface-error";
import { ReportErrorState } from "./report-error-state";
import { ReportFreshnessBadge } from "./report-freshness";
import { ReportPageShell } from "./report-page-shell";

export interface EngagementDashboardProps {
  me: MeResponse | undefined;
}

export function EngagementDashboard({ me }: EngagementDashboardProps): React.JSX.Element {
  const canView = hasPermission(me?.permissions, "reports.engagement.view");

  const [programId, setProgramId] = React.useState<string | undefined>(undefined);
  const [batchId, setBatchId] = React.useState<string | undefined>(undefined);

  const { data: programs } = useProgramsList({ page: 1, pageSize: 200, includeDeleted: false });
  const { data: batches } = useBatchesList({ page: 1, pageSize: 200, programId, status: "active", includeDeleted: false });

  const { data, isLoading, isError, error, refetch } = useEngagementReport(
    programId ? { programId, batchId } : undefined,
    canView,
  );

  return (
    <ReportPageShell
      title="Course / video engagement"
      description="Per-lesson completion in curriculum order, with drop-off points surfaced."
      canView={canView}
      data-testid="engagement-dashboard"
    >
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Program"
          placeholder="Select a program"
          value={programId}
          onValueChange={(value) => {
            setProgramId(value);
            setBatchId(undefined);
          }}
          wrapperClassName="w-56"
          data-testid="engagement-program-filter"
        >
          {(programs?.items ?? []).map((program) => (
            <SelectItem key={program.id} value={program.id}>
              {program.title}
            </SelectItem>
          ))}
        </Select>
        <Select
          label="Batch"
          placeholder="All batches for this program"
          value={batchId}
          onValueChange={(value) => setBatchId(value === "__all__" ? undefined : value)}
          wrapperClassName="w-56"
          data-testid="engagement-batch-filter"
          disabled={!programId}
        >
          <SelectItem value="__all__">All batches</SelectItem>
          {(batches?.items ?? []).map((batch) => (
            <SelectItem key={batch.id} value={batch.id}>
              {batch.name}
            </SelectItem>
          ))}
        </Select>
      </div>

      {!programId ? (
        <EmptyState
          icon={<BookOpenCheck />}
          title="Select a program"
          description="Choose a program above to see lesson-by-lesson completion and drop-off."
          data-testid="engagement-dashboard-empty"
        />
      ) : isError ? (
        <ReportErrorState
          message={queryErrorMessage(error, "Couldn't load the engagement dashboard.")}
          onRetry={() => void refetch()}
          data-testid="engagement-dashboard-error"
        />
      ) : (
        <>
          {data ? <ReportFreshnessBadge asOf={data.asOf} stale={data.stale} /> : null}

          <BarChart
            title="Lesson completion"
            description="Curriculum order. A materially lower bar than its predecessor marks a drop-off."
            data={(data?.lessons ?? []).map((lesson) => ({
              lesson: lesson.title,
              completion: lesson.completionPercent,
            }))}
            categoryKey="lesson"
            categoryLabel="Lesson"
            series={[{ key: "completion", label: "Completion %" }]}
            orientation="horizontal"
            valueFormatter={(v) => `${v.toFixed(1)}%`}
            loading={isLoading}
            emptyMessage="This program has no lessons yet."
            data-testid="engagement-completion-chart"
          />
        </>
      )}
    </ReportPageShell>
  );
}
EngagementDashboard.displayName = "EngagementDashboard";
