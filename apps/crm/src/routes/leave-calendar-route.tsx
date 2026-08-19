import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root-route";
import { LeaveCalendarWorkspace } from "../components/leave/leave-calendar-workspace";

export const leaveCalendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leave/calendar",
  component: LeaveCalendarWorkspace,
});
