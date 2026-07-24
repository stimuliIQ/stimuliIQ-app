import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { ProjectDirectory } from "../components/assignments/project-directory";

function AcademicsProjectsPage() {
  const { me } = useMe();
  return <ProjectDirectory me={me} />;
}

export const academicsProjectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/academics/projects",
  component: AcademicsProjectsPage,
});
