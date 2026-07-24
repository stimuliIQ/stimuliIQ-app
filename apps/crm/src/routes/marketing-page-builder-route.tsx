import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { PageBuilderPage } from "../components/page-builder/page-builder-page";

function MarketingPageBuilderPage() {
  const { me } = useMe();
  return <PageBuilderPage me={me} />;
}

export const marketingPageBuilderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/marketing/page-builder",
  component: MarketingPageBuilderPage,
});
