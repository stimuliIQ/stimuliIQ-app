import { createRoute } from "@tanstack/react-router";
import { z } from "zod";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { StudentDirectory } from "../components/students/student-directory";

// `?status=` preselects the in-page toggle (All / Admissions / Active /
// Alumni) — the legacy /students/admissions and /students/alumni routes
// redirect here with it set.
const studentsSearchSchema = z.object({
  status: z.enum(["lead", "active", "alumni"]).optional().catch(undefined),
});

function StudentsPage() {
  const { me } = useMe();
  const { status } = studentsRoute.useSearch();
  return <StudentDirectory me={me} initialStatus={status} />;
}

export const studentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/students",
  validateSearch: studentsSearchSchema,
  component: StudentsPage,
});
