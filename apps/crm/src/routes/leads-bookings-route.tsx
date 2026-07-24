// Legacy URL — the standalone Bookings page is now the "Bookings" tab of the
// unified My Work cockpit (lifecycle-redesign P2). Redirect so old bookmarks
// and command-palette entries keep working.
import { createRoute, redirect } from "@tanstack/react-router";

import { rootRoute } from "./root-route";

export const leadsBookingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leads/bookings",
  beforeLoad: () => {
    throw redirect({ to: "/leads/counselling" });
  },
});
