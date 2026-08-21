// Freshness indicator shared by every Analytics dashboard — docs/plans/phase-7.md
// Wave 3 #14, docs/specs/phase-7-analytics-hardening.md LOCK-D1 + Part 4 edge
// case ("Materialized view has not refreshed" / "refresh job failed"). Every
// report DTO carries `asOf`/`stale` (ReportFreshnessSchema); this component is
// the ONE place that renders it, so no dashboard silently presents a
// last-known-good snapshot as if it were live.
import * as React from "react";
import { StatusChip } from "@repo/ui";

import { formatAsOf } from "../../lib/report-dates";

export interface ReportFreshnessBadgeProps {
  asOf: string;
  stale: boolean;
}

export function ReportFreshnessBadge({ asOf, stale }: ReportFreshnessBadgeProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted" data-testid="report-freshness">
      <span>Data as of {formatAsOf(asOf)}</span>
      {stale ? (
        <StatusChip
          tone="warning"
          label="Stale, showing last known-good data"
          data-testid="report-stale-badge"
        />
      ) : null}
    </div>
  );
}
ReportFreshnessBadge.displayName = "ReportFreshnessBadge";
