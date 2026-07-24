// Forum moderation route — Phase 6, task #11.
// Path: /academics/forum-moderation
// Requires: forum.moderate permission (API also enforces assigned-scope server-side).
// Faculty sees only posts from their assigned batches (API returns IDOR→404 for
// non-assigned batches — the UI reflects an empty queue).
// Admin sees all batches.
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { ForumModerationDirectory } from "../components/forum/forum-moderation-directory";

function ForumModerationPage() {
  const { me } = useMe();
  return <ForumModerationDirectory me={me} />;
}

export const forumModerationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/academics/forum-moderation",
  component: ForumModerationPage,
});
