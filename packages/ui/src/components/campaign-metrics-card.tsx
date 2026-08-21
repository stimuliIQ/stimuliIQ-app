import * as React from "react";
import { Send, MailOpen, CheckCheck, AlertCircle } from "lucide-react";

import { cn } from "../lib/cn";
import { Skeleton } from "./skeleton";

/**
 * CampaignMetricsCard — aggregate delivery/open/read metrics for a sent campaign.
 * Per docs/03-prd-crm.md §7.13, docs/06 §13, docs/07 §5.
 *
 * Design rules:
 * - Status conveyed by icon + label + number, never color alone.
 * - All rates are shown as both percentage (relative) and absolute count.
 * - Loading and error states are first-class.
 * - Accessible: each metric cell has an aria-label that includes both number and label.
 *
 * Usage:
 *   <CampaignMetricsCard
 *     totalRecipients={500}
 *     sent={492}
 *     delivered={480}
 *     opened={240}
 *     failed={8}
 *     loading={false}
 *   />
 */

export interface CampaignMetrics {
  totalRecipients: number;
  /** Messages successfully handed to the provider. */
  sent: number;
  /** Provider confirmed delivery. */
  delivered?: number;
  /** Recipient opened / read the message. */
  opened?: number;
  /** Send failures (invalid address, provider error, suppressed, etc.). */
  failed?: number;
}

export interface CampaignMetricsCardProps extends Partial<CampaignMetrics> {
  totalRecipients?: number;
  loading?: boolean;
  error?: string;
  /** Optional campaign name for the card heading context. */
  campaignName?: string;
  className?: string;
  /** Test hook; defaults to "campaign-metrics-card". */
  "data-testid"?: string;
}

function pct(num: number | undefined, denom: number): string {
  if (!denom || num === undefined) return "-";
  return `${Math.round((num / denom) * 100)}%`;
}

function MetricCell({
  icon: Icon,
  label,
  value,
  subLabel,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  subLabel?: string;
  tone?: "default" | "success" | "warning" | "danger";
}): React.JSX.Element {
  const toneColor = {
    default: "text-fg",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
  }[tone ?? "default"];

  return (
    <div
      className="flex flex-col gap-1 rounded-md border border-border bg-surface px-4 py-3"
      aria-label={`${label}: ${value}${subLabel ? ` (${subLabel})` : ""}`}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        {label}
      </div>
      <p className={cn("text-2xl font-bold tabular-nums", toneColor)} aria-hidden="true">
        {value}
      </p>
      {subLabel ? (
        <p aria-hidden="true" className="text-xs text-fg-muted">{subLabel}</p>
      ) : null}
    </div>
  );
}

export function CampaignMetricsCard({
  totalRecipients = 0,
  sent,
  delivered,
  opened,
  failed,
  loading = false,
  error,
  campaignName,
  className,
  "data-testid": testId,
}: CampaignMetricsCardProps): React.JSX.Element {
  if (loading) {
    return (
      <div
        data-testid={testId ?? "campaign-metrics-card"}
        className={cn("rounded-lg border border-border bg-card p-4", className)}
        aria-busy="true"
        aria-label="Loading campaign metrics"
      >
        <Skeleton shape="line" className="mb-4 h-5 w-1/3" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} shape="line" className="h-20" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-testid={testId ?? "campaign-metrics-card"}
        role="alert"
        className={cn(
          "rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger",
          className,
        )}
      >
        {error}
      </div>
    );
  }

  return (
    <section
      data-testid={testId ?? "campaign-metrics-card"}
      aria-label={campaignName ? `${campaignName}, Campaign metrics` : "Campaign metrics"}
      className={cn("rounded-lg border border-border bg-card p-4", className)}
    >
      {campaignName ? (
        <h3 className="mb-4 text-sm font-semibold text-fg">{campaignName}</h3>
      ) : (
        <h3 className="sr-only">Campaign metrics</h3>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCell
          icon={Send}
          label="Sent"
          value={sent !== undefined ? sent : totalRecipients}
          subLabel={`of ${totalRecipients} recipients`}
          tone="default"
        />
        <MetricCell
          icon={CheckCheck}
          label="Delivered"
          value={delivered !== undefined ? delivered : "-"}
          subLabel={delivered !== undefined ? pct(delivered, totalRecipients) + " delivery rate" : undefined}
          tone={delivered !== undefined ? "success" : "default"}
        />
        <MetricCell
          icon={MailOpen}
          label="Opened / Read"
          value={opened !== undefined ? opened : "-"}
          subLabel={opened !== undefined ? pct(opened, sent ?? totalRecipients) + " open rate" : undefined}
          tone={opened !== undefined ? "success" : "default"}
        />
        <MetricCell
          icon={AlertCircle}
          label="Failed"
          value={failed !== undefined ? failed : "-"}
          subLabel={failed !== undefined ? pct(failed, totalRecipients) + " failure rate" : undefined}
          tone={
            failed === undefined
              ? "default"
              : failed === 0
                ? "success"
                : failed / totalRecipients > 0.1
                  ? "danger"
                  : "warning"
          }
        />
      </div>
    </section>
  );
}
