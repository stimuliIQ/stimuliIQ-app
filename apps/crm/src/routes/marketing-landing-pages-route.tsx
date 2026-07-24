import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { LandingPagesPage } from "../components/landing-pages/landing-pages-page";

function MarketingLandingPagesPage() {
  const { me } = useMe();
  return <LandingPagesPage me={me} />;
}

export const marketingLandingPagesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/marketing/landing-pages",
  component: MarketingLandingPagesPage,
});
