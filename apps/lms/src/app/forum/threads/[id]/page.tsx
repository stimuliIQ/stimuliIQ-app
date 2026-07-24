// /forum/threads/[id] — Forum thread detail. Phase 6, Task #10.
// docs/02 §7.14, docs/specs/phase-6-engagement.md WS-2.
//
// Shows all posts in a thread. Enrolled students can reply, upvote, and resolve.
// Non-enrolled access → API returns 404 (IDOR-safe).
//
// DOMPurify: applied in ForumThreadDetailContent before passing post bodies
// to PostThread's dangerouslySetInnerHTML (AC-70).
import type { Metadata } from "next";

import { LmsShell } from "../../../../components/shell/lms-shell";
import { ForumThreadDetailWrapper } from "../../../../components/forum/forum-thread-detail-wrapper";

export const metadata: Metadata = {
  title: "Thread — stimuliiq Forum",
  description: "View and reply to a forum thread.",
};

interface ThreadPageProps {
  params: Promise<{ id: string }>;
}

export default async function ThreadDetailPage({ params }: ThreadPageProps) {
  const { id } = await params;

  return (
    <LmsShell>
      <div data-testid="thread-detail-page">
        <ForumThreadDetailWrapper threadId={id} />
      </div>
    </LmsShell>
  );
}
