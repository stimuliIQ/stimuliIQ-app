// Legacy URL — the standalone Tasks page is now the "Follow-ups" tab of the
// unified My Work cockpit (lifecycle-redesign P2). Redirect so old bookmarks
// and command-palette entries keep working.
import { createRoute, redirect } from "@tanstack/react-router";

import { rootRoute } from "./root-route";

export const leadsTasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leads/tasks",
  beforeLoad: () => {
    throw redirect({ to: "/leads/counselling" });
  },
});
