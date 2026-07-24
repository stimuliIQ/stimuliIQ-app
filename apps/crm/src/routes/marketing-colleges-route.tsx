import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { CollegesManager } from "../components/colleges/colleges-manager";

function MarketingCollegesPage() {
  const { me } = useMe();
  return <CollegesManager me={me} />;
}

export const marketingCollegesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/marketing/colleges",
  component: MarketingCollegesPage,
});
