// WS-A6 Campaign performance dashboard — docs/specs/phase-7-analytics-hardening.md
// AC-20..22. Permissions: reports.campaigns.view (all-scope; reuses campaigns.view).
// `campaignId` is mandatory server-side — the dashboard prompts for one before
// firing any query. `metrics` reuses `CampaignMetricsDto` verbatim, matching
// `campaigns.metrics` exactly (no separate recount drift, AC-20).
import * as React from "react";
import { DonutChart, EmptyState, KpiCard, Select, SelectItem } from "@repo/ui";
import type { MeResponse } from "@repo/types";
import { Megaphone } from "lucide-react";

import { useCampaignPerformanceReport } from "../../hooks/use-reports";
import { useCampaignsList } from "../../hooks/use-campaigns";
import { hasPermission } from "../../lib/permissions";
import { queryErrorMessage } from "../../lib/surface-error";
import { ReportErrorState } from "./report-error-state";
import { ReportFreshnessBadge } from "./report-freshness";
import { ReportPageShell } from "./report-page-shell";

export interface CampaignPerformanceDashboardProps {
  me: MeResponse | undefined;
}

export function CampaignPerformanceDashboard({ me }: CampaignPerformanceDashboardProps): React.JSX.Element {
  const canView = hasPermission(me?.permissions, "reports.campaigns.view");

  const [campaignId, setCampaignId] = React.useState<string | undefined>(undefined);

  const { data: campaigns } = useCampaignsList({ page: 1, pageSize: 200 });
  const { data, isLoading, isError, error, refetch } = useCampaignPerformanceReport(
    campaignId ? { campaignId } : undefined,
    canView,
  );

  return (
    <ReportPageShell
      title="Campaign performance"
      description="Sent / delivered / read / failed counts for a chosen campaign."
      canView={canView}
      data-testid="campaign-performance-dashboard"
    >
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Campaign"
          placeholder="Select a campaign"
          value={campaignId}
          onValueChange={setCampaignId}
          wrapperClassName="w-64"
          data-testid="campaign-performance-filter"
        >
          {(campaigns?.items ?? []).map((campaign) => (
            <SelectItem key={campaign.id} value={campaign.id}>
              {campaign.name}
            </SelectItem>
          ))}
        </Select>
      </div>

      {!campaignId ? (
        <EmptyState
          icon={<Megaphone />}
          title="Select a campaign"
          description="Choose a campaign above to see its delivery performance."
          data-testid="campaign-performance-dashboard-empty"
        />
      ) : isError ? (
        <ReportErrorState
          message={queryErrorMessage(error, "Couldn't load campaign performance.")}
          onRetry={() => void refetch()}
          data-testid="campaign-performance-dashboard-error"
        />
      ) : (
        <>
          {data ? <ReportFreshnessBadge asOf={data.asOf} stale={data.stale} /> : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Sent"
              value={data ? data.metrics.sent : "-"}
              loading={isLoading}
              data-testid="campaign-sent-kpi"
            />
            <KpiCard
              label="Delivered"
              value={data ? data.metrics.delivered : "-"}
              loading={isLoading}
              data-testid="campaign-delivered-kpi"
            />
            <KpiCard
              label="Read"
              value={data ? data.metrics.read : "-"}
              loading={isLoading}
              data-testid="campaign-read-kpi"
            />
            <KpiCard
              label="Failed"
              value={data ? data.metrics.failed : "-"}
              loading={isLoading}
              data-testid="campaign-failed-kpi"
            />
          </div>

          <DonutChart
            title={data ? `${data.campaignName}, delivery mix` : "Delivery mix"}
            data={
              data
                ? [
                    { key: "delivered", label: "Delivered", value: data.metrics.delivered },
                    { key: "read", label: "Read", value: data.metrics.read },
                    { key: "queued", label: "Queued", value: data.metrics.queued },
                    { key: "failed", label: "Failed", value: data.metrics.failed },
                  ]
                : []
            }
            totalLabel="Total recipients"
            loading={isLoading}
            emptyMessage="No recipients for this campaign yet."
            data-testid="campaign-performance-donut"
          />
        </>
      )}
    </ReportPageShell>
  );
}
CampaignPerformanceDashboard.displayName = "CampaignPerformanceDashboard";
