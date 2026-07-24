// Forum Thread List — Phase 6, Task #10. docs/02 §7.14.
//
// Renders:
//   - ThreadList for an enrolled batch
//   - "Create thread" button (only for enrolled batches — API enforces IDOR)
//   - Create thread form (inline expand)
//
// DOMPurify: ThreadList renders plain text titles only.
// Post bodies in the thread detail are sanitized in forum-thread-detail-content.tsx.
//
// IDOR (AC-55, AC-56): The API returns 404 for non-enrolled batches.
// The UI hides the "Create thread" form — the API already enforces the guard.
//
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, X } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  EmptyState,
  Input,
  ThreadList,
  type ThreadSummary,
  type ThreadStatus,
} from "@repo/ui";
import type { ThreadDto, CreateThreadDto } from "@repo/types";

import { useForumThreads } from "../../hooks/use-forum";

// ---------------------------------------------------------------------------
// Map API ThreadDto → ThreadSummary for the UI component
// ---------------------------------------------------------------------------

function toThreadSummary(thread: ThreadDto): ThreadSummary {
  return {
    id: thread.id,
    title: thread.title,
    authorDisplayName: thread.author?.displayName ?? "Unknown",
    // ThreadDto has postCount (not replyCount)
    replyCount: thread.postCount ?? 0,
    status: thread.status as ThreadStatus,
    // Use lastActivityAt when available; fall back to createdAt
    lastActivityAt: new Date(thread.lastActivityAt ?? thread.createdAt),
    hasUnread: false, // P6: unread-reply tracking deferred
  };
}

// ---------------------------------------------------------------------------
// Create Thread Form
// ---------------------------------------------------------------------------

interface CreateThreadFormProps {
  batchId: string;
  onSubmit: (data: CreateThreadDto) => Promise<void>;
  onCancel: () => void;
  isSubmitting: boolean;
}

function CreateThreadForm({
  batchId,
  onSubmit,
  onCancel,
  isSubmitting,
}: CreateThreadFormProps): React.JSX.Element {
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const titleRef = React.useRef<HTMLInputElement>(null);

  // Focus the title field when the form opens
  React.useEffect(() => {
    titleRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle) {
      setError("Thread title is required.");
      return;
    }
    if (!trimmedBody) {
      setError("Opening post body is required.");
      return;
    }
    if (trimmedBody.length > 10_000) {
      setError("Post body cannot exceed 10,000 characters.");
      return;
    }
    try {
      await onSubmit({ title: trimmedTitle, body: trimmedBody, batchId });
      setTitle("");
      setBody("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create thread. Please try again.",
      );
    }
  }

  return (
    <Card data-testid="create-thread-form">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">New Thread</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            aria-label="Cancel creating thread"
            disabled={isSubmitting}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="thread-title" className="block text-sm font-medium text-fg mb-1">
              Title <span aria-hidden="true">*</span>
            </label>
            <Input
              id="thread-title"
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What would you like to discuss?"
              maxLength={200}
              disabled={isSubmitting}
              required
              aria-required="true"
              data-testid="thread-title-input"
            />
          </div>

          <div>
            <label htmlFor="thread-body" className="block text-sm font-medium text-fg mb-1">
              Opening post <span aria-hidden="true">*</span>
            </label>
            <textarea
              id="thread-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Share your question or topic..."
              maxLength={10_000}
              disabled={isSubmitting}
              required
              aria-required="true"
              rows={5}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 resize-y"
              data-testid="thread-body-input"
            />
            <p className="mt-1 text-xs text-fg-muted" aria-live="polite">
              {body.length}/10,000 characters
            </p>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-danger" data-testid="create-thread-error">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={isSubmitting}
              data-testid="create-thread-submit"
            >
              {isSubmitting ? "Creating..." : "Create thread"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ForumThreadListContent
// ---------------------------------------------------------------------------

interface ForumThreadListContentProps {
  /** The batch ID to show threads for. */
  batchId: string;
}

export function ForumThreadListContent({
  batchId,
}: ForumThreadListContentProps): React.JSX.Element {
  const router = useRouter();
  const {
    threads,
    isLoading,
    isSignedOut,
    isError,
    isNotEnrolled,
    error,
    createThread,
    isCreating,
    refetch,
  } = useForumThreads(batchId);

  const [showCreateForm, setShowCreateForm] = React.useState(false);

  // ── Signed-out ────────────────────────────────────────────────────────────
  if (isSignedOut) {
    return (
      <Card data-testid="forum-signed-out">
        <CardHeader>
          <CardTitle>You&apos;re signed out</CardTitle>
          <CardDescription>Sign in to view forum threads.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href="/login">Sign in</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Not enrolled (IDOR → 404) ─────────────────────────────────────────────
  if (isNotEnrolled) {
    return (
      <EmptyState
        data-testid="forum-not-enrolled"
        title="Forum not available"
        description="You are not enrolled in this batch. Enroll to participate in discussions."
      />
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <Card data-testid="forum-error">
        <CardHeader>
          <CardTitle>Couldn&apos;t load forum</CardTitle>
          <CardDescription>
            {error?.problem.detail ?? error?.problem.title ?? "Something went wrong."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" onClick={refetch} data-testid="forum-retry">
            <RefreshCw aria-hidden="true" className="mr-1.5 size-4" />
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const threadSummaries = threads.map(toThreadSummary);

  return (
    <div className="space-y-4" data-testid="forum-thread-list-content">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-fg">
          <span aria-hidden="true" className="h-4 w-1 rounded-full bg-brand-500" />
          Discussion
        </h2>
        {/* Only offer "New Thread" when not in the IDOR error state */}
        {!isNotEnrolled && !showCreateForm ? (
          <Button
            size="sm"
            onClick={() => setShowCreateForm(true)}
            data-testid="new-thread-btn"
            aria-label="Create a new forum thread"
          >
            <Plus aria-hidden="true" className="mr-1.5 size-4" />
            New Thread
          </Button>
        ) : null}
      </div>

      {/* Create thread form */}
      {showCreateForm ? (
        <CreateThreadForm
          batchId={batchId}
          onSubmit={async (data) => {
            await createThread(data);
            setShowCreateForm(false);
          }}
          onCancel={() => setShowCreateForm(false)}
          isSubmitting={isCreating}
        />
      ) : null}

      {/* Thread list */}
      <ThreadList
        threads={threadSummaries}
        loading={isLoading}
        onThreadClick={(thread) => router.push(`/forum/threads/${thread.id}`)}
        heading={undefined}
        data-testid="forum-thread-list"
      />
    </div>
  );
}
