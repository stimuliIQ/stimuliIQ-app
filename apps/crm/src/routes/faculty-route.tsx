import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { FacultyDirectory } from "../components/faculty/faculty-directory";

function FacultyPage() {
  const { me } = useMe();
  return <FacultyDirectory me={me} />;
}

export const facultyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/faculty",
  component: FacultyPage,
});
