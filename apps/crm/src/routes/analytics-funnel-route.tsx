// Analytics ▸ Lead funnel route — /analytics/funnel. Phase 7 Wave 3, task #14.
// Requires reports.funnel.view (API also enforces server-side).
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { FunnelDashboard } from "../components/analytics/funnel-dashboard";

function AnalyticsFunnelPage() {
  const { me } = useMe();
  return <FunnelDashboard me={me} />;
}

export const analyticsFunnelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics/funnel",
  component: AnalyticsFunnelPage,
});
