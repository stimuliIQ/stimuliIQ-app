// Shared presentation vocabulary for leave, so the queue, the drawer and the calendar all
// call the same state by the same name in the same colour (crm-ui-consistency §2).

import { statusTone } from "@repo/ui";
import type { LeaveDayPart, LeaveRequestStatus } from "@repo/types";

export function leaveStatusTone(status: LeaveRequestStatus) {
  switch (status) {
    case "approved":
      return statusTone("completed");
    case "rejected":
      return statusTone("rejected");
    case "cancelled":
      return statusTone("cancelled");
    default:
      return statusTone("in-progress");
  }
}

/**
 * What staff call each state.
 *
 * "Awaiting approval" rather than "Pending", because the applicant's question is not what
 * the row's status field says — it is whether anybody has looked yet.
 */
export function leaveStatusLabel(status: LeaveRequestStatus): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Not approved";
    case "cancelled":
      return "Withdrawn";
    default:
      return "Awaiting approval";
  }
}

export function dayPartLabel(part: LeaveDayPart): string {
  switch (part) {
    case "first_half":
      return "First half";
    case "second_half":
      return "Second half";
    default:
      return "Full day";
  }
}

/**
 * "17 Aug 2026" for one day, "17 – 21 Aug 2026" within a month, "28 Aug – 3 Sep 2026"
 * across one. The month and year are printed once where they are shared, because a table
 * column reading "17 Aug 2026 – 21 Aug 2026" makes the reader compare two strings to work
 * out that it is the same week.
 */
export function formatLeaveRange(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  const full = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  if (startDate === endDate) return full.format(start);

  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();

  if (sameMonth) return `${start.getUTCDate()} – ${full.format(end)}`;

  if (sameYear) {
    const dayMonth = new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    return `${dayMonth.format(start)} – ${full.format(end)}`;
  }

  return `${full.format(start)} – ${full.format(end)}`;
}
