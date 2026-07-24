// apps/api/src/modules/exports/report-schedules/lib/next-run.ts
//
// Pure date-arithmetic helper — no new date library dependency (CLAUDE.md ask-before-
// install discipline; this is the same "hand-rolled, no new dep" posture the plan took
// for CSV escaping). Computes the next `next_run_at` window for a given cadence.

import type { ReportScheduleFrequency } from "@prisma/client";

/**
 * Returns `from` advanced by exactly one cadence window (1 day / 7 days / 1 calendar
 * month), preserving the time-of-day component. All arithmetic is UTC-based (Date's
 * `getUTC*`/`setUTC*`) so this is unaffected by the host process's local timezone.
 */
export function computeNextRunAt(from: Date, frequency: ReportScheduleFrequency): Date {
  const next = new Date(from.getTime());
  switch (frequency) {
    case "daily":
      next.setUTCDate(next.getUTCDate() + 1);
      return next;
    case "weekly":
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    case "monthly":
      next.setUTCMonth(next.getUTCMonth() + 1);
      return next;
  }
}
