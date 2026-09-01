import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { TeamsWorkspace } from "../components/org/teams-workspace";

function OrgTeamsPage() {
  const { me } = useMe();
  return <TeamsWorkspace me={me} />;
}

export const orgTeamsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/org/teams",
  component: OrgTeamsPage,
});
