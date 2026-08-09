// Analytics ▸ Team performance route — /analytics/lead-performance.
// Requires reports.lead_performance.view (the API enforces it server-side; the shell
// renders a "no access" state rather than an empty table if the permission is absent).
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { LeadPerformanceDashboard } from "../components/analytics/lead-performance-dashboard";

function AnalyticsLeadPerformancePage() {
  const { me } = useMe();
  return <LeadPerformanceDashboard me={me} />;
}

export const analyticsLeadPerformanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics/lead-performance",
  component: AnalyticsLeadPerformancePage,
});
