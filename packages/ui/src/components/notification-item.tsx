import * as React from "react";
import {
  Bell,
  BookOpen,
  Award,
  MessageSquare,
  Megaphone,
  UserCheck,
  Calendar,
  Receipt,
  Check,
  CalendarCheck,
  CalendarClock,
  CalendarX2,
  Undo2,
  UserPlus,
} from "lucide-react";

import { cn } from "../lib/cn";

/**
 * NotificationItem — single row in the notification list (bell dropdown or full center).
 * Per docs/02-prd-lms.md §7.15, docs/03-prd-crm.md §7.16.
 *
 * Design rules:
 * - Status conveyed by both icon+tone color AND the unread dot label text ("New") —
 *   never color-only (docs/07 §2 + §11).
 * - Timestamp rendered as a <time> element with a machine-readable `dateTime` attribute.
 * - Optional `actionLabel`/`onAction` for a CTA link inside the item.
 * - `data-testid` defaults to "notification-item".
 *
 * Usage:
 *   <NotificationItem
 *     id="notif-1"
 *     type="grade_ready"
 *     title="Your assignment has been graded"
 *     body="Python Basics — Module 3: scored 82/100."
 *     timestamp={new Date()}
 *     isRead={false}
 *     onMarkRead={(id) => markRead(id)}
 *     actionLabel="View grade"
 *     onAction={() => router.push('/assignments/123')}
 *   />
 */

export type NotificationType =
  | "grade_ready"
  // A reviewer sent a submission BACK for changes. Distinct from grade_ready because the
  // student has to act, not just read.
  | "submission_returned"
  | "certificate_ready"
  | "live_reminder"
  | "forum_reply"
  | "announcement"
  | "lead_confirmation"
  | "booking_confirmation"
  | "payment_receipt"
  | "welcome"
  // STAFF-facing types (every other one above targets a student). Mirrors the Prisma
  // NotificationType enum and NotificationTypeSchema — this union must stay in step with
  // both, or the CRM bell falls through to the generic icon for exactly the notifications
  // it exists to show.
  | "lead_assigned"
  | "leave_requested"
  | "leave_approved"
  | "leave_rejected";

const typeIconMap: Record<NotificationType, React.ComponentType<{ className?: string; "aria-hidden"?: "true" | boolean }>> = {
  grade_ready: BookOpen,
  submission_returned: Undo2,
  certificate_ready: Award,
  live_reminder: Calendar,
  forum_reply: MessageSquare,
  announcement: Megaphone,
  lead_confirmation: UserCheck,
  booking_confirmation: Calendar,
  payment_receipt: Receipt,
  welcome: Bell,
  lead_assigned: UserPlus,
  leave_requested: CalendarClock,
  leave_approved: CalendarCheck,
  leave_rejected: CalendarX2,
};

const typeLabelMap: Record<NotificationType, string> = {
  grade_ready: "Grade ready",
  submission_returned: "Changes needed",
  certificate_ready: "Certificate ready",
  live_reminder: "Live class reminder",
  forum_reply: "Forum reply",
  announcement: "Announcement",
  lead_confirmation: "Enquiry confirmed",
  booking_confirmation: "Booking confirmed",
  payment_receipt: "Payment receipt",
  welcome: "Welcome",
  lead_assigned: "Lead assigned",
  leave_requested: "Leave request",
  leave_approved: "Leave approved",
  leave_rejected: "Leave not approved",
};

export interface NotificationItemProps {
  id: string;
  type: NotificationType;
  title: string;
  body?: string;
  timestamp: Date | string;
  isRead: boolean;
  /** Called when the user clicks the "Mark as read" control for this item. */
  onMarkRead?: (id: string) => void;
  /** Label for the optional action CTA (e.g. "View grade"). */
  actionLabel?: string;
  /** Called when the user activates the action CTA. */
  onAction?: () => void;
  className?: string;
  /** Test hook; defaults to "notification-item". */
  "data-testid"?: string;
}

/**
 * Formats a Date or ISO string as a short relative or absolute label.
 * Kept client-only pure — no Intl.RelativeTimeFormat polyfill required.
 */
function formatNotifTimestamp(ts: Date | string): { label: string; dateTime: string } {
  const date = typeof ts === "string" ? new Date(ts) : ts;
  const isoString = date.toISOString();
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  let label: string;
  if (diffMin < 1) label = "Just now";
  else if (diffMin < 60) label = `${diffMin}m ago`;
  else if (diffHr < 24) label = `${diffHr}h ago`;
  else if (diffDay === 1) label = "Yesterday";
  else if (diffDay < 7) label = `${diffDay}d ago`;
  else label = date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  return { label, dateTime: isoString };
}

export const NotificationItem = React.forwardRef<HTMLDivElement, NotificationItemProps>(
  (
    {
      id,
      type,
      title,
      body,
      timestamp,
      isRead,
      onMarkRead,
      actionLabel,
      onAction,
      className,
      "data-testid": testId,
    },
    ref,
  ) => {
    const Icon = typeIconMap[type];
    const typeLabel = typeLabelMap[type];
    const { label: timeLabel, dateTime } = formatNotifTimestamp(timestamp);

    return (
      <div
        ref={ref}
        data-testid={testId ?? "notification-item"}
        data-read={isRead}
        className={cn(
          "flex gap-3 px-4 py-3 transition-colors",
          !isRead && "bg-brand-50 dark:bg-brand-500/10",
          className,
        )}
      >
        {/* Type icon */}
        <div
          aria-hidden="true"
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
            isRead ? "bg-surface text-fg-muted" : "bg-brand-100 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400",
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
        </div>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* Visually hidden type label for screen-reader context */}
          <span className="sr-only">{typeLabel}.</span>

          <p className={cn("text-sm leading-snug text-fg", !isRead && "font-medium")}>{title}</p>

          {body ? (
            <p className="truncate text-xs text-fg-muted">{body}</p>
          ) : null}

          <div className="mt-1 flex items-center gap-2">
            <time dateTime={dateTime} className="text-xs text-fg-subtle">
              {timeLabel}
            </time>
            {/* Unread indicator — text-based, not color-only */}
            {!isRead ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-brand-500/40 bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:border-brand-400/40 dark:bg-brand-500/20 dark:text-brand-300">
                New
              </span>
            ) : null}
          </div>

          {/* Optional action CTA */}
          {actionLabel && onAction ? (
            <button
              type="button"
              onClick={onAction}
              className={cn(
                "mt-1 self-start text-xs font-medium text-brand-500 underline-offset-2 hover:underline",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm",
              )}
            >
              {actionLabel}
            </button>
          ) : null}
        </div>

        {/* Mark-read control — visible only for unread items */}
        {!isRead && onMarkRead ? (
          <button
            type="button"
            onClick={() => onMarkRead(id)}
            aria-label={`Mark "${title}" as read`}
            className={cn(
              "mt-1 shrink-0 rounded-full p-1 text-fg-subtle transition-colors hover:bg-surface hover:text-fg",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <Check aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </div>
    );
  },
);
NotificationItem.displayName = "NotificationItem";
