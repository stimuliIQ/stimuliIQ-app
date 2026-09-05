import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { EmailTemplatesManager } from "../components/admin/email-templates-manager";

function AdminEmailTemplatesPage() {
  const { me } = useMe();
  return <EmailTemplatesManager me={me} />;
}

export const adminEmailTemplatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/email-templates",
  component: AdminEmailTemplatesPage,
});
