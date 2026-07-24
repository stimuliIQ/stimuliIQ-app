// Legacy URL — Admissions is now the "Admissions" toggle (status="lead") on
// the single Students page. Redirect so old bookmarks keep working.
import { createRoute, redirect } from "@tanstack/react-router";

import { rootRoute } from "./root-route";

export const studentsAdmissionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/students/admissions",
  beforeLoad: () => {
    throw redirect({ to: "/students", search: { status: "lead" } });
  },
});
