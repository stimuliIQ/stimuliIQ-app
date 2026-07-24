import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { BranchComparisonReport } from "../components/analytics/branch-comparison-report";

function AnalyticsBranchComparisonPage() {
  const { me } = useMe();
  return <BranchComparisonReport me={me} />;
}

export const analyticsBranchComparisonRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics/branch-comparison",
  component: AnalyticsBranchComparisonPage,
});
