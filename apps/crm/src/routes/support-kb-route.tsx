import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { KbArticleDirectory } from "../components/support/kb-article-directory";

function SupportKbPage() {
  const { me } = useMe();
  return <KbArticleDirectory me={me} />;
}

export const supportKbRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/support/kb",
  component: SupportKbPage,
});
