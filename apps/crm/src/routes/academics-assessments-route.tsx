import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { AssessmentDirectory } from "../components/assessments/assessment-directory";

function AcademicsAssessmentsPage() {
  const { me } = useMe();
  return <AssessmentDirectory me={me} />;
}

export const academicsAssessmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/academics/assessments",
  component: AcademicsAssessmentsPage,
});
