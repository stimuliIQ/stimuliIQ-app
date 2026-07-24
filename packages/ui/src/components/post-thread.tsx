"use client";

import * as React from "react";
import {
  ThumbsUp,
  CheckCircle2,
  Flag,
  EyeOff,
  MessageSquare,
  MoreHorizontal,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import { cn } from "../lib/cn";
import { EmptyState } from "./empty-state";
import { Skeleton } from "./skeleton";

/**
 * PostThread — nested replies view for a forum thread.
 * Per docs/02-prd-lms.md §7.14, docs/03-prd-crm.md (moderation), docs/07 §5/§11.
 *
 * Features:
 * - Parent post + nested replies (1-level visual indent — parent/child only, matching
 *   `forum_posts.parent_id` which is single-depth for P6).
 * - Upvote button (toggle, dedupe by the backend's `forum_post_votes` unique).
 * - Resolve affordance (marks thread resolved, shown for thread author + moderators).
 * - Pin affordance (moderator-only).
 * - Report affordance (any enrolled student).
 * - Hide affordance (moderator slot — reveals a hidden post admin overlay).
 * - Moderation slots — `moderationSlot` render prop allows the CRM moderation surface
 *   to inject hide/unhide/delete controls at the post level without forking the component.
 *
 * The component DOES NOT sanitize post bodies — that is the frontend's responsibility
 * (DOMPurify must be applied before passing `body` to avoid XSS). The component
 * accepts only sanitized HTML or plain text strings.
 *
 * a11y:
 * - Upvote button has aria-label with count and pressed state.
 * - Hidden posts announce "This post has been hidden by a moderator" to screen readers.
 * - Moderation actions are labelled icon buttons (aria-label).
 * - Reply indent is not purely visual — it's a nested <ol> with an sr-only label.
 *
 * Usage (LMS student view):
 *   <PostThread
 *     posts={posts}
 *     currentUserId="user-42"
 *     threadAuthorId="user-1"
 *     onUpvote={(postId) => upvote(postId)}
 *     onResolve={(postId) => resolve(postId)}
 *     onReport={(postId) => report(postId)}
 *     onReply={(parentId) => openReplyEditor(parentId)}
 *   />
 *
 * Usage (CRM moderation — with moderation slot):
 *   <PostThread
 *     posts={posts}
 *     onUpvote={...}
 *     moderationSlot={(post) => (
 *       <ModerationActions post={post} onHide={hide} onPin={pin} />
 *     )}
 *   />
 */

export type PostStatus = "visible" | "hidden";

export interface PostItem {
  id: string;
  authorId: string;
  authorDisplayName: string;
  /** Sanitized HTML or plain-text body. CALLER MUST SANITIZE (DOMPurify) before passing. */
  body: string;
  upvotes: number;
  /** Whether the current user has upvoted this post. */
  upvotedByCurrentUser?: boolean;
  status: PostStatus;
  hiddenReason?: string;
  parentId?: string | null;
  createdAt: Date | string;
  /** Whether this post has been marked as the thread-resolving answer. */
  isResolution?: boolean;
}

export interface PostThreadProps {
  posts: PostItem[];
  /** The current user's id (for upvote/reply permissions and highlighting own posts). */
  currentUserId?: string;
  /** The thread's original author id (for showing "Resolve" on their own thread). */
  threadAuthorId?: string;
  /** Whether the current user has moderation permissions for this thread. */
  isModerator?: boolean;
  /** Called when the user clicks "Upvote" on a post. */
  onUpvote?: (postId: string) => void;
  /** Called to mark a post as the thread resolution. */
  onResolve?: (postId: string) => void;
  /** Called when the user reports a post. */
  onReport?: (postId: string) => void;
  /** Called to reply to a post or the thread (pass parentId = null for top-level). */
  onReply?: (parentId: string | null) => void;
  /**
   * Render prop for injecting moderation controls (hide/unhide/pin/delete) into each
   * post. Used by the CRM moderation surface. The component itself does not call
   * hide/pin/delete — it delegates to this slot.
   */
  moderationSlot?: (post: PostItem) => React.ReactNode;
  loading?: boolean;
  error?: string;
  className?: string;
  /** Test hook; defaults to "post-thread". */
  "data-testid"?: string;
}

function formatPostTimestamp(ts: Date | string): { label: string; dateTime: string } {
  const date = typeof ts === "string" ? new Date(ts) : ts;
  const isoString = date.toISOString();
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  let label: string;
  if (diffMin < 1) label = "Just now";
  else if (diffMin < 60) label = `${diffMin}m ago`;
  else if (diffHr < 24) label = `${diffHr}h ago`;
  else if (diffDay === 1) label = "Yesterday";
  else label = date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  return { label, dateTime: isoString };
}

// ---------------------------------------------------------------------------
// Single post card
// ---------------------------------------------------------------------------

interface PostCardProps {
  post: PostItem;
  isNested?: boolean;
  currentUserId?: string;
  threadAuthorId?: string;
  isModerator?: boolean;
  onUpvote?: (id: string) => void;
  onResolve?: (id: string) => void;
  onReport?: (id: string) => void;
  onReply?: (parentId: string | null) => void;
  moderationSlot?: (post: PostItem) => React.ReactNode;
}

function PostCard({
  post,
  isNested = false,
  currentUserId,
  threadAuthorId,
  isModerator = false,
  onUpvote,
  onResolve,
  onReport,
  onReply,
  moderationSlot,
}: PostCardProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const menuTriggerRef = React.useRef<HTMLButtonElement>(null);

  const isHidden = post.status === "hidden";
  const isOwnPost = post.authorId === currentUserId;
  const canResolve = (currentUserId === threadAuthorId || isModerator) && !post.parentId;
  const { label: timeLabel, dateTime } = formatPostTimestamp(post.createdAt);

  // Close menu on outside click or Escape
  React.useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuTriggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  return (
    <article
      data-testid="post-card"
      data-post-id={post.id}
      data-status={post.status}
      aria-label={`Post by ${post.authorDisplayName}${post.isResolution ? " — marked as resolution" : ""}`}
      className={cn(
        "rounded-md border border-border bg-card",
        isNested && "ml-6 border-l-2 border-l-brand-200 dark:border-l-brand-500/40",
        post.isResolution && "border-success/40 bg-success/5",
      )}
    >
      {/* Hidden post overlay */}
      {isHidden ? (
        <div className="px-4 py-3">
          <p className="flex items-center gap-2 text-sm text-fg-muted italic">
            <EyeOff aria-hidden="true" className="size-4 shrink-0" />
            <span>
              This post has been hidden by a moderator.
              {post.hiddenReason ? ` Reason: ${post.hiddenReason}` : ""}
            </span>
          </p>
          {/* Moderators can see the original content */}
          {isModerator ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium text-fg-muted hover:text-fg">
                Show hidden content (moderator view)
              </summary>
              <div
                className="mt-2 text-sm text-fg-muted"
                // Caller MUST have DOMPurify-sanitized `body` before passing
                dangerouslySetInnerHTML={{ __html: post.body }}
              />
            </details>
          ) : null}
          {isModerator && moderationSlot ? (
            <div className="mt-2">{moderationSlot(post)}</div>
          ) : null}
        </div>
      ) : (
        <div className="px-4 py-3">
          {/* Resolution badge */}
          {post.isResolution ? (
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-success">
              <CheckCircle2 aria-hidden="true" className="size-3.5" />
              Marked as solution
            </div>
          ) : null}

          {/* Author + timestamp */}
          <div className="mb-2 flex items-center gap-2 text-xs text-fg-muted">
            <span className="font-medium text-fg">{post.authorDisplayName}</span>
            {isOwnPost ? <span className="text-brand-500">(you)</span> : null}
            <span aria-hidden="true">·</span>
            <time dateTime={dateTime}>{timeLabel}</time>
          </div>

          {/* Body — caller must sanitize before passing */}
          <div
            className="prose prose-sm max-w-none text-fg dark:prose-invert"
            // Safe: body MUST be DOMPurify-sanitized by the caller
            dangerouslySetInnerHTML={{ __html: post.body }}
          />

          {/* Action row */}
          <div className="mt-3 flex items-center gap-2">
            {/* Upvote */}
            {onUpvote ? (
              <button
                type="button"
                onClick={() => onUpvote(post.id)}
                aria-label={`Upvote this post — ${post.upvotes} upvote${post.upvotes !== 1 ? "s" : ""}`}
                aria-pressed={post.upvotedByCurrentUser}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
                  "transition-colors",
                  post.upvotedByCurrentUser
                    ? "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300"
                    : "text-fg-muted hover:bg-surface hover:text-fg",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm",
                )}
                data-testid={`upvote-${post.id}`}
              >
                <ThumbsUp aria-hidden="true" className="size-3.5" />
                <span aria-hidden="true">{post.upvotes}</span>
              </button>
            ) : null}

            {/* Reply */}
            {onReply ? (
              <button
                type="button"
                onClick={() => onReply(post.id)}
                aria-label={`Reply to ${post.authorDisplayName}'s post`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-fg-muted",
                  "hover:bg-surface hover:text-fg transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm",
                )}
                data-testid={`reply-${post.id}`}
              >
                <MessageSquare aria-hidden="true" className="size-3.5" />
                Reply
              </button>
            ) : null}

            {/* Resolve */}
            {canResolve && !post.isResolution && onResolve ? (
              <button
                type="button"
                onClick={() => onResolve(post.id)}
                aria-label="Mark this post as the solution"
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-success",
                  "hover:bg-success/10 transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm",
                )}
                data-testid={`resolve-${post.id}`}
              >
                <CheckCircle2 aria-hidden="true" className="size-3.5" />
                Mark as solution
              </button>
            ) : null}

            {/* More (report + moderator actions) */}
            {(onReport || isModerator) ? (
              <div ref={menuRef} className="relative ml-auto">
                <button
                  ref={menuTriggerRef}
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-label="More post actions"
                  aria-haspopup="true"
                  aria-expanded={menuOpen}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md p-1 text-fg-subtle",
                    "hover:bg-surface hover:text-fg transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                  data-testid={`post-menu-${post.id}`}
                >
                  <MoreHorizontal aria-hidden="true" className="size-4" />
                </button>

                {menuOpen ? (
                  <div
                    role="menu"
                    aria-label="Post actions"
                    className={cn(
                      "absolute right-0 top-full z-20 mt-1 min-w-[9rem]",
                      "rounded-md border border-border bg-card py-1 shadow-md",
                    )}
                  >
                    {onReport ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { onReport(post.id); setMenuOpen(false); }}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-2 text-sm text-fg-muted",
                          "hover:bg-surface hover:text-fg transition-colors",
                          "focus-visible:outline-none focus-visible:bg-surface",
                        )}
                        data-testid={`report-${post.id}`}
                      >
                        <Flag aria-hidden="true" className="size-3.5" />
                        Report
                      </button>
                    ) : null}
                    {isModerator && moderationSlot ? (
                      <div className="border-t border-border mt-1 pt-1">
                        {moderationSlot(post)}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// PostThread — assembles posts into parent + nested-reply structure
// ---------------------------------------------------------------------------

export function PostThread({
  posts,
  currentUserId,
  threadAuthorId,
  isModerator = false,
  onUpvote,
  onResolve,
  onReport,
  onReply,
  moderationSlot,
  loading = false,
  error,
  className,
  "data-testid": testId,
}: PostThreadProps): React.JSX.Element {
  const [showAllReplies, setShowAllReplies] = React.useState<Record<string, boolean>>({});

  const COLLAPSED_REPLY_LIMIT = 3;

  if (loading) {
    return (
      <div
        data-testid={testId ?? "post-thread"}
        aria-busy="true"
        aria-label="Loading posts"
        className={cn("flex flex-col gap-4", className)}
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-md border border-border p-4">
            <Skeleton shape="line" className="mb-3 w-1/4" />
            <Skeleton shape="line" className="mb-2" />
            <Skeleton shape="line" className="w-3/4" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-testid={testId ?? "post-thread"}
        role="alert"
        className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
      >
        {error}
      </div>
    );
  }

  // Separate top-level posts from replies
  const topLevelPosts = posts.filter((p) => !p.parentId);
  const repliesByParent = posts.reduce<Record<string, PostItem[]>>((acc, p) => {
    if (p.parentId) {
      const existing = acc[p.parentId] ?? [];
      acc[p.parentId] = [...existing, p];
    }
    return acc;
  }, {});

  if (topLevelPosts.length === 0) {
    return (
      <div data-testid={testId ?? "post-thread"} className={className}>
        <EmptyState
          title="No posts yet"
          description="Be the first to start the discussion."
        />
      </div>
    );
  }

  return (
    <div
      data-testid={testId ?? "post-thread"}
      className={cn("flex flex-col gap-4", className)}
    >
      {/* Top-level reply button */}
      {onReply ? (
        <button
          type="button"
          onClick={() => onReply(null)}
          className={cn(
            "self-start rounded-md border border-brand-500 px-4 py-2 text-sm font-medium text-brand-500",
            "hover:bg-brand-50 transition-colors dark:hover:bg-brand-500/10",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          )}
          data-testid="post-thread-reply-btn"
        >
          <MessageSquare aria-hidden="true" className="mr-1.5 inline size-4" />
          Reply to thread
        </button>
      ) : null}

      {/* Post list */}
      <ol aria-label="Thread posts" className="flex flex-col gap-4">
        {topLevelPosts.map((post) => {
          const replies = repliesByParent[post.id] ?? [];
          const expanded = showAllReplies[post.id] ?? false;
          const visibleReplies = expanded ? replies : replies.slice(0, COLLAPSED_REPLY_LIMIT);
          const hiddenCount = replies.length - COLLAPSED_REPLY_LIMIT;

          return (
            <li key={post.id}>
              <PostCard
                post={post}
                currentUserId={currentUserId}
                threadAuthorId={threadAuthorId}
                isModerator={isModerator}
                onUpvote={onUpvote}
                onResolve={onResolve}
                onReport={onReport}
                onReply={onReply}
                moderationSlot={moderationSlot}
              />

              {/* Nested replies */}
              {replies.length > 0 ? (
                <ol
                  aria-label={`Replies to ${post.authorDisplayName}'s post`}
                  className="mt-2 flex flex-col gap-2"
                >
                  {visibleReplies.map((reply) => (
                    <li key={reply.id}>
                      <PostCard
                        post={reply}
                        isNested
                        currentUserId={currentUserId}
                        threadAuthorId={threadAuthorId}
                        isModerator={isModerator}
                        onUpvote={onUpvote}
                        onReport={onReport}
                        onReply={onReply}
                        moderationSlot={moderationSlot}
                      />
                    </li>
                  ))}

                  {/* Collapse/expand for many replies */}
                  {replies.length > COLLAPSED_REPLY_LIMIT ? (
                    <li>
                      <button
                        type="button"
                        onClick={() =>
                          setShowAllReplies((prev) => ({ ...prev, [post.id]: !expanded }))
                        }
                        aria-expanded={expanded}
                        className={cn(
                          "ml-6 inline-flex items-center gap-1 text-xs font-medium text-brand-500",
                          "hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm",
                        )}
                      >
                        {expanded ? (
                          <>
                            <ChevronUp aria-hidden="true" className="size-3.5" />
                            Collapse replies
                          </>
                        ) : (
                          <>
                            <ChevronDown aria-hidden="true" className="size-3.5" />
                            Show {hiddenCount} more {hiddenCount === 1 ? "reply" : "replies"}
                          </>
                        )}
                      </button>
                    </li>
                  ) : null}
                </ol>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
