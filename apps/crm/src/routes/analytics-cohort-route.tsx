import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { CohortReport } from "../components/analytics/cohort-report";

function AnalyticsCohortPage() {
  const { me } = useMe();
  return <CohortReport me={me} />;
}

export const analyticsCohortRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics/cohort",
  component: AnalyticsCohortPage,
});
