import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { LeaveCalendarWorkspace } from "../components/leave/leave-calendar-workspace";

function LeaveCalendarPage() {
  // `me` decides which audience options the picker may offer — the calendar is no longer
  // company-wide for everybody, so the screen must know what this viewer may actually see.
  const { me } = useMe();
  return <LeaveCalendarWorkspace me={me} />;
}

export const leaveCalendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leave/calendar",
  component: LeaveCalendarPage,
});
