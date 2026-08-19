import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root-route";
import { LeaveSetupWorkspace } from "../components/leave/leave-setup-workspace";

export const leaveSetupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leave/setup",
  component: LeaveSetupWorkspace,
});
