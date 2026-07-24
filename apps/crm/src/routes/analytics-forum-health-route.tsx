// Analytics ▸ Forum health route — /analytics/forum-health. Phase 7 Wave 3, task #14.
// Requires reports.forum.view (API also enforces server-side).
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { ForumHealthDashboard } from "../components/analytics/forum-health-dashboard";

function AnalyticsForumHealthPage() {
  const { me } = useMe();
  return <ForumHealthDashboard me={me} />;
}

export const analyticsForumHealthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics/forum-health",
  component: AnalyticsForumHealthPage,
});
