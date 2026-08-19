import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { CareerApplicationsWorkspace } from "../components/careers/career-applications-workspace";

function CareersApplicationsPage() {
  const { me } = useMe();
  const { jobOpeningId } = careersApplicationsRoute.useSearch();
  return <CareerApplicationsWorkspace me={me} initialJobOpeningId={jobOpeningId} />;
}

export const careersApplicationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/careers/applications",
  /**
   * `?jobOpeningId=<uuid>` — a deep link into one opening's applicants, used by the
   * "12 applicants" link on the Openings screen so a reviewer goes from the count straight
   * to the people it counts, rather than re-finding the role in a filter.
   *
   * Anything malformed is dropped rather than rejected: a stale or hand-edited URL should
   * land on the normal queue, not an error page (the same rule the leads pipeline follows
   * for `?owner=mine`). The value is only ever a filter, so a wrong one narrows the list
   * and never exposes anything.
   */
  validateSearch: (search: Record<string, unknown>): { jobOpeningId?: string } =>
    typeof search.jobOpeningId === "string" && search.jobOpeningId.length > 0
      ? { jobOpeningId: search.jobOpeningId }
      : {},
  component: CareersApplicationsPage,
});
