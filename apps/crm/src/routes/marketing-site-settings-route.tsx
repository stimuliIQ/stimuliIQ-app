import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { SiteSettingsPage } from "../components/site-settings/site-settings-page";

function MarketingSiteSettingsPage() {
  const { me } = useMe();
  return <SiteSettingsPage me={me} />;
}

export const marketingSiteSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/marketing/site-settings",
  component: MarketingSiteSettingsPage,
});
