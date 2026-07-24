import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { MentorDirectory } from "../components/mentors/mentor-directory";

function MentorsPage() {
  const { me } = useMe();
  return <MentorDirectory me={me} />;
}

export const mentorsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mentors",
  component: MentorsPage,
});
