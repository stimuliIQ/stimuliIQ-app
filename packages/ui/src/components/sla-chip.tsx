import * as React from "react";
import { CheckCircle2, Clock, AlertTriangle, XCircle } from "lucide-react";

import { StatusChip, type StatusChipTone } from "./status-chip";
import { formatRelativeDate } from "./date-chip";

/**
 * SlaChip — SLA / deadline status chip, per docs/03-prd-crm.md §7.12 (counsellor
 * tasks / SLA timers) and docs/07-design-system.md §11 ("no color-only meaning").
 *
 * Computes its tone from the `dueAt` date vs now (or `referenceNow` for testing):
 *   - done (done_at set)     → success  "Done"
 *   - overdue (past dueAt)   → danger   "Overdue 2d"
 *   - due soon (≤ threshold) → warning  "Due in 3h"
 *   - ok (beyond threshold)  → neutral  "Due in 5d"
 *
 * Never color-only: the label always contains the status text. The icon reinforces
 * the tone visually for sighted users but the text alone is sufficient for AT.
 *
 * Composes `StatusChip` for its visual recipe (radius/weight/tint) per
 * docs/specs/crm-ui-consistency.md §3 — SlaChip owns only the SLA→tone/label
 * computation (`computeSlaState`) and the icon; it no longer re-implements a
 * second border/radius/weight recipe. Visual note: this changed the chip from
 * an outlined pill (`rounded-full border`, fixed `h-5`/`h-6`) to `StatusChip`'s
 * flat soft badge (`rounded`, `bg-<tone>/15`, no border) — same five tones,
 * same icon, same always-rendered label; only the container shape unified.
 *
 * SLA thresholds (exportable constants, override via props if needed):
 *   SLA_SOON_THRESHOLD_MS = 24 hours (≤ 24h remaining → "warning")
 *
 * Usage:
 *   // Active task with a deadline
 *   <SlaChip dueAt={task.due_at} />
 *
 *   // Completed task
 *   <SlaChip dueAt={task.due_at} done />
 *
 *   // Override threshold (e.g. 48h "due soon" window)
 *   <SlaChip dueAt={task.due_at} soonThresholdMs={48 * 60 * 60 * 1000} />
 */

/** Default "due soon" threshold: 24 hours in milliseconds. */
export const SLA_SOON_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export type SlaStatus = "done" | "overdue" | "soon" | "ok";

export interface SlaState {
  status: SlaStatus;
  tone: StatusChipTone;
  label: string;
}

/**
 * Pure function — computes SLA state from a due date, completion state, and reference time.
 * Exported for use in business-logic hooks without rendering.
 */
export function computeSlaState(
  dueAt: Date,
  done: boolean,
  referenceNow: Date = new Date(),
  soonThresholdMs: number = SLA_SOON_THRESHOLD_MS,
): SlaState {
  if (done) {
    return { status: "done", tone: "success", label: "Done" };
  }

  const diffMs = dueAt.getTime() - referenceNow.getTime();

  if (diffMs < 0) {
    // Overdue — compute how overdue
    const relLabel = formatRelativeDate(dueAt, referenceNow);
    // formatRelativeDate returns e.g. "2d ago", "3h ago" — strip " ago" and prefix "Overdue"
    const stripped = relLabel.replace(/ ago$/, "");
    return {
      status: "overdue",
      tone: "danger",
      label: stripped === "Just now" ? "Just overdue" : `Overdue ${stripped}`,
    };
  }

  if (diffMs <= soonThresholdMs) {
    // Due soon
    const relLabel = formatRelativeDate(dueAt, referenceNow);
    // formatRelativeDate returns e.g. "in 3h" — keep as-is for label
    return {
      status: "soon",
      tone: "warning",
      label: `Due ${relLabel}`,
    };
  }

  // Ok — due in the future beyond the threshold
  const relLabel = formatRelativeDate(dueAt, referenceNow);
  return {
    status: "ok",
    tone: "neutral",
    label: `Due ${relLabel}`,
  };
}

const statusIcon: Record<SlaStatus, React.ComponentType<{ className?: string }>> = {
  done: CheckCircle2,
  overdue: XCircle,
  soon: AlertTriangle,
  ok: Clock,
};

export interface SlaChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The SLA deadline date. */
  dueAt: Date;
  /** Whether the task/SLA is completed (shows "Done" in success tone). */
  done?: boolean;
  /**
   * Custom threshold in milliseconds for the "due soon" → warning zone.
   * Defaults to `SLA_SOON_THRESHOLD_MS` (24 hours).
   */
  soonThresholdMs?: number;
  /**
   * Reference date for computing relative time. Defaults to `new Date()`.
   * Primarily useful for tests with deterministic time.
   */
  referenceNow?: Date;
  /** Size variant. Default: "md". */
  size?: "sm" | "md";
  /** Test hook; defaults to "sla-chip" when omitted. */
  "data-testid"?: string;
}

export const SlaChip = React.forwardRef<HTMLSpanElement, SlaChipProps>(
  (
    {
      dueAt,
      done = false,
      soonThresholdMs = SLA_SOON_THRESHOLD_MS,
      referenceNow,
      size = "md",
      className,
      "data-testid": testId,
      ...props
    },
    ref,
  ) => {
    const { status, tone, label } = computeSlaState(
      dueAt,
      done,
      referenceNow ?? new Date(),
      soonThresholdMs,
    );

    const Icon = statusIcon[status];

    return (
      <StatusChip
        ref={ref}
        tone={tone}
        label={label}
        size={size}
        icon={<Icon aria-hidden="true" className="shrink-0" />}
        // Announce the full label to screen readers (status + time is in the text)
        aria-label={label}
        data-testid={testId ?? "sla-chip"}
        className={className}
        {...props}
      />
    );
  },
);
SlaChip.displayName = "SlaChip";
