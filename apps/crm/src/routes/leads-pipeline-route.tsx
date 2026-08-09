// Leads ▸ Pipeline — the board plus inbound Contact Messages as a second tab, so
// triaging a website enquiry doesn't mean leaving the pipeline. Contact Messages keeps
// its own /leads/contact-messages route and nav item; this is an extra way in, not a
// move. See components/leads/pipeline-workspace.tsx.
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { PipelineWorkspace } from "../components/leads/pipeline-workspace";

function LeadsPipelinePage() {
  const { me } = useMe();
  const { owner } = leadsPipelineRoute.useSearch();
  return <PipelineWorkspace me={me} initialOwnerFilter={owner} />;
}

export const leadsPipelineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leads",
  /**
   * `?owner=mine` — a deep link into "the leads assigned to me".
   *
   * Exists so the notification bell can go from "a lead was assigned to you" to that
   * person's actual queue in one click. Deliberately a NAMED mode ("mine") rather than a
   * user id in the URL: the server resolves "me" from the session, so a link pasted into
   * a colleague's chat shows them THEIR leads instead of silently exposing whose queue it
   * was copied from.
   *
   * Anything else is dropped rather than rejected — a stale or hand-edited URL should
   * land on the normal pipeline, not an error page.
   */
  validateSearch: (search: Record<string, unknown>): { owner?: "mine" } =>
    search.owner === "mine" ? { owner: "mine" } : {},
  component: LeadsPipelinePage,
});
