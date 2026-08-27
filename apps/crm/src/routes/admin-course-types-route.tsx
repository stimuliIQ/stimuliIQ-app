import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { CourseTypesManager } from "../components/admin/course-types-manager";

function AdminCourseTypesPage() {
  const { me } = useMe();
  return <CourseTypesManager me={me} />;
}

export const adminCourseTypesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/course-types",
  component: AdminCourseTypesPage,
});
