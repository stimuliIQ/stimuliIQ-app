import * as React from "react";
import { Calendar } from "lucide-react";

import { cn } from "../lib/cn";
import { type StatusChipTone } from "./status-chip";

/**
 * DateChip — compact date display chip with relative + absolute labelling, per
 * docs/03-prd-crm.md §7.12 (counsellor tasks / SLA), docs/07-design-system.md §5.
 *
 * Never conveys meaning by color alone (rule per docs/07 §2 + §11): the chip always
 * renders a text label (relative or absolute date); tone is additive context.
 *
 * Usage:
 *   // Relative (default): "in 2d", "3h ago", "Today"
 *   <DateChip date={new Date("2026-07-01")} />
 *
 *   // Absolute: "1 Jul 2026"
 *   <DateChip date={new Date("2026-07-01")} format="absolute" />
 *
 *   // Both:
 *   <DateChip date={new Date("2026-07-01")} format="both" />
 *
 *   // With explicit tone override:
 *   <DateChip date={new Date("2026-07-01")} tone="warning" />
 */
export type DateChipFormat = "relative" | "absolute" | "both";

export interface DateChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The date to display. */
  date: Date;
  /** Display format: relative ("in 2d"), absolute ("1 Jul 2026"), or both. Default: "relative". */
  format?: DateChipFormat;
  /**
   * Tone — defaults to "neutral". Set explicitly or let SlaChip compute it.
   * The chip always also shows a text label so tone is supplementary, not the sole signal.
   */
  tone?: StatusChipTone;
  /** Test hook; defaults to "date-chip" when omitted. */
  "data-testid"?: string;
}

/** Formats a date for display in "1 Jul 2026" style (locale-agnostic short format). */
export function formatAbsoluteDate(date: Date): string {
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Returns a human-readable relative label for a date vs now.
 * Examples: "Just now", "in 3h", "2d ago", "in 2d", "Today", "Yesterday", "Tomorrow".
 */
export function formatRelativeDate(date: Date, now: Date = new Date()): string {
  const diffMs = date.getTime() - now.getTime();
  const absDiffMs = Math.abs(diffMs);
  const isPast = diffMs < 0;

  const minutes = Math.round(absDiffMs / 60_000);
  const hours = Math.round(absDiffMs / 3_600_000);
  const days = Math.round(absDiffMs / 86_400_000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return isPast ? `${minutes}m ago` : `in ${minutes}m`;
  if (hours < 24) return isPast ? `${hours}h ago` : `in ${hours}h`;
  if (days === 1) return isPast ? "Yesterday" : "Tomorrow";
  if (days < 7) return isPast ? `${days}d ago` : `in ${days}d`;
  if (days < 30) {
    const weeks = Math.round(days / 7);
    return isPast ? `${weeks}w ago` : `in ${weeks}w`;
  }
  // Beyond 4 weeks — fall back to absolute
  return formatAbsoluteDate(date);
}

const toneClasses: Record<StatusChipTone, string> = {
  neutral: "border-border bg-surface text-fg-muted",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-danger/30 bg-danger/10 text-danger",
  info: "border-info/30 bg-info/10 text-info",
};

export const DateChip = React.forwardRef<HTMLSpanElement, DateChipProps>(
  (
    {
      date,
      format = "relative",
      tone = "neutral",
      className,
      "data-testid": testId,
      ...props
    },
    ref,
  ) => {
    const relative = formatRelativeDate(date);
    const absolute = formatAbsoluteDate(date);

    let label: string;
    let title: string;

    if (format === "absolute") {
      label = absolute;
      title = relative;
    } else if (format === "both") {
      label = `${relative} · ${absolute}`;
      title = absolute;
    } else {
      // relative (default)
      label = relative;
      title = absolute;
    }

    return (
      <span
        ref={ref}
        data-testid={testId ?? "date-chip"}
        title={title}
        aria-label={`Date: ${label}`}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
          toneClasses[tone],
          className,
        )}
        {...props}
      >
        <Calendar className="size-3 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  },
);
DateChip.displayName = "DateChip";
