// Content > Resources — reuses the block-based Content Pages manager (also
// reachable from Marketing > Blog CMS > Pages) as the resource-library
// surface: staff manage downloadable/linked resource pages via the same
// draft/publish CRUD. Phase 9 Completion T40.
import { createRoute } from "@tanstack/react-router";
import { PageHeader } from "@repo/ui";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { ContentPagesManager } from "../components/content/content-pages-manager";

function ContentResourcesPage() {
  const { me } = useMe();
  return (
    <div className="space-y-6 md:space-y-8" data-testid="content-resources-page">
      <PageHeader
        title="Resources"
        description="Downloadable and linked resource pages, managed as content pages (also visible under Marketing → Blog CMS → Pages)."
      />
      <ContentPagesManager me={me} />
    </div>
  );
}

export const contentResourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/content/resources",
  component: ContentResourcesPage,
});
