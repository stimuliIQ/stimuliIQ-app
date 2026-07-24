import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { EmiPlanDirectory } from "../components/emi/emi-plan-directory";

function CommercePlansPage() {
  const { me } = useMe();
  return <EmiPlanDirectory me={me} />;
}

export const commercePlansRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/commerce/plans",
  component: CommercePlansPage,
});
