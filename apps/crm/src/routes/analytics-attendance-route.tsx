// Analytics ▸ Attendance route — /analytics/attendance. Phase 7 Wave 3, task #14.
// Requires reports.attendance.view (API also enforces server-side).
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { AttendanceDashboard } from "../components/analytics/attendance-dashboard";

function AnalyticsAttendancePage() {
  const { me } = useMe();
  return <AttendanceDashboard me={me} />;
}

export const analyticsAttendanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics/attendance",
  component: AnalyticsAttendancePage,
});
