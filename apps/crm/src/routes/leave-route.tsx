import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { MyLeaveWorkspace } from "../components/leave/my-leave-workspace";

function MyLeavePage() {
  const { me } = useMe();
  return <MyLeaveWorkspace me={me} />;
}

export const leaveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leave",
  component: MyLeavePage,
});
