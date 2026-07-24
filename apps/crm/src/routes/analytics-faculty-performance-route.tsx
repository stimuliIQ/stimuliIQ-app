import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { FacultyPerformanceReport } from "../components/analytics/faculty-performance-report";

function AnalyticsFacultyPerformancePage() {
  const { me } = useMe();
  return <FacultyPerformanceReport me={me} />;
}

export const analyticsFacultyPerformanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics/faculty-performance",
  component: AnalyticsFacultyPerformancePage,
});
