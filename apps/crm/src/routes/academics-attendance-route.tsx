import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { BatchAttendanceRoster } from "../components/attendance/batch-attendance-roster";

function AcademicsAttendancePage() {
  const { me } = useMe();
  return <BatchAttendanceRoster me={me} />;
}

export const academicsAttendanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/academics/attendance",
  component: AcademicsAttendancePage,
});
