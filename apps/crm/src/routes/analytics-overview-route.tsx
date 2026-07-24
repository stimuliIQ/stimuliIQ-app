// Analytics landing route — /analytics. Phase 7 Wave 3, task #14.
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { AnalyticsOverview } from "../components/analytics/analytics-overview";

function AnalyticsOverviewPage() {
  const { me } = useMe();
  return <AnalyticsOverview me={me} />;
}

export const analyticsOverviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics",
  component: AnalyticsOverviewPage,
});
