// Analytics ▸ Scheduled Reports route — /analytics/schedules. Phase 7 Wave
// 3, task #15. Requires reports.schedule (API also enforces server-side).
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { ReportSchedulesPage } from "../components/reports/report-schedules-page";

function AnalyticsSchedulesPage() {
  const { me } = useMe();
  return <ReportSchedulesPage me={me} />;
}

export const analyticsSchedulesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics/schedules",
  component: AnalyticsSchedulesPage,
});
