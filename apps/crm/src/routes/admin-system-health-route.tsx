import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { SystemHealthWorkspace } from "../components/admin/system-health-workspace";

export const adminSystemHealthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/system-health",
  component: SystemHealthWorkspace,
});
