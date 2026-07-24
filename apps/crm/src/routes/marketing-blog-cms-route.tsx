import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { ContentCmsPage } from "../components/content/content-cms-page";

function MarketingBlogCmsPage() {
  const { me } = useMe();
  return <ContentCmsPage me={me} />;
}

export const marketingBlogCmsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/marketing/blog-cms",
  component: MarketingBlogCmsPage,
});
