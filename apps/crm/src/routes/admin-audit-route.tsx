import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { AuditLogDirectory } from "../components/admin/audit-log-directory";

export const adminAuditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/audit-logs",
  component: AuditLogDirectory,
});
