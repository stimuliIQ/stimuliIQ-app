// Dashboard route ("/") — docs/03 §7.1/§13. Phase 9 Completion T37
// (docs/plans/phase-9-completion.md) replaces the P1 placeholder landing
// screen with the real role-aware Overview dashboard.
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { OverviewDashboard } from "../components/dashboard/overview-dashboard";

function DashboardPage() {
  const { me } = useMe();
  return <OverviewDashboard me={me} />;
}

export const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
});
