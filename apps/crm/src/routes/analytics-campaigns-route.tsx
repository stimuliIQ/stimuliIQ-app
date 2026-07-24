// Analytics ▸ Campaign performance route — /analytics/campaigns. Phase 7 Wave 3, task #14.
// Requires reports.campaigns.view (API also enforces server-side).
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { CampaignPerformanceDashboard } from "../components/analytics/campaign-performance-dashboard";

function AnalyticsCampaignsPage() {
  const { me } = useMe();
  return <CampaignPerformanceDashboard me={me} />;
}

export const analyticsCampaignsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics/campaigns",
  component: AnalyticsCampaignsPage,
});
