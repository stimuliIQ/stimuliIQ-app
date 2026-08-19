import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { LeaveApprovalsWorkspace } from "../components/leave/leave-approvals-workspace";

function LeaveApprovalsPage() {
  const { me } = useMe();
  return <LeaveApprovalsWorkspace me={me} />;
}

export const leaveApprovalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leave/approvals",
  component: LeaveApprovalsPage,
});
