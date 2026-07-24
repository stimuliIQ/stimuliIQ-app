// Analytics ▸ Enrollment trend route — /analytics/enrollment. Phase 7 Wave 3, task #14.
// Requires reports.enrollment.view (API also enforces server-side).
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { EnrollmentTrendDashboard } from "../components/analytics/enrollment-trend-dashboard";

function AnalyticsEnrollmentPage() {
  const { me } = useMe();
  return <EnrollmentTrendDashboard me={me} />;
}

export const analyticsEnrollmentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics/enrollment",
  component: AnalyticsEnrollmentPage,
});
