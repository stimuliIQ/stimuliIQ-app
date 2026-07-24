import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { RoleDirectory } from "../components/admin/role-directory";

function AdminRolesPage() {
  const { me } = useMe();
  return <RoleDirectory me={me} />;
}

export const adminRolesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/roles",
  component: AdminRolesPage,
});
