// Notification Center — full list view with filters, mark-read, and prefs tab.
// Phase 6, Task #10. docs/02 §7.15.
//
// Renders:
//   - Notification list (all / unread filter, paginated)
//   - Mark-read / mark-all-read
//   - Tab to the prefs page
//
// DOMPurify note: NotificationItem renders body as plain text, not HTML.
// Notification user-content that embeds HTML (e.g. announcement.body from the
// payload) MUST be sanitized before rendering — see notificationBodySafe() below.
//
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import Link from "next/link";
import { RefreshCw, Settings } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  EmptyState,
  PageHeader,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  NotificationItem,
} from "@repo/ui";

import { sanitizeHtml } from "../../lib/sanitize";
import { useNotifications } from "../../hooks/use-notifications";

// ---------------------------------------------------------------------------
// Notification list skeleton
// ---------------------------------------------------------------------------

function NotificationListSkeleton(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading notifications"
      className="space-y-2"
      data-testid="notifications-skeleton"
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-3 rounded-md border border-border bg-card p-4">
          <Skeleton shape="block" className="size-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton shape="line" className="h-4 w-3/4" />
            <Skeleton shape="line" className="h-3 w-1/2" />
            <Skeleton shape="line" className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notification title/body derivation — same logic as the shell helper
// kept here to avoid coupling to the shell.
// ---------------------------------------------------------------------------

function deriveTitle(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case "grade_ready":
      return `Assignment graded: ${String(payload.assignmentTitle ?? "your assignment")}`;
    case "certificate_ready":
      return `Certificate ready: ${String(payload.programTitle ?? "your program")}`;
    case "forum_reply":
      return `New reply in: ${String(payload.threadTitle ?? "your thread")}`;
    case "announcement":
      return String(payload.title ?? "New announcement");
    case "lead_confirmation":
      return "Your enquiry has been received";
    case "booking_confirmation":
      return `Booking confirmed: ${String(payload.programTitle ?? "your session")}`;
    case "payment_receipt":
      return "Payment receipt available";
    case "welcome":
      return `Welcome, ${String(payload.userName ?? "there")}!`;
    default:
      return "Notification";
  }
}

// Sanitize user-generated content from announcement.body before display.
// Most notification bodies are plain text, but announcements may include
// markdown-ish content that the server did not sanitize.
function safePlainBody(payload: Record<string, unknown>): string | undefined {
  if (payload.body) {
    // Strip HTML from announcement bodies for the plain-text excerpt
    return sanitizeHtml(String(payload.body)).replace(/<[^>]+>/g, "").trim() || undefined;
  }
  if (payload.score !== undefined) return `Score: ${String(payload.score)}`;
  if (payload.slotDate) return `Date: ${String(payload.slotDate)}`;
  return undefined;
}

// Action label + href for navigating from a notification
function getAction(
  type: string,
  payload: Record<string, unknown>,
): { label: string; href: string } | null {
  switch (type) {
    case "grade_ready":
      return payload.submissionId
        ? { label: "View submission", href: `/assignments/${String(payload.submissionId)}` }
        : null;
    case "certificate_ready":
      return { label: "View certificate", href: "/certificates" };
    case "forum_reply":
      return payload.threadId
        ? { label: "Go to thread", href: `/forum/threads/${String(payload.threadId)}` }
        : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main NotificationCenterContent component
// ---------------------------------------------------------------------------

export function NotificationCenterContent(): React.JSX.Element {
  const {
    items,
    unreadCount,
    isLoading,
    isSignedOut,
    isError,
    error,
    hasMore,
    markRead,
    markAllRead,
    loadMore,
    refetch,
  } = useNotifications();

  const [filter, setFilter] = React.useState<"all" | "unread">("all");

  // ── Signed-out ────────────────────────────────────────────────────────────
  if (isSignedOut) {
    return (
      <Card data-testid="notifications-signed-out">
        <CardHeader>
          <CardTitle>You&apos;re signed out</CardTitle>
          <CardDescription>Sign in to view your notifications.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href="/login">Sign in</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <Card data-testid="notifications-error">
        <CardHeader>
          <CardTitle>Couldn&apos;t load notifications</CardTitle>
          <CardDescription>
            {error?.problem.detail ?? error?.problem.title ?? "Something went wrong."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" onClick={refetch} data-testid="notifications-retry">
            <RefreshCw aria-hidden="true" className="mr-1.5 size-4" />
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const displayedItems =
    filter === "unread" ? items.filter((n) => !n.readAt) : items;

  return (
    <div className="space-y-6 md:space-y-8" data-testid="notification-center">
      <PageHeader
        title="Notifications"
        description={
          unreadCount > 0
            ? `${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`
            : undefined
        }
        actions={
          <>
            {unreadCount > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={markAllRead}
                data-testid="mark-all-read"
                aria-label="Mark all notifications as read"
              >
                Mark all read
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" asChild>
              <Link href="/notifications/prefs" aria-label="Notification preferences">
                <Settings aria-hidden="true" className="size-4" />
                <span className="sr-only">Preferences</span>
              </Link>
            </Button>
          </>
        }
      />

      {/* Filter tabs */}
      <Tabs
        value={filter}
        onValueChange={(v) => setFilter(v as "all" | "unread")}
        data-testid="notification-filter-tabs"
      >
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">
            Unread
            {unreadCount > 0 ? (
              <span
                aria-label={`${unreadCount} unread`}
                className="ml-1.5 inline-flex min-w-[1.2rem] items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white"
              >
                {unreadCount}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <NotificationList
            items={displayedItems}
            loading={isLoading}
            hasMore={hasMore}
            onMarkRead={markRead}
            onLoadMore={loadMore}
          />
        </TabsContent>

        <TabsContent value="unread" className="mt-4">
          <NotificationList
            items={displayedItems}
            loading={isLoading}
            hasMore={false}
            onMarkRead={markRead}
            onLoadMore={loadMore}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NotificationList sub-component
// ---------------------------------------------------------------------------

interface NotificationListProps {
  items: { id: string; type: string; payload: Record<string, unknown>; createdAt: string; readAt: string | null }[];
  loading: boolean;
  hasMore: boolean;
  onMarkRead: (id: string) => void;
  onLoadMore: () => void;
}

function NotificationList({
  items,
  loading,
  hasMore,
  onMarkRead,
  onLoadMore,
}: NotificationListProps): React.JSX.Element {
  if (loading) return <NotificationListSkeleton />;

  if (items.length === 0) {
    return (
      <EmptyState
        data-testid="notifications-empty"
        title="No notifications"
        description="You&apos;re all caught up! Check back later."
      />
    );
  }

  return (
    <div className="space-y-2" data-testid="notification-list">
      {items.map((n) => {
        const action = getAction(n.type, n.payload);
        return (
          <div
            key={n.id}
            className="rounded-lg border border-border bg-card"
            data-testid="notification-list-item"
          >
            <NotificationItem
              id={n.id}
              type={n.type as Parameters<typeof NotificationItem>[0]["type"]}
              title={deriveTitle(n.type, n.payload)}
              body={safePlainBody(n.payload)}
              timestamp={new Date(n.createdAt)}
              isRead={Boolean(n.readAt)}
              onMarkRead={onMarkRead}
              actionLabel={action?.label}
              onAction={
                action
                  ? () => {
                      window.location.href = action.href;
                    }
                  : undefined
              }
            />
          </div>
        );
      })}

      {hasMore ? (
        <Button
          variant="secondary"
          className="w-full"
          onClick={onLoadMore}
          data-testid="notifications-load-more"
        >
          Load more
        </Button>
      ) : null}
    </div>
  );
}
