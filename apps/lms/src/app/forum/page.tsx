// /forum — Forum index (batch-scoped thread list). Phase 6, Task #10.
// docs/02 §7.14, docs/specs/phase-6-engagement.md WS-2.
//
// Student sees threads for each enrolled batch. Batch selector at the top.
// Non-enrolled batches: the API returns 404 (IDOR-safe) — handled in the content component.
//
// force-dynamic: authenticated route; batch/thread data must not be statically prerendered.
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

import { PageHeader } from "@repo/ui";

import { LmsShell } from "../../components/shell/lms-shell";
import { ForumBatchSelector } from "../../components/forum/forum-batch-selector";

export const metadata: Metadata = {
  title: "Forum — stimuliiq",
  description: "Discuss topics, ask questions, and share knowledge with your batchmates.",
};

export default function ForumPage() {
  return (
    <LmsShell>
      <div className="space-y-6 md:space-y-8" data-testid="forum-page">
        <PageHeader
          title="Forum"
          description="Discuss topics, ask questions, and share knowledge with your batchmates."
        />
        <ForumBatchSelector />
      </div>
    </LmsShell>
  );
}
