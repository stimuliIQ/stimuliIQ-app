// Analytics ▸ Revenue route — /analytics/revenue. Phase 7 Wave 3, task #14.
// Requires reports.revenue.view (API also enforces server-side).
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { RevenueDashboard } from "../components/analytics/revenue-dashboard";

function AnalyticsRevenuePage() {
  const { me } = useMe();
  return <RevenueDashboard me={me} />;
}

export const analyticsRevenueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics/revenue",
  component: AnalyticsRevenuePage,
});
