import * as React from "react";
import {
  MessageSquare,
  Pin,
  CheckCircle2,
  EyeOff,
  Clock,
} from "lucide-react";

import { cn } from "../lib/cn";
import { EmptyState } from "./empty-state";
import { Skeleton } from "./skeleton";
import { StatusChip } from "./status-chip";

/**
 * ThreadList + ThreadCard — forum thread list view.
 * Per docs/02-prd-lms.md §7.14, docs/03-prd-crm.md (moderation), docs/07 §5.
 *
 * ThreadCard renders a single thread summary row:
 * - Thread title, author display name, reply count, last-activity timestamp.
 * - Status chip: open / resolved / pinned / hidden — never color-only.
 * - Click handler navigates into the thread (caller's responsibility).
 *
 * ThreadList wraps a list of ThreadCards with loading/empty/error states.
 *
 * a11y:
 * - Role="list" / "listitem" semantic structure.
 * - Thread title is a <h3> so screen readers can navigate by heading.
 * - Status conveyed by StatusChip (icon + label).
 * - Click areas include keyboard handler (Enter/Space).
 *
 * Usage:
 *   <ThreadList
 *     threads={threads}
 *     onThreadClick={(thread) => router.push(`/forum/threads/${thread.id}`)}
 *     loading={isFetching}
 *   />
 */

export type ThreadStatus = "open" | "resolved" | "hidden" | "pinned";

export interface ThreadSummary {
  id: string;
  title: string;
  authorDisplayName: string;
  replyCount: number;
  status: ThreadStatus;
  lastActivityAt: Date | string;
  /** Whether the current user has unread replies in this thread. */
  hasUnread?: boolean;
}

export interface ThreadCardProps {
  thread: ThreadSummary;
  onThreadClick?: (thread: ThreadSummary) => void;
  className?: string;
  /** Test hook; defaults to "thread-card". */
  "data-testid"?: string;
}

const STATUS_CHIP_MAP: Record<ThreadStatus, { tone: "neutral" | "success" | "warning" | "danger" | "info"; label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  open: { tone: "info", label: "Open", Icon: MessageSquare },
  resolved: { tone: "success", label: "Resolved", Icon: CheckCircle2 },
  pinned: { tone: "warning", label: "Pinned", Icon: Pin },
  hidden: { tone: "danger", label: "Hidden", Icon: EyeOff },
};

function formatThreadTimestamp(ts: Date | string): string {
  const date = typeof ts === "string" ? new Date(ts) : ts;
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function ThreadCard({
  thread,
  onThreadClick,
  className,
  "data-testid": testId,
}: ThreadCardProps): React.JSX.Element {
  const statusInfo = STATUS_CHIP_MAP[thread.status];
  const timeLabel = formatThreadTimestamp(thread.lastActivityAt);
  const isInteractive = Boolean(onThreadClick);

  function handleClick() {
    onThreadClick?.(thread);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onThreadClick?.(thread);
    }
  }

  return (
    <article
      data-testid={testId ?? "thread-card"}
      data-status={thread.status}
      role="listitem"
      aria-label={`Thread: ${thread.title}${thread.hasUnread ? ", unread replies" : ""}`}
      onClick={isInteractive ? handleClick : undefined}
      onKeyDown={isInteractive ? handleKeyDown : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      className={cn(
        "flex flex-col gap-2 border-b border-border px-4 py-4 last:border-0",
        isInteractive && [
          "cursor-pointer hover:bg-surface",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        ],
        thread.hasUnread && "bg-brand-50/50 dark:bg-brand-500/5",
        className,
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {/* Unread indicator — text-based, not color-only */}
          {thread.hasUnread ? (
            <span className="sr-only">Unread replies.</span>
          ) : null}
          {thread.hasUnread ? (
            <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" />
          ) : null}
          <h3 className="text-sm font-medium leading-snug text-fg line-clamp-2">
            {thread.title}
          </h3>
        </div>
        <StatusChip
          tone={statusInfo.tone}
          label={statusInfo.label}
          size="sm"
          className="shrink-0"
        />
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 text-xs text-fg-muted">
        <span>{thread.authorDisplayName}</span>
        <span aria-hidden="true">·</span>
        <span>
          <MessageSquare aria-hidden="true" className="mr-0.5 inline size-3.5" />
          {thread.replyCount} {thread.replyCount === 1 ? "reply" : "replies"}
        </span>
        <span aria-hidden="true">·</span>
        <span className="flex items-center gap-0.5">
          <Clock aria-hidden="true" className="size-3" />
          <time dateTime={typeof thread.lastActivityAt === "string"
            ? thread.lastActivityAt
            : thread.lastActivityAt.toISOString()}>
            {timeLabel}
          </time>
        </span>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// ThreadList
// ---------------------------------------------------------------------------

export interface ThreadListProps {
  threads: ThreadSummary[];
  onThreadClick?: (thread: ThreadSummary) => void;
  loading?: boolean;
  error?: string;
  /** Heading for the list section. */
  heading?: string;
  className?: string;
  /** Test hook; defaults to "thread-list". */
  "data-testid"?: string;
}

export function ThreadList({
  threads,
  onThreadClick,
  loading = false,
  error,
  heading,
  className,
  "data-testid": testId,
}: ThreadListProps): React.JSX.Element {
  return (
    <section
      data-testid={testId ?? "thread-list"}
      aria-label={heading ?? "Forum threads"}
      className={cn("flex flex-col", className)}
    >
      {heading ? (
        <h2 className="mb-3 text-base font-semibold text-fg">{heading}</h2>
      ) : null}

      {loading ? (
        <div
          aria-busy="true"
          aria-label="Loading threads"
          className="rounded-md border border-border"
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="border-b border-border px-4 py-4 last:border-0">
              <Skeleton shape="line" className="mb-2 w-3/4" />
              <Skeleton shape="line" className="w-1/3" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : threads.length === 0 ? (
        <EmptyState
          title="No threads yet"
          description="Start a discussion by creating the first thread."
        />
      ) : (
        <div
          role="list"
          aria-label={heading ?? "Forum threads"}
          className="rounded-md border border-border"
        >
          {threads.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              onThreadClick={onThreadClick}
            />
          ))}
        </div>
      )}
    </section>
  );
}
