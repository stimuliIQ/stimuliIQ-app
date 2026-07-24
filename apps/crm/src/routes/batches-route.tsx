import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { BatchDirectory } from "../components/batches/batch-directory";

function BatchesPage() {
  const { me } = useMe();
  return <BatchDirectory me={me} />;
}

export const batchesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/batches",
  component: BatchesPage,
});
