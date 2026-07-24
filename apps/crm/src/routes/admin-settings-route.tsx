import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { SettingsManager } from "../components/admin/settings-manager";

function AdminSettingsPage() {
  const { me } = useMe();
  return <SettingsManager me={me} />;
}

export const adminSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/settings",
  component: AdminSettingsPage,
});
