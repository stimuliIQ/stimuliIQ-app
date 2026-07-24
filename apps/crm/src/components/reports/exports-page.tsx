// Analytics ▸ Exports page — docs/plans/phase-7.md Wave 3 task #15.
// RBAC-gated behind `reports.export` (AC-34) — same ReportPageShell chrome
// (title + description + access-denied empty state) used by the 8 WS-A
// dashboards, for a consistent Analytics section.
import * as React from "react";
import type { MeResponse } from "@repo/types";

import { hasPermission } from "../../lib/permissions";
import { ReportPageShell } from "../analytics/report-page-shell";
import { ExportJobsList } from "./export-jobs-list";

export interface ExportsPageProps {
  me: MeResponse | undefined;
}

export function ExportsPage({ me }: ExportsPageProps): React.JSX.Element {
  const canExport = hasPermission(me?.permissions, "reports.export");

  return (
    <ReportPageShell
      title="Exports"
      description="On-demand CSV/PDF exports of any dashboard or list you can already see, plus their download history."
      canView={canExport}
      data-testid="exports-page"
    >
      <ExportJobsList />
    </ReportPageShell>
  );
}
ExportsPage.displayName = "ExportsPage";
