// Analytics ▸ Team revenue route — /analytics/team-revenue.
//
// Requires `reports.revenue.view`, the same key as the revenue dashboard: this is that money
// split by team, and a dedicated key would let somebody hold one view and not the other while
// both answer the same question. The API enforces it server-side; the shell renders a
// "no access" state rather than an empty table if the permission is absent.
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { TeamRevenueReport } from "../components/analytics/team-revenue-report";

function AnalyticsTeamRevenuePage() {
  const { me } = useMe();
  return <TeamRevenueReport me={me} />;
}

export const analyticsTeamRevenueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics/team-revenue",
  component: AnalyticsTeamRevenuePage,
});
