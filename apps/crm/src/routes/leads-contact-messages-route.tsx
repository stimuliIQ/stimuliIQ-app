import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { ContactMessageList } from "../components/leads/contact-message-list";

function LeadsContactMessagesPage() {
  const { me } = useMe();
  return <ContactMessageList me={me} />;
}

export const leadsContactMessagesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leads/contact-messages",
  component: LeadsContactMessagesPage,
});
