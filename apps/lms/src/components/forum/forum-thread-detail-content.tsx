// Forum Thread Detail — Phase 6, Task #10.
// docs/02 §7.14, docs/specs/phase-6-engagement.md WS-2/WS-4.
//
// Renders:
//   - Thread title + status badge
//   - PostThread (nested posts + upvotes + resolve + report)
//   - Reply editor (inline, triggered by PostThread's onReply)
//
// DOMPurify (AC-70, CLAUDE.md §3):
//   - ALL post bodies are sanitized via sanitizeHtml() before passing to PostThread.
//   - PostThread renders body via dangerouslySetInnerHTML — the CALLER is responsible
//     for sanitizing. This component is that caller.
//
// IDOR (AC-55, AC-56): Non-enrolled thread → 404 from the API; hook sets isNotEnrolled.
//
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Pin, RefreshCw, Send, X } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PostThread,
  type PostItem,
  type PostStatus,
  Skeleton,
} from "@repo/ui";
import type { PostDto, CreatePostDto } from "@repo/types";

import { useForumPosts } from "../../hooks/use-forum";
import { sanitizeHtml } from "../../lib/sanitize";
import { BookmarkButton } from "../shared/bookmark-button";

// ---------------------------------------------------------------------------
// Map PostDto → PostItem (with DOMPurify sanitization — AC-70)
// ---------------------------------------------------------------------------

/**
 * Converts a PostDto from the API into a PostItem for the PostThread component.
 *
 * CRITICAL: body is sanitized here via sanitizeHtml() before passing to PostThread.
 * PostThread renders body via dangerouslySetInnerHTML — it REQUIRES pre-sanitized HTML.
 */
function toPostItem(post: PostDto): PostItem {
  return {
    id: post.id,
    authorId: post.author.id,
    authorDisplayName: post.author.displayName,
    // AC-70: DOMPurify sanitize every post body before passing to PostThread
    body: sanitizeHtml(post.body),
    upvotes: post.upvotes,
    upvotedByCurrentUser: post.hasVoted ?? false,
    status: post.status as PostStatus,
    parentId: post.parentId,
    createdAt: new Date(post.createdAt),
    isResolution: post.isResolved,
  };
}

// ---------------------------------------------------------------------------
// Inline reply editor
// ---------------------------------------------------------------------------

interface ReplyEditorProps {
  /** The parent post ID to reply to; null = top-level reply to the thread. */
  parentId: string | null;
  onSubmit: (data: CreatePostDto) => Promise<void>;
  onCancel: () => void;
  isSubmitting: boolean;
  /** Display name of the post being replied to (for the label). */
  replyingToName?: string;
}

function ReplyEditor({
  parentId,
  onSubmit,
  onCancel,
  isSubmitting,
  replyingToName,
}: ReplyEditorProps): React.JSX.Element {
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = body.trim();
    if (!trimmed) {
      setError("Reply cannot be empty.");
      return;
    }
    if (trimmed.length > 10_000) {
      setError("Reply cannot exceed 10,000 characters.");
      return;
    }
    try {
      await onSubmit({ body: trimmed, parentId: parentId ?? undefined });
      setBody("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to post reply. Please try again.",
      );
    }
  }

  const label = parentId && replyingToName
    ? `Replying to ${replyingToName}`
    : "Post a reply";

  return (
    <Card data-testid="reply-editor" className="mt-4">
      <CardHeader className="py-3 pb-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-fg">{label}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            aria-label="Cancel reply"
            disabled={isSubmitting}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <div>
            <label htmlFor="reply-body" className="sr-only">
              {label}
            </label>
            <textarea
              id="reply-body"
              ref={textareaRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your reply..."
              maxLength={10_000}
              disabled={isSubmitting}
              required
              aria-required="true"
              rows={4}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 resize-y"
              data-testid="reply-body-input"
            />
            <p className="mt-1 text-xs text-fg-muted" aria-live="polite">
              {body.length}/10,000 characters
            </p>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-danger" data-testid="reply-error">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting}
              data-testid="reply-submit"
            >
              <Send aria-hidden="true" className="mr-1.5 size-3.5" />
              {isSubmitting ? "Posting..." : "Post reply"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
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
// Thread status badge
// ---------------------------------------------------------------------------

function ThreadStatusBadge({ status }: { status: string }): React.JSX.Element | null {
  if (status === "open") return null;
  return (
    <span
      className={
        status === "resolved"
          ? "inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success"
          : status === "pinned"
            ? "inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/20 dark:text-brand-300"
            : "inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-fg-muted"
      }
      data-testid="thread-status-badge"
    >
      {status === "resolved" ? (
        <CheckCircle2 aria-hidden="true" className="size-3" />
      ) : status === "pinned" ? (
        <Pin aria-hidden="true" className="size-3" />
      ) : null}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ForumThreadDetailContent
// ---------------------------------------------------------------------------

interface ForumThreadDetailContentProps {
  threadId: string;
  /** The current user's ID, for upvote/reply permissions. */
  currentUserId?: string;
}

export function ForumThreadDetailContent({
  threadId,
  currentUserId,
}: ForumThreadDetailContentProps): React.JSX.Element {
  const {
    posts,
    thread,
    isLoading,
    isSignedOut,
    isError,
    isNotEnrolled,
    error,
    createPost,
    isPosting,
    upvote,
    resolveThread,
    refetch,
  } = useForumPosts(threadId);

  // Reply editor state: null = closed, string = parentId (or "" for top-level)
  const [replyTarget, setReplyTarget] = React.useState<string | null | false>(false);

  // ── Signed-out ────────────────────────────────────────────────────────────
  if (isSignedOut) {
    return (
      <Card data-testid="thread-signed-out">
        <CardHeader>
          <CardTitle>You&apos;re signed out</CardTitle>
          <CardDescription>Sign in to view this discussion.</CardDescription>
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
        data-testid="thread-not-enrolled"
        title="Thread not found"
        description="This thread doesn't exist or you are not enrolled in the batch."
      />
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading thread"
        className="space-y-4"
        data-testid="thread-skeleton"
      >
        <Skeleton shape="line" className="h-6 w-2/3" />
        <Skeleton shape="line" className="h-4 w-1/4" />
        <div className="space-y-3 mt-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} shape="block" className="h-24 w-full rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <Card data-testid="thread-error">
        <CardHeader>
          <CardTitle>Couldn&apos;t load thread</CardTitle>
          <CardDescription>
            {error?.problem.detail ?? error?.problem.title ?? "Something went wrong."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" onClick={refetch} data-testid="thread-retry">
            <RefreshCw aria-hidden="true" className="mr-1.5 size-4" />
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Map PostDto[] → PostItem[] with DOMPurify sanitization on each body (AC-70)
  const postItems: PostItem[] = posts.map(toPostItem);

  // Find the display name of the parent post when replying (for the reply label)
  const replyingToPost =
    replyTarget !== false && replyTarget !== null
      ? posts.find((p) => p.id === replyTarget)
      : undefined;

  return (
    <div className="space-y-6" data-testid="forum-thread-detail-content">
      {/* Back link */}
      <div>
        <Link
          href="/forum"
          className="inline-flex items-center gap-1.5 text-sm text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          data-testid="back-to-forum"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to Forum
        </Link>
      </div>

      {/* Thread header */}
      {thread ? (
        <div className="space-y-2" data-testid="thread-header">
          <div className="flex flex-wrap items-start gap-2">
            <h1 className="text-xl font-bold text-fg flex-1 min-w-0">{thread.title}</h1>
            <ThreadStatusBadge status={thread.status} />
            <BookmarkButton
              refType="forum_thread"
              refId={thread.id}
              label={thread.title}
              data-testid="thread-bookmark-btn"
            />
          </div>
          <p className="text-sm text-fg-muted">
            Started by{" "}
            <span className="font-medium text-fg">{thread.author.displayName}</span>
          </p>
        </div>
      ) : null}

      {/* Posts */}
      <PostThread
        posts={postItems}
        currentUserId={currentUserId}
        threadAuthorId={thread?.author.id}
        onUpvote={(postId) => void upvote(postId)}
        onResolve={(postId) =>
          void resolveThread({ action: "resolve", resolvedPostId: postId })
        }
        // No `onReport`. PostThread hides the Report menu item when the prop is absent,
        // which is the honest state of this feature: there is no report endpoint, and
        // `ForumPost.status` is only `visible | hidden` — a student report has nowhere to
        // be recorded. The handler here used to be a bare `console.info`, so a student
        // reporting abuse got a menu that closed and nothing else: no request, no
        // confirmation, no queue entry, and no way for anyone to find out. A control that
        // looks like it acts and does not is worse than its absence (the same call this
        // codebase made on `stats.headline` and on the `job_openings` role editor).
        //
        // Building it properly needs somewhere to put a report — a `forum_post_reports`
        // table, or a route into the existing ticket queue — plus a CRM surface to work
        // it. Recorded in docs/phase-9-followups.md rather than faked here.
        onReply={(parentId) => {
          // parentId = null means top-level reply
          setReplyTarget(parentId);
        }}
        loading={false}
        data-testid="forum-posts"
      />

      {/* Reply editor — shown when replyTarget is not false */}
      {replyTarget !== false ? (
        <ReplyEditor
          parentId={replyTarget}
          replyingToName={replyingToPost?.author.displayName}
          onSubmit={async (data) => {
            await createPost(data);
            setReplyTarget(false);
          }}
          onCancel={() => setReplyTarget(false)}
          isSubmitting={isPosting}
        />
      ) : null}
    </div>
  );
}
