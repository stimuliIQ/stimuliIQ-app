import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { JobOpeningsManager } from "../components/careers/job-openings-manager";

function CareersOpeningsPage() {
  const { me } = useMe();
  return <JobOpeningsManager me={me} />;
}

export const careersOpeningsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/careers/openings",
  component: CareersOpeningsPage,
});
