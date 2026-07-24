import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { RefundReport } from "../components/analytics/refund-report";

function AnalyticsRefundsPage() {
  const { me } = useMe();
  return <RefundReport me={me} />;
}

export const analyticsRefundsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics/refunds",
  component: AnalyticsRefundsPage,
});
