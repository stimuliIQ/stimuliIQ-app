// Leads ▸ My Work — the single counsellor cockpit (lifecycle-redesign P2).
// Path stays /leads/counselling so existing bookmarks keep working; the page is
// now the tabbed LeadsWorkspace (Priorities · Follow-ups · Bookings) that
// absorbed the former standalone Tasks and Bookings pages.
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { LeadsWorkspace } from "../components/leads/leads-workspace";

function LeadsWorkPage() {
  const { me } = useMe();
  return <LeadsWorkspace me={me} />;
}

export const leadsCounsellingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leads/counselling",
  component: LeadsWorkPage,
});
