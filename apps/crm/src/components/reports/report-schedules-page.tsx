// Analytics ▸ Scheduled Reports page — docs/plans/phase-7.md Wave 3 task
// #15. RBAC-gated behind `reports.schedule`, same ReportPageShell chrome as
// every other Analytics surface.
import * as React from "react";
import type { MeResponse } from "@repo/types";

import { hasPermission } from "../../lib/permissions";
import { ReportPageShell } from "../analytics/report-page-shell";
import { ReportSchedulesList } from "./report-schedules-list";

export interface ReportSchedulesPageProps {
  me: MeResponse | undefined;
}

export function ReportSchedulesPage({ me }: ReportSchedulesPageProps): React.JSX.Element {
  const canSchedule = hasPermission(me?.permissions, "reports.schedule");

  return (
    <ReportPageShell
      title="Scheduled reports"
      description="Recurring CSV/PDF report emails — daily, weekly, or monthly."
      canView={canSchedule}
      data-testid="report-schedules-page"
    >
      <ReportSchedulesList />
    </ReportPageShell>
  );
}
ReportSchedulesPage.displayName = "ReportSchedulesPage";
