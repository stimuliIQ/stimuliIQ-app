import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { MarketingTargetsManager } from "../components/marketing/marketing-targets-manager";

function MarketingTargetsPage() {
  const { me } = useMe();
  return <MarketingTargetsManager me={me} />;
}

export const marketingTargetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/marketing/targets",
  component: MarketingTargetsPage,
});
