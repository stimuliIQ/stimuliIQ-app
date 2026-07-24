import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { AssignmentDirectory } from "../components/assignments/assignment-directory";

function AcademicsAssignmentsPage() {
  const { me } = useMe();
  return <AssignmentDirectory me={me} kindFilter="assignment" title="Assignments" description="Faculty-authored assignments. Grade submissions from your assigned batches." />;
}

export const academicsAssignmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/academics/assignments",
  component: AcademicsAssignmentsPage,
});
