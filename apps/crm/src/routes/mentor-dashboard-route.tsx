import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { MentorDashboard } from "../components/mentors/mentor-dashboard";

function MentorDashboardPage() {
  const { me } = useMe();
  return <MentorDashboard me={me} />;
}

export const mentorDashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mentor/dashboard",
  component: MentorDashboardPage,
});
