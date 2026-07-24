// Admin ▸ Notifications route — Phase 6, task #11.
// Path: /admin/notifications
// Template registry view (lists campaign templates across channels).
// Provides create/edit/delete for templates; campaigns.view / campaigns.create
// permissions are gated in the component.
// See NotificationAdmin component for the full surface.
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { NotificationAdmin } from "../components/campaigns/notification-admin";

function AdminNotificationsPage() {
  const { me } = useMe();
  return <NotificationAdmin me={me} />;
}

export const adminNotificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/notifications",
  component: AdminNotificationsPage,
});
