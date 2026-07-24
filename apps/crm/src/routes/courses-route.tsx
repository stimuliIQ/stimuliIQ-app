import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { ProgramDirectory } from "../components/courses/program-directory";

function CoursesPage() {
  const { me } = useMe();
  return <ProgramDirectory me={me} />;
}

export const coursesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/courses",
  component: CoursesPage,
});
