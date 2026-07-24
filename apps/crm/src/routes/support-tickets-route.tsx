import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { TicketQueue } from "../components/support/ticket-queue";

function SupportTicketsPage() {
  const { me } = useMe();
  return <TicketQueue me={me} />;
}

export const supportTicketsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/support/tickets",
  component: SupportTicketsPage,
});
