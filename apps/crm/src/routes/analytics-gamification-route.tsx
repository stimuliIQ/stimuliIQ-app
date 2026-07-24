// Analytics ▸ Gamification participation route — /analytics/gamification. Phase 7 Wave 3, task #14.
// Requires reports.gamification.view (API also enforces server-side).
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { GamificationDashboard } from "../components/analytics/gamification-dashboard";

function AnalyticsGamificationPage() {
  const { me } = useMe();
  return <GamificationDashboard me={me} />;
}

export const analyticsGamificationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics/gamification",
  component: AnalyticsGamificationPage,
});
