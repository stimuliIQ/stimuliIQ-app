import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { BranchDirectory } from "../components/admin/branch-directory";

function AdminBranchesPage() {
  const { me } = useMe();
  return <BranchDirectory me={me} />;
}

export const adminBranchesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/branches",
  component: AdminBranchesPage,
});
