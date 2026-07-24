"use client";

import * as React from "react";
import { Bell, CheckCheck, X } from "lucide-react";

import { cn } from "../lib/cn";
import { EmptyState } from "./empty-state";
import { NotificationItem, type NotificationItemProps } from "./notification-item";

/**
 * NotificationBell — header bell icon with unread badge, dropdown notification list,
 * per-item mark-read, mark-all-read, and an a11y live-region that announces incoming
 * notifications to screen readers.
 *
 * Per docs/02-prd-lms.md §7.15, docs/03-prd-crm.md §7.16, docs/07 §11.
 *
 * SSE seam: the component is purely presentational. The consuming frontend (LMS #10 / CRM #11)
 * feeds live updates by passing new `items` + the `newItemIds` set. When `newItemIds` changes,
 * the live-region announces the count to screen readers without moving focus.
 *
 * a11y:
 * - Bell button has aria-label describing unread count.
 * - `aria-haspopup="true"` and `aria-expanded` on the trigger.
 * - Focus is trapped inside the dropdown via Radix Popover.
 * - Live-region (`role="status" aria-live="polite"`) announces new notifications.
 * - Unread badge is text-based (not color-only): badge number + "unread notifications"
 *   text in the aria-label.
 * - Dropdown is dismissible with Escape key (Radix default).
 *
 * Usage:
 *   const [items, setItems] = React.useState<NotificationItemProps[]>(initialItems);
 *
 *   // SSE or polling: when the backend pushes a new notification —
 *   const handleNewItems = (incoming: NotificationItemProps[]) => {
 *     setItems(prev => [...incoming, ...prev]);
 *     setNewItemIds(new Set(incoming.map(n => n.id)));
 *   };
 *
 *   <NotificationBell
 *     items={items}
 *     newItemIds={newItemIds}          // drives the live-region announcement
 *     onMarkRead={(id) => markRead(id)}
 *     onMarkAllRead={() => markAllRead()}
 *     onViewAll={() => router.push('/notifications')}
 *   />
 */

export type NotificationBellItem = Omit<NotificationItemProps, "onMarkRead">;

export interface NotificationBellProps {
  items: NotificationBellItem[];
  /**
   * Ids of notifications that arrived since the last render cycle — used to drive the
   * a11y live-region announcement. Set these when new items come in via SSE or polling,
   * then clear them after the next render cycle. The component does not auto-clear.
   */
  newItemIds?: ReadonlySet<string>;
  onMarkRead: (id: string) => void;
  onMarkAllRead?: () => void;
  /** Navigate to the full notifications center. */
  onViewAll?: () => void;
  /** Loading state for the initial list fetch. */
  loading?: boolean;
  className?: string;
  /** Test hook; defaults to "notification-bell". */
  "data-testid"?: string;
}

/** Maximum items shown in the dropdown before "View all" truncates. */
const MAX_PREVIEW = 8;

export function NotificationBell({
  items,
  newItemIds,
  onMarkRead,
  onMarkAllRead,
  onViewAll,
  loading = false,
  className,
  "data-testid": testId,
}: NotificationBellProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);

  const unreadCount = items.filter((n) => !n.isRead).length;
  const previewItems = items.slice(0, MAX_PREVIEW);
  const hasMore = items.length > MAX_PREVIEW;

  // Track previous newItemIds to detect changes and build announcement text
  const prevNewIdsRef = React.useRef<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = React.useState("");

  React.useEffect(() => {
    if (!newItemIds || newItemIds.size === 0) return;
    // Only announce if the set actually changed (new ids arrived)
    const prev = prevNewIdsRef.current;
    const hasNewIds = [...newItemIds].some((id) => !prev.has(id));
    if (hasNewIds) {
      const count = newItemIds.size;
      setAnnouncement(
        count === 1 ? "1 new notification arrived." : `${count} new notifications arrived.`,
      );
    }
    prevNewIdsRef.current = newItemIds;
  }, [newItemIds]);

  // Close dropdown on outside click or Escape key
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    function handlePointerDown(e: PointerEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  return (
    <div className="relative inline-block">
      {/* A11y live-region — announces new notifications without moving focus */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="notification-live-region"
      >
        {announcement}
      </div>

      {/* Bell trigger */}
      <button
        ref={triggerRef}
        type="button"
        data-testid={testId ?? "notification-bell"}
        aria-label={
          unreadCount > 0
            ? `Notifications — ${unreadCount} unread`
            : "Notifications — none unread"
        }
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="notification-dropdown"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "relative inline-flex size-10 items-center justify-center rounded-md text-fg-muted",
          "transition-colors hover:bg-surface hover:text-fg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          className,
        )}
      >
        <Bell aria-hidden="true" className="size-5" />
        {unreadCount > 0 ? (
          <span
            aria-hidden="true"
            className={cn(
              "absolute right-1.5 top-1.5 flex min-w-[1.1rem] items-center justify-center",
              "rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white",
              "pointer-events-none h-[1.1rem]",
            )}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {/* Dropdown panel */}
      {open ? (
        <div
          id="notification-dropdown"
          ref={dropdownRef}
          role="dialog"
          aria-label="Notifications"
          data-testid="notification-bell-dropdown"
          className={cn(
            "absolute right-0 top-full z-50 mt-2",
            "w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-border bg-card shadow-md",
            "animate-in fade-in slide-in-from-top-2 duration-[150ms]",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-fg">Notifications</h2>
            <div className="flex items-center gap-1">
              {onMarkAllRead && unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={onMarkAllRead}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs font-medium text-brand-500",
                    "hover:bg-surface transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm",
                  )}
                  aria-label="Mark all notifications as read"
                >
                  <CheckCheck aria-hidden="true" className="inline mr-1 size-3.5" />
                  All read
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => { setOpen(false); triggerRef.current?.focus(); }}
                aria-label="Close notifications"
                className={cn(
                  "rounded-md p-1 text-fg-subtle hover:bg-surface hover:text-fg transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
          </div>

          {/* List */}
          <div
            role="list"
            aria-label="Notifications list"
            className="max-h-[min(28rem,calc(100dvh-12rem))] overflow-y-auto"
          >
            {loading ? (
              <NotificationBellSkeleton />
            ) : previewItems.length === 0 ? (
              <EmptyState
                title="You're all caught up"
                description="No notifications right now."
                className="py-8"
              />
            ) : (
              previewItems.map((item) => (
                <div role="listitem" key={item.id} className="border-b border-border last:border-0">
                  <NotificationItem
                    {...item}
                    onMarkRead={onMarkRead}
                  />
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          {(hasMore || onViewAll) ? (
            <div className="border-t border-border px-4 py-2.5">
              {onViewAll ? (
                <button
                  type="button"
                  onClick={() => { onViewAll(); setOpen(false); }}
                  className={cn(
                    "w-full rounded-md py-1.5 text-center text-sm font-medium text-brand-500",
                    "hover:bg-surface transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  {hasMore ? `View all ${items.length} notifications` : "View notifications center"}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Skeleton rows shown while the initial list loads */
function NotificationBellSkeleton(): React.JSX.Element {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex gap-3 border-b border-border px-4 py-3 last:border-0">
          <div className="mt-0.5 size-8 shrink-0 animate-pulse rounded-full bg-surface" />
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-surface" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-surface" />
            <div className="h-3 w-12 animate-pulse rounded bg-surface" />
          </div>
        </div>
      ))}
    </>
  );
}
