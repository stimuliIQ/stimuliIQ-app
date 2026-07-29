import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { UserDirectory } from "../components/admin/user-directory";

function AdminUsersPage() {
  const { me } = useMe();
  return <UserDirectory me={me} />;
}

export const adminUsersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/users",
  component: AdminUsersPage,
});
