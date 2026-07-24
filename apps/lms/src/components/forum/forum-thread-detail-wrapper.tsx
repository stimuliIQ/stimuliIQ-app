// ForumThreadDetailWrapper — Phase 6, Task #10.
//
// Client-side wrapper that resolves the current user's ID from the session
// and passes it to ForumThreadDetailContent.
//
// Separation of concerns:
//   - This wrapper handles the "who am I?" session concern.
//   - ForumThreadDetailContent handles the forum data concern.
//
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";

import { useMe } from "../../hooks/use-me";
import { ForumThreadDetailContent } from "./forum-thread-detail-content";

interface ForumThreadDetailWrapperProps {
  threadId: string;
}

export function ForumThreadDetailWrapper({
  threadId,
}: ForumThreadDetailWrapperProps): React.JSX.Element {
  const { me } = useMe();
  return (
    <ForumThreadDetailContent
      threadId={threadId}
      currentUserId={me?.user.id}
    />
  );
}
