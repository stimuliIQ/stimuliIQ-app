"use client";

import * as React from "react";
import {
  Phone,
  FileText,
  MessageCircle,
  Mail,
  CheckSquare,
  type LucideIcon,
} from "lucide-react";

import { cn } from "../lib/cn";
import { DateChip } from "./date-chip";

/**
 * ActivityTimeline — vertical ordered timeline of activity items for a lead or student,
 * per docs/03-prd-crm.md §7.11 / §7.12 and docs/05 (activities table:
 * call | note | whatsapp | email | task). Each item shows an icon by type, the actor
 * name, a timestamp via DateChip, and a content slot.
 *
 * Note: whatsapp/email activities are **logged records** in P2 (not sent) — this component
 * only displays them; no send actions are wired here.
 *
 * a11y: rendered as an ordered list (`<ol>`) with an implicit `list` role. Each item is an
 * `<li>` containing a heading (actor + type) and a time element. Screen readers can navigate
 * items in document order. The list is keyboard-navigable (items receive `tabIndex=0` and
 * respond to Enter/Space for expansion if the `onItemClick` prop is provided).
 *
 * Items API — pass either `items` (data array) or `children` (render-prop / ReactNode list):
 *
 *   // Data-driven API
 *   <ActivityTimeline
 *     items={[
 *       {
 *         id: "1",
 *         type: "call",
 *         actorName: "Sneha R.",
 *         timestamp: new Date("2026-06-27T09:00:00Z"),
 *         content: "Follow-up call — student confirmed interest",
 *       },
 *     ]}
 *   />
 *
 *   // Render-prop / custom items
 *   <ActivityTimeline>
 *     <ActivityTimelineItem type="note" actorName="Sneha R." timestamp={new Date()}>
 *       Discussed course options
 *     </ActivityTimelineItem>
 *   </ActivityTimeline>
 */

export type ActivityType = "call" | "note" | "whatsapp" | "email" | "task";

const activityIcon: Record<ActivityType, LucideIcon> = {
  call: Phone,
  note: FileText,
  whatsapp: MessageCircle,
  email: Mail,
  task: CheckSquare,
};

const activityLabel: Record<ActivityType, string> = {
  call: "Call",
  note: "Note",
  whatsapp: "WhatsApp",
  email: "Email",
  task: "Task",
};

const activityIconClass: Record<ActivityType, string> = {
  call: "bg-success/10 text-success",
  note: "bg-info/10 text-info",
  whatsapp: "bg-success/10 text-success",
  email: "bg-brand-100/80 text-brand-500",
  task: "bg-warning/10 text-warning",
};

export interface ActivityItem {
  id: string;
  type: ActivityType;
  actorName: string;
  timestamp: Date;
  /** Text or JSX content for the activity body. */
  content?: React.ReactNode;
  /** Whether this task-type activity is completed. Only relevant for `type="task"`. */
  done?: boolean;
  /** Due date — relevant for `type="task"`. Used to show SlaChip if provided. */
  dueAt?: Date;
}

export interface ActivityTimelineItemProps {
  type: ActivityType;
  actorName: string;
  timestamp: Date;
  children?: React.ReactNode;
  done?: boolean;
  dueAt?: Date;
  /** Called when the item is clicked (e.g. to expand or edit). */
  onItemClick?: () => void;
  className?: string;
  /** Test hook; defaults to "activity-timeline-item" when omitted. */
  "data-testid"?: string;
}

export const ActivityTimelineItem = React.forwardRef<
  HTMLLIElement,
  ActivityTimelineItemProps
>(
  (
    {
      type,
      actorName,
      timestamp,
      children,
      done,
      onItemClick,
      className,
      "data-testid": testId,
    },
    ref,
  ) => {
    const Icon = activityIcon[type];
    const typeLabel = activityLabel[type];
    const iconClass = activityIconClass[type];

    function handleKeyDown(e: React.KeyboardEvent<HTMLLIElement>): void {
      if (onItemClick && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        onItemClick();
      }
    }

    return (
      <li
        ref={ref}
        data-testid={testId ?? "activity-timeline-item"}
        className={cn(
          "relative flex gap-3 pb-6 last:pb-0",
          // Vertical connector line from the icon to the next item
          "before:absolute before:left-[1.1875rem] before:top-8 before:h-[calc(100%-2rem)] before:w-px before:bg-border before:content-[''] last:before:hidden",
          onItemClick && "cursor-pointer",
          className,
        )}
        tabIndex={onItemClick ? 0 : undefined}
        onClick={onItemClick}
        onKeyDown={onItemClick ? handleKeyDown : undefined}
        aria-label={onItemClick ? `${typeLabel} by ${actorName}` : undefined}
      >
        {/* Icon badge */}
        <div
          className={cn(
            "relative z-10 mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full border border-border",
            iconClass,
          )}
          aria-hidden="true"
        >
          <Icon className="size-4" />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium text-fg">{actorName}</span>
            <span className="text-xs text-fg-muted">{typeLabel}</span>
            {done ? (
              <span className="text-xs font-medium text-success">Done</span>
            ) : null}
            <DateChip
              date={timestamp}
              format="relative"
              tone="neutral"
              className="ml-auto shrink-0"
            />
          </div>
          {children ? (
            <p className="mt-1 text-sm text-fg-muted">{children}</p>
          ) : null}
        </div>
      </li>
    );
  },
);
ActivityTimelineItem.displayName = "ActivityTimelineItem";

export interface ActivityTimelineProps {
  /**
   * Data-driven items API. Provide `items` OR `children`, not both.
   * Items are rendered in the order given (newest-first or oldest-first — caller's choice;
   * the component imposes no sorting so the consumer controls chronological ordering).
   */
  items?: ActivityItem[];
  /**
   * Called when an item is clicked (data-driven mode). Receives the item's id.
   * If not provided, items are non-interactive (display only).
   */
  onItemClick?: (id: string) => void;
  /** Custom item nodes for the render-prop / slot API. */
  children?: React.ReactNode;
  /** Empty state shown when `items` is provided but empty. */
  emptyLabel?: string;
  className?: string;
  /** Test hook; defaults to "activity-timeline" when omitted. */
  "data-testid"?: string;
}

export function ActivityTimeline({
  items,
  onItemClick,
  children,
  emptyLabel = "No activity recorded yet.",
  className,
  "data-testid": testId,
}: ActivityTimelineProps): React.JSX.Element {
  // Data-driven mode
  if (items !== undefined) {
    if (items.length === 0) {
      return (
        <div
          data-testid={testId ?? "activity-timeline"}
          className={cn("py-6 text-center text-sm text-fg-muted", className)}
          aria-live="polite"
        >
          {emptyLabel}
        </div>
      );
    }

    return (
      <ol
        data-testid={testId ?? "activity-timeline"}
        aria-label="Activity timeline"
        className={cn("list-none p-0", className)}
      >
        {items.map((item) => (
          <ActivityTimelineItem
            key={item.id}
            type={item.type}
            actorName={item.actorName}
            timestamp={item.timestamp}
            done={item.done}
            dueAt={item.dueAt}
            onItemClick={onItemClick ? () => onItemClick(item.id) : undefined}
          >
            {item.content}
          </ActivityTimelineItem>
        ))}
      </ol>
    );
  }

  // Render-prop / custom children mode
  return (
    <ol
      data-testid={testId ?? "activity-timeline"}
      aria-label="Activity timeline"
      className={cn("list-none p-0", className)}
    >
      {children}
    </ol>
  );
}
