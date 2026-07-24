import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { VideoLibraryDirectory } from "../components/video-library/video-library-directory";

function ContentVideosPage() {
  const { me } = useMe();
  return <VideoLibraryDirectory me={me} />;
}

export const contentVideosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/content/videos",
  component: ContentVideosPage,
});
