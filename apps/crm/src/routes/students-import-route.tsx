import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { StudentImportPage } from "../components/students/student-import-page";

function StudentsImportPage() {
  const { me } = useMe();
  return <StudentImportPage me={me} />;
}

export const studentsImportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/students/import",
  component: StudentsImportPage,
});
