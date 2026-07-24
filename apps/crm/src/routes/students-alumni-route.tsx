// Legacy URL — Alumni is now the "Alumni" toggle on the single Students
// page. Redirect so old bookmarks keep working.
import { createRoute, redirect } from "@tanstack/react-router";

import { rootRoute } from "./root-route";

export const studentsAlumniRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/students/alumni",
  beforeLoad: () => {
    throw redirect({ to: "/students", search: { status: "alumni" } });
  },
});
