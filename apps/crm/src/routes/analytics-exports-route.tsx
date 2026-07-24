// Analytics ▸ Exports route — /analytics/exports. Phase 7 Wave 3, task #15.
// Requires reports.export (API also enforces server-side).
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { ExportsPage } from "../components/reports/exports-page";

function AnalyticsExportsPage() {
  const { me } = useMe();
  return <ExportsPage me={me} />;
}

export const analyticsExportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics/exports",
  component: AnalyticsExportsPage,
});
