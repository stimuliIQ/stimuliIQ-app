import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { PipelineBoard } from "../components/leads/pipeline-board";

function LeadsPipelinePage() {
  const { me } = useMe();
  return <PipelineBoard me={me} />;
}

export const leadsPipelineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leads",
  component: LeadsPipelinePage,
});
