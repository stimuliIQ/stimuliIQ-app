import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { FeatureFlagsManager } from "../components/admin/feature-flags-manager";

function AdminFeatureFlagsPage() {
  const { me } = useMe();
  return <FeatureFlagsManager me={me} />;
}

export const adminFeatureFlagsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/feature-flags",
  component: AdminFeatureFlagsPage,
});
