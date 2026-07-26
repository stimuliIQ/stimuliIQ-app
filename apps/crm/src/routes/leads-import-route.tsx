import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { LeadImportPage } from "../components/leads/lead-import-page";

function LeadsImportPage() {
  const { me } = useMe();
  return <LeadImportPage me={me} />;
}

export const leadsImportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leads/import",
  component: LeadsImportPage,
});
