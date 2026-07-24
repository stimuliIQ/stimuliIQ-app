// Analytics ▸ Course/video engagement route — /analytics/engagement. Phase 7 Wave 3, task #14.
// Requires reports.engagement.view (API also enforces server-side).
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { EngagementDashboard } from "../components/analytics/engagement-dashboard";

function AnalyticsEngagementPage() {
  const { me } = useMe();
  return <EngagementDashboard me={me} />;
}

export const analyticsEngagementRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics/engagement",
  component: AnalyticsEngagementPage,
});
