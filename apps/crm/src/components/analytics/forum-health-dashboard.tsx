// WS-A8 Forum health dashboard — docs/specs/phase-7-analytics-hardening.md AC-26..27.
// Permissions: reports.forum.view (scope: all|assigned).
import * as React from "react";
import { KpiCard, Select, SelectItem } from "@repo/ui";
import type { MeResponse } from "@repo/types";
import { MessagesSquare } from "lucide-react";

import { useForumHealthReport } from "../../hooks/use-reports";
import { useBatchesList } from "../../hooks/use-batches";
import { hasPermission } from "../../lib/permissions";
import { queryErrorMessage } from "../../lib/surface-error";
import { ReportErrorState } from "./report-error-state";
import { ReportFreshnessBadge } from "./report-freshness";
import { ReportPageShell } from "./report-page-shell";

export interface ForumHealthDashboardProps {
  me: MeResponse | undefined;
}

export function ForumHealthDashboard({ me }: ForumHealthDashboardProps): React.JSX.Element {
  const canView = hasPermission(me?.permissions, "reports.forum.view");

  const [batchId, setBatchId] = React.useState<string | undefined>(undefined);

  const { data: batches } = useBatchesList({ page: 1, pageSize: 200, status: "active", includeDeleted: false });
  const { data, isLoading, isError, error, refetch } = useForumHealthReport({ batchId }, canView);

  return (
    <ReportPageShell
      title="Forum health"
      description="Thread/post volume, reply rate, and resolution rate for a batch's forum activity."
      canView={canView}
      data-testid="forum-health-dashboard"
    >
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Batch"
          placeholder="All batches"
          value={batchId}
          onValueChange={(value) => setBatchId(value === "__all__" ? undefined : value)}
          wrapperClassName="w-56"
          data-testid="forum-health-batch-filter"
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
          message={queryErrorMessage(error, "Couldn't load the forum health dashboard.")}
          onRetry={() => void refetch()}
          data-testid="forum-health-dashboard-error"
        />
      ) : (
        <>
          {data ? <ReportFreshnessBadge asOf={data.asOf} stale={data.stale} /> : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Threads"
              value={data ? data.threadCount : "—"}
              icon={<MessagesSquare />}
              loading={isLoading}
              data-testid="forum-thread-count-kpi"
            />
            <KpiCard
              label="Posts"
              value={data ? data.postCount : "—"}
              loading={isLoading}
              data-testid="forum-post-count-kpi"
            />
            <KpiCard
              label="Reply rate"
              value={data ? `${data.replyRate.toFixed(1)} posts/thread` : "—"}
              loading={isLoading}
              data-testid="forum-reply-rate-kpi"
            />
            <KpiCard
              label="Resolution rate"
              value={data ? `${(data.resolutionRate * 100).toFixed(1)}%` : "—"}
              loading={isLoading}
              data-testid="forum-resolution-rate-kpi"
            />
          </div>
        </>
      )}
    </ReportPageShell>
  );
}
ForumHealthDashboard.displayName = "ForumHealthDashboard";
