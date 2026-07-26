import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { CallCenterWorkspace } from "../components/call-center/call-center-workspace";

function CallCenterPage() {
  const { me } = useMe();
  return <CallCenterWorkspace me={me} />;
}

export const callCenterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/call-center",
  component: CallCenterPage,
});
